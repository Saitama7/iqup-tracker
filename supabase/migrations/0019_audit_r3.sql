-- #52 · А10 «Журнал изменений», R3.
-- 1. kind is a stored generated column of audit_log (public.audit_kind) with an index (kind, at, id):
--    the chip filter and the counts read an index instead of re-classifying every row. Same rules as
--    v_audit_feed in 0018, plus one 'retro' case: a teacher's rate inserted with valid_from in the past.
-- 2. Server search «Ученик, группа, учитель…»: v_audit_feed.search — the current names behind a row
--    (student / lead, group with its subject and teacher, substitute / rate teacher), normalised by
--    person_name_key (0018). Computed only when a query reads the column.
-- 3. audit_feed_counts(): the chip counts in one query (one row per kind).
-- Nothing is removed from audit_log; RLS as in 0001 (admin and accountant read, nobody writes).
-- Idempotent: if not exists / create or replace; the view keeps its columns (search is appended).

-- ─── 1. kind ────────────────────────────────────────────────────────────────

-- late       — a lesson confirmed not on its day (planned → held with confirmed_late, Б2);
-- retro      — a correction after the fact (И32): a mark written outside «Провести», a held lesson
--              cancelled or deleted, a teacher's rate inserted with a past valid_from (#52) or fixed /
--              removed from a day already started (И3), a trial booked after the fact (#54);
-- payment    — subscriptions and payments;
-- attendance — a lesson confirmed on its day;
-- other      — everything else.
-- Declared immutable for the generated column: the inputs are the row itself; dates in the snapshots
-- are ISO (to_jsonb), parsed the same under any DateStyle; Bishkek has no DST.
-- Changing a rule later: create or replace this function, then `update public.audit_log set kind = default`
-- recomputes the stored values.
create or replace function public.audit_kind(
  p_entity text,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_at timestamptz
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_entity = 'lessons' and p_action = 'update'
         and p_before ->> 'status' = 'planned' and p_after ->> 'status' = 'held'
         and coalesce((p_after ->> 'confirmed_late')::boolean, false)
      then 'late'
    when p_entity = 'attendance'
      or (p_entity = 'lessons' and p_before ->> 'status' = 'held'
          and (p_action = 'delete' or p_after ->> 'status' <> 'held'))
      or (p_entity = 'teacher_rates' and p_action <> 'insert'
          and (p_before ->> 'valid_from')::date <= (p_at at time zone 'Asia/Bishkek')::date)
      or (p_entity = 'teacher_rates' and p_action = 'insert'
          and (p_after ->> 'valid_from')::date < (p_at at time zone 'Asia/Bishkek')::date)
      or (p_entity = 'trials' and p_action = 'insert' and p_after ->> 'status' <> 'scheduled')
      then 'retro'
    when p_entity in ('subscriptions', 'payments')
      then 'payment'
    when p_entity = 'lessons' and p_action = 'update'
         and p_before ->> 'status' = 'planned' and p_after ->> 'status' = 'held'
      then 'attendance'
    else 'other'
  end
$$;

alter table public.audit_log
  add column if not exists kind text
  generated always as (public.audit_kind(entity, action, before, after, at)) stored;

-- chips: «Правки задним числом» newest first, keyset (at, id)
create index if not exists audit_log_kind_at_idx on public.audit_log (kind, at desc, id desc);

-- ─── 2. search ──────────────────────────────────────────────────────────────

-- The names a row is about, as they are now (a renamed group is found by its new name). Security
-- invoker: the caller's RLS applies — staff read every table involved, a teacher reads no journal rows.
create or replace function public.audit_search_text(p_entity text, p_entity_id uuid, p_row jsonb)
returns text
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  v_student uuid;
  v_group uuid;
  v_teacher uuid;
  v_enrollment uuid;
  v_lead text;
begin
  case p_entity
    when 'attendance' then
      v_student := (p_row ->> 'student_id')::uuid;
      select l.group_id into v_group from public.lessons l where l.id = (p_row ->> 'lesson_id')::uuid;
    when 'lessons' then
      v_group := (p_row ->> 'group_id')::uuid;
      v_teacher := (p_row ->> 'substitute_teacher_id')::uuid;
    when 'enrollments' then
      v_student := (p_row ->> 'student_id')::uuid;
      v_group := (p_row ->> 'group_id')::uuid;
    when 'subscriptions' then
      v_enrollment := (p_row ->> 'enrollment_id')::uuid;
    when 'payments' then
      select s.enrollment_id into v_enrollment
      from public.subscriptions s where s.id = (p_row ->> 'subscription_id')::uuid;
    when 'teacher_rates' then
      v_teacher := (p_row ->> 'teacher_id')::uuid;
    when 'trials' then
      v_student := (p_row ->> 'student_id')::uuid;
      v_group := (p_row ->> 'group_id')::uuid;
      v_lead := p_row ->> 'full_name';
    when 'groups' then
      v_group := p_entity_id;
    else
      return null;
  end case;

  if v_enrollment is not null then
    select e.student_id, e.group_id into v_student, v_group
    from public.enrollments e where e.id = v_enrollment;
  end if;

  return nullif(public.person_name_key(concat_ws(' | ',
    (select s.full_name from public.students s where s.id = v_student),
    v_lead,
    (select concat_ws(' | ', g.name, sj.name, t.full_name)
     from public.groups g
     left join public.subjects sj on sj.id = g.subject_id
     left join public.teachers t on t.id = g.teacher_id
     where g.id = v_group),
    (select t.full_name from public.teachers t where t.id = v_teacher)
  )), '');
end;
$$;

-- Same as 0018, kind read from the column; search appended.
create or replace view public.v_audit_feed
with (security_invoker = true)
as
select
  a.id,
  a.actor_id,
  a.entity,
  a.entity_id,
  a.action,
  a.before,
  a.after,
  a.reason,
  a.at,
  a.kind,
  case
    when a.entity = 'lessons' and a.reason = 'confirm_lesson' then (
      select coalesce(jsonb_agg(m.after ->> 'status' order by m.after ->> 'status'), '[]'::jsonb)
      from public.audit_log m
      where m.entity = 'attendance'
        and m.reason = 'confirm_lesson'
        and m.at = a.at
        and m.after ->> 'lesson_id' = a.entity_id::text
    )
  end as marks,
  public.audit_search_text(a.entity, a.entity_id, coalesce(a.after, a.before)) as search
from public.audit_log a
where not (a.entity = 'attendance' and a.reason is not distinct from 'confirm_lesson');

comment on view public.v_audit_feed is
  'А10 journal: audit_log + kind (late/retro/payment/attendance/other, stored); confirm_lesson marks folded into the lesson row; search — current names (person_name_key).';

revoke all on public.v_audit_feed from anon, authenticated;
grant select on public.v_audit_feed to authenticated;

-- ─── 3. chip counts ─────────────────────────────────────────────────────────

-- One row per kind for the table / author / period / search the screen shows; «Все» is their sum.
-- p_system — rows without an author (service role, migrations). p_q is normalised like the column.
create or replace function public.audit_feed_counts(
  p_entity text default null,
  p_actor uuid default null,
  p_system boolean default false,
  p_since timestamptz default null,
  p_q text default null
)
returns table (kind text, n integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.kind, count(*)::integer
  from public.v_audit_feed f
  where (p_entity is null or f.entity = p_entity)
    and (p_actor is null or f.actor_id = p_actor)
    and (not coalesce(p_system, false) or f.actor_id is null)
    and (p_since is null or f.at >= p_since)
    and (coalesce(public.person_name_key(p_q), '') = ''
         or strpos(f.search, public.person_name_key(p_q)) > 0)
  group by f.kind
$$;

revoke all on function public.audit_feed_counts(text, uuid, boolean, timestamptz, text) from public, anon;
grant execute on function public.audit_feed_counts(text, uuid, boolean, timestamptz, text) to authenticated;
