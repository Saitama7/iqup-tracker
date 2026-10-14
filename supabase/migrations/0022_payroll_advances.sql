-- #83 · Авансы учителям (А8): payroll_adjustments, issue_advance / delete_payroll_adjustment,
-- v_payroll_preview += advances, to_pay. Docs: 05-decisions А8, И53; 01-domain-model.md §6 and
-- PAYROLL_ADJUSTMENT.
--
-- payroll_adjustments — a payout correction of a teacher for a payroll month (`month`, the 1st): kind
-- advance (UI and RPC now), bonus / correction (enum only, their sign is not decided yet — И53).
-- Amount is whole som, always > 0; an advance is subtracted from the payout: to_pay = base − advances.
-- An advance never changes the accrual (base_amount stays what the lessons earned).
-- Written only by the security definer RPCs below (admin or accountant); a teacher reads own rows.
-- A row is never edited: a mistake is deleted with a reason (only while the month is open) and
-- entered again. Every change goes to audit_log (invariant 4).
-- Open month: no locked lesson of that teacher in it (lessons.is_locked) — payroll_periods (R3) will
-- tighten this, the RPCs keep their signatures.
--
-- Production-safe: only new objects, plus v_payroll_preview with the same columns and two appended
-- (create or replace). Idempotent: if not exists / create or replace / drop … if exists.

-- ─── payroll_adjustments ────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payroll_adjustment_kind'
                 and typnamespace = 'public'::regnamespace) then
    create type public.payroll_adjustment_kind as enum ('advance', 'bonus', 'correction');
  end if;
end;
$$;

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id),
  month date not null check (extract(day from month) = 1),
  kind public.payroll_adjustment_kind not null default 'advance',
  amount integer not null check (amount > 0),
  issued_on date not null,
  comment text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists payroll_adjustments_teacher_month_idx
  on public.payroll_adjustments (teacher_id, month);
create index if not exists payroll_adjustments_month_idx on public.payroll_adjustments (month);

comment on table public.payroll_adjustments is
  'Advances (bonus / correction later) per teacher and payroll month; to_pay = base − advances (А8, #83).';

-- ─── guard ──────────────────────────────────────────────────────────────────

-- A locked lesson of the teacher in the month — the month is closed for adjustments.
create or replace function public.payroll_month_locked(p_teacher_id uuid, p_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lessons l
    where l.teacher_id = p_teacher_id
      and l.is_locked
      and l.lesson_date >= p_month
      and l.lesson_date < (p_month + interval '1 month')::date
  );
$$;

revoke execute on function public.payroll_month_locked(uuid, date) from public, anon, authenticated;

-- Never edited; created_by / created_at are the DB's; nothing in a closed month; not issued in the future.
create or replace function public.payroll_adjustments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'payroll adjustments are not edited — delete with a reason and enter again'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if public.payroll_month_locked(old.teacher_id, old.month) then
      raise exception 'payroll month % is closed', to_char(old.month, 'YYYY-MM')
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  new.created_at := now();
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  if new.issued_on > public.bishkek_today() then
    raise exception 'advance date is in the future' using errcode = 'check_violation';
  end if;
  if public.payroll_month_locked(new.teacher_id, new.month) then
    raise exception 'payroll month % is closed', to_char(new.month, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.payroll_adjustments_guard() from public, anon, authenticated;

drop trigger if exists payroll_adjustments_guard on public.payroll_adjustments;
create trigger payroll_adjustments_guard
before insert or update or delete on public.payroll_adjustments
for each row execute function public.payroll_adjustments_guard();

drop trigger if exists audit_log on public.payroll_adjustments;
create trigger audit_log after insert or update or delete on public.payroll_adjustments
for each row execute function public.write_audit_log();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.payroll_adjustments enable row level security;

drop policy if exists payroll_adjustments_select on public.payroll_adjustments;
create policy payroll_adjustments_select on public.payroll_adjustments for select to authenticated
  using (teacher_id = public.current_teacher_id() or public.is_staff());
-- No write policy: written only by issue_advance / delete_payroll_adjustment.

revoke all on public.payroll_adjustments from anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'payroll_adjustments') then
    alter publication supabase_realtime add table public.payroll_adjustments;
  end if;
end;
$$;

-- ─── RPC ────────────────────────────────────────────────────────────────────

create or replace function public.assert_payroll_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'only admin or accountant manage advances' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function public.assert_payroll_staff() from public, anon, authenticated;

-- «Выдать аванс»: issued today by default; the payroll month — that of the issue date unless chosen
-- (any day of it is taken as the month).
create or replace function public.issue_advance(
  p_teacher_id uuid,
  p_amount integer,
  p_issued_on date default null,
  p_month date default null,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issued date := coalesce(p_issued_on, public.bishkek_today());
  v_id uuid;
begin
  perform public.assert_payroll_staff();
  if not exists (select 1 from public.teachers t where t.id = p_teacher_id) then
    raise exception 'teacher % not found', p_teacher_id using errcode = 'foreign_key_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  insert into public.payroll_adjustments (teacher_id, month, kind, amount, issued_on, comment, created_by)
  values (p_teacher_id, date_trunc('month', coalesce(p_month, v_issued))::date, 'advance', p_amount,
          v_issued, nullif(btrim(coalesce(p_comment, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- A mistaken entry: deleted with a reason (in audit_log), only while its month is open (guard).
create or replace function public.delete_payroll_adjustment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_payroll_staff();
  if v_reason is null then
    raise exception 'reason is required' using errcode = 'check_violation';
  end if;
  perform set_config('iqup.audit_reason', v_reason, true);
  delete from public.payroll_adjustments a where a.id = p_id;
  if not found then
    perform set_config('iqup.audit_reason', '', true);
    raise exception 'payroll adjustment % not found', p_id using errcode = 'no_data_found';
  end if;
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke all on function public.issue_advance(uuid, integer, date, date, text) from public, anon;
grant execute on function public.issue_advance(uuid, integer, date, date, text) to authenticated;
revoke all on function public.delete_payroll_adjustment(uuid, text) from public, anon;
grant execute on function public.delete_payroll_adjustment(uuid, text) to authenticated;

-- ─── v_payroll_preview: + advances, to_pay ──────────────────────────────────

-- Same accrual as 0020 (lessons.teacher_id, priced by subscription). A teacher with advances but no
-- held lessons in the month gets a row with zeros. advances — Σ kind = advance; to_pay = base − advances
-- (negative — overpaid). Same rules as calcMonth() + toPay() in src/features/payroll/calc.ts —
-- tests/integration/payroll.test.ts.
create or replace view public.v_payroll_preview
with (security_invoker = true)
as
with held as (
  select
    l.teacher_id,
    date_trunc('month', l.lesson_date)::date as month,
    l.duration_min,
    m.student_lessons,
    m.no_subscription,
    m.amount
  from public.lessons l
  left join lateral (
    select r.percent
    from public.teacher_rates r
    where r.teacher_id = l.teacher_id and r.valid_from <= l.lesson_date
    order by r.valid_from desc
    limit 1
  ) r on true
  cross join lateral (
    select
      count(*)::integer as student_lessons,
      (count(*) - count(s.id))::integer as no_subscription,
      sum(s.price_full * r.percent / (s.lessons_total * 100.0)) as amount
    from public.attendance a
    left join public.subscriptions s on s.id = a.subscription_id
    where a.lesson_id = l.id and a.consumes_credit
  ) m
  where l.status = 'held'
),
accrued as (
  select
    h.teacher_id,
    h.month,
    count(*)::integer as lessons_held,
    round(sum(h.duration_min) / 60.0, 2) as hours,
    sum(h.student_lessons)::integer as student_lessons,
    round(coalesce(sum(h.amount), 0))::integer as base_amount,
    sum(h.no_subscription)::integer as no_subscription
  from held h
  group by h.teacher_id, h.month
),
adjusted as (
  select
    a.teacher_id,
    a.month,
    (coalesce(sum(a.amount) filter (where a.kind = 'advance'), 0))::integer as advances
  from public.payroll_adjustments a
  group by a.teacher_id, a.month
)
select
  coalesce(ac.teacher_id, ad.teacher_id) as teacher_id,
  coalesce(ac.month, ad.month) as month,
  coalesce(ac.lessons_held, 0) as lessons_held,
  coalesce(ac.hours, 0) as hours,
  coalesce(ac.student_lessons, 0) as student_lessons,
  coalesce(ac.base_amount, 0) as base_amount,
  coalesce(ac.no_subscription, 0) as no_subscription,
  coalesce(ad.advances, 0) as advances,
  coalesce(ac.base_amount, 0) - coalesce(ad.advances, 0) as to_pay
from accrued ac
full join adjusted ad on ad.teacher_id = ac.teacher_id and ad.month = ac.month;

comment on view public.v_payroll_preview is
  'Preliminary payroll per teacher (lessons.teacher_id) and month: accrual priced by subscription, advances, to_pay = base − advances (#83). Same rules as src/features/payroll/calc.ts.';

revoke all on public.v_payroll_preview from anon;

-- ─── journal ────────────────────────────────────────────────────────────────

-- А10: advances are money — the «Оплаты» chip; search by the teacher's name. Same as 0019 otherwise.
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
    when p_entity in ('subscriptions', 'payments', 'payroll_adjustments')
      then 'payment'
    when p_entity = 'lessons' and p_action = 'update'
         and p_before ->> 'status' = 'planned' and p_after ->> 'status' = 'held'
      then 'attendance'
    else 'other'
  end
$$;

-- Only the new entity's rows (none before this migration) need the stored kind recomputed.
update public.audit_log set entity = entity where entity = 'payroll_adjustments';

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
    when 'teacher_rates', 'payroll_adjustments' then
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
