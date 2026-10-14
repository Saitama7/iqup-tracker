-- #73 · Откат ошибок админа (внесение сентября задним числом на проде).
-- 1. lessons.teacher_id — the teacher the lesson is paid to (was: groups.teacher_id at read time, so a
--    new group teacher took over the payroll of every past lesson). Backfilled from groups.teacher_id,
--    filled by lessons_guard on insert (generation, extra lessons, set_group_start…). Payroll
--    (v_payroll_preview), «Сегодня», «Мой месяц» and the teacher's access to a lesson go by it.
-- 2. Teacher access: teaches_lesson() — lessons.teacher_id is mine; teaches_group() — I lead the group
--    now or have taught a lesson of it (its roster stays visible for my past lessons); leads_group() —
--    I lead it now (extra lessons). lessons / trials policies, confirm_lesson, create_extra_lesson.
-- 3. RPCs (admin only, journal via audit triggers, closed periods untouched):
--    remove_enrollment / transfer_enrollment (+ enrollment_undo_info), change_group_teacher
--    (+ change_group_teacher_preview), delete_group (+ group_delete_blockers).
-- Safe on production data: nothing is deleted by the migration, the backfill only fills nulls,
-- signatures of existing functions are unchanged; re-running the file is a no-op.

-- ─── 1. lessons.teacher_id ──────────────────────────────────────────────────

alter table public.lessons add column if not exists teacher_id uuid references public.teachers (id);
comment on column public.lessons.teacher_id is
  'Teacher paid for the lesson (payroll, «Мой месяц», teacher access). Set from groups.teacher_id on insert; change_group_teacher moves it from a date.';

-- lessons_guard: same as 0001, plus teacher_id on insert.
create or replace function public.lessons_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mutable constant text[] := array['status', 'comment', 'confirmed_at', 'confirmed_by', 'confirmed_late'];
begin
  if tg_op = 'DELETE' then
    if old.is_locked then
      raise exception 'lesson % is in a closed period', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- payroll owner (0020): the group's teacher; an admin / service role may name another one
    if new.teacher_id is null or (auth.uid() is not null and not public.is_admin()) then
      select g.teacher_id into new.teacher_id from public.groups g where g.id = new.group_id;
    end if;
    new.is_locked := false;
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.confirmed_late := false;
    if new.status = 'held' then
      new.confirmed_at := now();
      new.confirmed_by := auth.uid();
      new.confirmed_late := new.lesson_date <> public.bishkek_today();
    end if;
    return new;
  end if;

  -- UPDATE
  if old.is_locked then
    -- Only an admin may reopen a period, and only by flipping is_locked (design Б1б).
    if public.is_admin() and not new.is_locked
       and (to_jsonb(new) - 'is_locked') = (to_jsonb(old) - 'is_locked') then
      return new;
    end if;
    raise exception 'lesson % is in a closed period', old.id using errcode = 'check_violation';
  end if;

  if old.confirmed_at is not null then
    if new.confirmed_at is distinct from old.confirmed_at
       or new.confirmed_by is distinct from old.confirmed_by
       or new.confirmed_late is distinct from old.confirmed_late then
      raise exception 'confirmed_at of lesson % cannot be changed', old.id using errcode = 'check_violation';
    end if;
  elsif new.status = 'held' then
    -- First confirmation: DB time only, client values are ignored.
    new.confirmed_at := now();
    new.confirmed_by := auth.uid();
    new.confirmed_late := new.lesson_date <> public.bishkek_today();
  else
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.confirmed_late := false;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    -- Teacher (RLS already limits updates to admin/teacher): planned → held and comment only (matrix §5).
    -- Service role / migrations (no auth.uid()) are not restricted here.
    if (to_jsonb(new) - v_mutable) <> (to_jsonb(old) - v_mutable) then
      raise exception 'teacher may change only status and comment' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> old.status and not (old.status = 'planned' and new.status = 'held') then
      raise exception 'teacher may only mark a planned lesson as held' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'held' and old.status = 'planned'
       and now() < ((new.lesson_date + new.planned_start) at time zone 'Asia/Bishkek') then
      raise exception 'lesson has not started yet' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;


-- Backfill without lessons_guard (a closed lesson cannot be updated) and without a journal row per
-- lesson: this is a schema change, not an edit. Only nulls are filled.
alter table public.lessons disable trigger lessons_guard;
alter table public.lessons disable trigger audit_log;
update public.lessons l
set teacher_id = g.teacher_id
from public.groups g
where g.id = l.group_id and l.teacher_id is null;
alter table public.lessons enable trigger lessons_guard;
alter table public.lessons enable trigger audit_log;

alter table public.lessons alter column teacher_id set not null;
create index if not exists lessons_teacher_date_idx on public.lessons (teacher_id, lesson_date);

-- ─── 2. teacher access ──────────────────────────────────────────────────────

-- I lead the group now.
create or replace function public.leads_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    join public.teachers t on t.id = g.teacher_id
    where g.id = p_group_id and t.user_id = auth.uid()
  );
$$;

-- I lead the group now or have taught a lesson of it (group, roster, balances of my lessons).
create or replace function public.teaches_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.leads_group(p_group_id) or exists (
    select 1
    from public.lessons l
    join public.teachers t on t.id = l.teacher_id
    where l.group_id = p_group_id and t.user_id = auth.uid()
  );
$$;

-- The lesson is mine (lessons.teacher_id), whoever leads the group now.
create or replace function public.teaches_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lessons l
    join public.teachers t on t.id = l.teacher_id
    where l.id = p_lesson_id and t.user_id = auth.uid()
  );
$$;

revoke execute on function public.leads_group(uuid) from public, anon;
grant execute on function public.leads_group(uuid) to authenticated;

drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select to authenticated
  using (teacher_id = public.current_teacher_id() or public.is_staff());
drop policy if exists lessons_insert on public.lessons;
create policy lessons_insert on public.lessons for insert to authenticated
  with check (
    public.is_admin()
    or (public.leads_group(group_id) and is_extra and status = 'planned')
  );
drop policy if exists lessons_update on public.lessons;
create policy lessons_update on public.lessons for update to authenticated
  using (public.is_admin() or teacher_id = public.current_teacher_id())
  with check (public.is_admin() or teacher_id = public.current_teacher_id());

drop policy if exists trials_select on public.trials;
create policy trials_select on public.trials for select to authenticated
  using (public.teaches_lesson(lesson_id) or public.is_staff());
drop policy if exists trials_teacher_mark on public.trials;
create policy trials_teacher_mark on public.trials for update to authenticated
  using (public.teaches_lesson(lesson_id)) with check (public.teaches_lesson(lesson_id));

-- confirm_lesson: same as 0010, the lesson's teacher instead of the group's.
create or replace function public.confirm_lesson(p_lesson_id uuid, p_marks jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_mark jsonb;
  v_student uuid;
  v_status public.attendance_status;
  v_roster uuid[];
  v_seen uuid[] := '{}';
  v_missing uuid;
  v_confirmed_at timestamptz;
begin
  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;

  if auth.uid() is not null and not public.is_admin() and not public.teaches_lesson(p_lesson_id) then
    raise exception 'only the lesson''s teacher or an admin may confirm a lesson'
      using errcode = 'insufficient_privilege';
  end if;

  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status = 'held' then
    raise exception 'lesson % is already confirmed', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'planned' then
    raise exception 'lesson % is cancelled', p_lesson_id using errcode = 'check_violation';
  end if;

  if p_marks is null or jsonb_typeof(p_marks) <> 'array' then
    raise exception 'marks must be a json array' using errcode = 'check_violation';
  end if;

  -- Enrolled on the lesson date; an enrollment finished without end_date is not.
  v_roster := array(
    select distinct e.student_id
    from public.enrollments e
    where e.group_id = v_lesson.group_id
      and e.start_date <= v_lesson.lesson_date
      and (e.end_date >= v_lesson.lesson_date or (e.end_date is null and e.status = 'active'))
  );

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    begin
      v_student := (v_mark ->> 'student_id')::uuid;
      v_status := (v_mark ->> 'status')::public.attendance_status;
    exception when invalid_text_representation then
      raise exception 'invalid mark %', v_mark using errcode = 'check_violation';
    end;
    if v_student is null or v_status is null then
      raise exception 'invalid mark %', v_mark using errcode = 'check_violation';
    end if;
    if v_student = any (v_seen) then
      raise exception 'student % is marked twice', v_student using errcode = 'check_violation';
    end if;
    if not v_student = any (v_roster) then
      raise exception 'student % is not enrolled in the group on %', v_student, v_lesson.lesson_date
        using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_student;
  end loop;

  select r into v_missing from unnest(v_roster) r where r <> all (v_seen) limit 1;
  if v_missing is not null then
    raise exception 'student % is not marked', v_missing using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'confirm_lesson', true);

  delete from public.attendance a
  where a.lesson_id = p_lesson_id and a.student_id <> all (v_seen);

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    v_student := (v_mark ->> 'student_id')::uuid;
    v_status := (v_mark ->> 'status')::public.attendance_status;
    insert into public.attendance (lesson_id, student_id, subscription_id, status)
    values (p_lesson_id, v_student, public.attendance_subscription(p_lesson_id, v_student), v_status)
    on conflict (lesson_id, student_id) do update
      set status = excluded.status, subscription_id = excluded.subscription_id;
  end loop;

  update public.lessons set status = 'held' where id = p_lesson_id
  returning confirmed_at into v_confirmed_at;

  perform set_config('iqup.audit_reason', '', true);
  return v_confirmed_at;
end;
$$;

-- create_extra_lesson: same as 0010, the group's current teacher (leads_group).
create or replace function public.create_extra_lesson(
  p_group_id uuid,
  p_date date,
  p_start time,
  p_makes_up_for uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_duration integer;
  v_id uuid;
  v_teacher boolean := auth.uid() is not null and not public.is_admin();
begin
  if v_teacher and not public.leads_group(p_group_id) then
    raise exception 'only an admin or the group''s teacher may add an extra lesson'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_group from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  if p_date is null or p_start is null then
    raise exception 'date and time are required' using errcode = 'check_violation';
  end if;
  if p_date < v_group.start_date or (v_group.end_date is not null and p_date > v_group.end_date) then
    raise exception 'extra lesson is outside the group dates' using errcode = 'check_violation';
  end if;
  if v_teacher and p_date < public.bishkek_today() then
    raise exception 'extra lesson in the past' using errcode = 'check_violation';
  end if;

  if p_makes_up_for is not null then
    if not exists (
      select 1 from public.lessons l
      where l.id = p_makes_up_for and l.group_id = p_group_id and l.status = 'cancelled'
    ) then
      raise exception 'an extra lesson makes up a cancelled lesson of the same group'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.lessons l where l.makes_up_for_lesson_id = p_makes_up_for) then
      raise exception 'lesson % is already made up', p_makes_up_for using errcode = 'unique_violation';
    end if;
  end if;

  v_duration := public.tariff_duration(v_group.group_type, p_date);
  if v_duration is null then
    raise exception 'no tariff for % on %', v_group.group_type, p_date using errcode = 'check_violation';
  end if;

  insert into public.lessons (group_id, lesson_date, planned_start, duration_min, is_extra, makes_up_for_lesson_id)
  values (p_group_id, p_date, p_start, v_duration, true, p_makes_up_for)
  returning id into v_id;
  return v_id;
end;
$$;

-- trials_guard: same as 0018, plus the undo of an enrollment made from a trial.
create or replace function public.trials_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_student public.students%rowtype;
  v_teacher_cols constant text[] := array['status', 'came', 'marked_at', 'marked_by'];
  v_backdated boolean := false;
begin
  -- remove_enrollment (0020): the enrollment made from this trial was a mistake — enrolled → attended,
  -- nothing else changes. The flag is set only inside that admin RPC, for that enrollment.
  if tg_op = 'UPDATE' and old.status = 'enrolled' and new.status = 'attended' and new.enrollment_id is null
     and current_setting('iqup.undo_enrollment', true) = old.enrollment_id::text
     and (to_jsonb(new) - array['status', 'enrollment_id'])
         = (to_jsonb(old) - array['status', 'enrollment_id']) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('attended', 'no_show') then
      -- «Уже был(а)»: the admin books and marks at once (a teacher never inserts: RLS + this check).
      if auth.uid() is not null and not public.is_admin() then
        raise exception 'only an admin books a trial after the fact' using errcode = 'insufficient_privilege';
      end if;
      v_backdated := true;
    elsif new.status <> 'scheduled' then
      raise exception 'a trial starts as scheduled' using errcode = 'check_violation';
    end if;
    new.came := null;
    new.marked_at := null;
    new.marked_by := null;
    new.enrollment_id := null;
    new.created_by := auth.uid();
    new.created_at := now();

    if new.student_id is not null then
      select * into v_student from public.students s where s.id = new.student_id;
      if not found then
        raise exception 'student % not found', new.student_id using errcode = 'foreign_key_violation';
      end if;
      new.full_name := v_student.full_name;
      new.grade := coalesce(new.grade, v_student.grade);
      new.parent_phone := coalesce(new.parent_phone, v_student.parent_phone);
    end if;
  else
    if old.status in ('enrolled', 'closed') then
      raise exception 'trial % is already decided', old.id using errcode = 'check_violation';
    end if;
    if new.id <> old.id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at then
      raise exception 'trial identity cannot be changed' using errcode = 'check_violation';
    end if;
    if new.student_id is distinct from old.student_id and new.status <> 'enrolled' then
      raise exception 'trial student changes only on enrollment' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_lesson from public.lessons l where l.id = new.lesson_id;
  if not found then
    raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
  end if;
  new.group_id := v_lesson.group_id;

  if tg_op = 'INSERT' or new.lesson_id <> old.lesson_id then
    if v_backdated then
      -- after the fact: the lesson took place (or takes place today) — planned or held, not cancelled
      if v_lesson.status = 'cancelled' then
        raise exception 'the lesson was cancelled' using errcode = 'check_violation';
      end if;
      if v_lesson.lesson_date > public.bishkek_today() then
        raise exception 'the trial lesson is not today yet' using errcode = 'check_violation';
      end if;
      new.came := new.status = 'attended';
      new.marked_at := now();
      new.marked_by := auth.uid();
    else
      -- On insert and on «Перенести» / «Записать заново» — a planned lesson, today or later.
      if new.status <> 'scheduled' then
        raise exception 'a trial moves to another lesson only as scheduled' using errcode = 'check_violation';
      end if;
      if v_lesson.status <> 'planned' or v_lesson.lesson_date < public.bishkek_today() then
        raise exception 'a trial is booked on a planned lesson today or later' using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from public.groups g where g.id = v_lesson.group_id and g.status = 'archived') then
      raise exception 'group % is archived', v_lesson.group_id using errcode = 'check_violation';
    end if;
    if new.student_id is not null and exists (
      select 1 from public.enrollments e
      where e.student_id = new.student_id and e.group_id = v_lesson.group_id and e.status = 'active'
    ) then
      raise exception 'student is already enrolled in this group' using errcode = 'unique_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'scheduled' and new.status in ('attended', 'no_show', 'closed'))
      or (old.status = 'attended' and new.status in ('no_show', 'enrolled', 'closed'))
      or (old.status = 'no_show' and new.status in ('attended', 'scheduled', 'closed'))
    ) then
      raise exception 'trial cannot go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'scheduled' and new.lesson_id = old.lesson_id then
      raise exception 'book the trial on another lesson' using errcode = 'check_violation';
    end if;
    if new.status in ('attended', 'no_show') then
      if v_lesson.status = 'cancelled' then
        raise exception 'the lesson was cancelled' using errcode = 'check_violation';
      end if;
      if v_lesson.lesson_date > public.bishkek_today() then
        raise exception 'the trial lesson is not today yet' using errcode = 'check_violation';
      end if;
      new.came := new.status = 'attended';
      new.marked_at := now();
      new.marked_by := auth.uid();
    elsif new.status = 'scheduled' then
      new.came := null;
      new.marked_at := null;
      new.marked_by := null;
    else
      -- enrolled / closed keep the teacher's mark for the funnel
      new.came := old.came;
      new.marked_at := old.marked_at;
      new.marked_by := old.marked_by;
    end if;
  elsif tg_op = 'UPDATE' then
    new.came := old.came;
    new.marked_at := old.marked_at;
    new.marked_by := old.marked_by;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    -- Teacher (RLS: own groups): «Был / Не пришёл» only — Ж3.
    if (to_jsonb(new) - v_teacher_cols) <> (to_jsonb(old) - v_teacher_cols) then
      raise exception 'teacher may only mark a trial' using errcode = 'insufficient_privilege';
    end if;
    if new.status not in ('attended', 'no_show') then
      raise exception 'teacher may only mark a trial as attended or no_show' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.trials_guard() from public, anon, authenticated;

-- ─── v_payroll_preview: by lessons.teacher_id ───────────────────────────────

-- Same as 0012, the teacher is the lesson's (lessons.teacher_id), not the group's current one.
-- Same rules as calcMonth() in src/features/payroll/calc.ts — tests/integration/payroll.test.ts.
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
)
select
  h.teacher_id,
  h.month,
  count(*)::integer as lessons_held,
  round(sum(h.duration_min) / 60.0, 2) as hours,
  sum(h.student_lessons)::integer as student_lessons,
  round(coalesce(sum(h.amount), 0))::integer as base_amount,
  sum(h.no_subscription)::integer as no_subscription
from held h
group by h.teacher_id, h.month;

comment on view public.v_payroll_preview is
  'Preliminary payroll per teacher (lessons.teacher_id) and month (R1-9, R2: priced by subscription). Same rules as src/features/payroll/calc.ts.';

revoke all on public.v_payroll_preview from anon;

-- ─── journal: groups ────────────────────────────────────────────────────────

-- 0017 audited start_date only; now also the teacher (change_group_teacher) and deletion (delete_group).
drop trigger if exists audit_log on public.groups;
create trigger audit_log after update of start_date, teacher_id on public.groups
for each row when (old.start_date is distinct from new.start_date or old.teacher_id is distinct from new.teacher_id)
execute function public.write_audit_log();
drop trigger if exists audit_log_delete on public.groups;
create trigger audit_log_delete after delete on public.groups
for each row execute function public.write_audit_log();

-- ─── 3a. enrollment: remove / transfer ──────────────────────────────────────

-- Marks of an enrollment: charged to its subscriptions, or in its group within its dates.
create or replace function public.enrollment_attendance(p_enrollment_id uuid)
returns setof public.attendance
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.enrollments e
  join public.lessons l on l.group_id = e.group_id
  join public.attendance a on a.lesson_id = l.id and a.student_id = e.student_id
  where e.id = p_enrollment_id
    and (
      a.subscription_id in (select s.id from public.subscriptions s where s.enrollment_id = e.id)
      or (l.lesson_date >= e.start_date and (e.end_date is null or l.lesson_date <= e.end_date))
    );
$$;

-- What removing / moving an enrollment would touch (the confirmation screen on А6 / А4).
create or replace function public.enrollment_undo_info(p_enrollment_id uuid)
returns table (
  present_marks integer,
  burned_marks integer,
  frozen_marks integer,
  locked_marks integer,
  subscriptions integer,
  payments integer,
  paid_total integer,
  trial_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.enrollments e where e.id = p_enrollment_id) then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;

  return query
  select
    (select count(*)::integer from public.enrollment_attendance(p_enrollment_id) a where a.status = 'present'),
    (select count(*)::integer from public.enrollment_attendance(p_enrollment_id) a where a.status = 'absent_burned'),
    (select count(*)::integer from public.enrollment_attendance(p_enrollment_id) a where a.status = 'absent_frozen'),
    (select count(*)::integer from public.enrollment_attendance(p_enrollment_id) a
       join public.lessons l on l.id = a.lesson_id where l.is_locked),
    (select count(*)::integer from public.subscriptions s where s.enrollment_id = p_enrollment_id),
    (select count(*)::integer from public.payments p
       join public.subscriptions s on s.id = p.subscription_id where s.enrollment_id = p_enrollment_id),
    (select coalesce(sum(p.amount), 0)::integer from public.payments p
       join public.subscriptions s on s.id = p.subscription_id where s.enrollment_id = p_enrollment_id),
    (select t.id from public.trials t where t.enrollment_id = p_enrollment_id limit 1);
end;
$$;

-- Shared refusals of remove / transfer: «был» or «сгорело» (written off, paid to the teacher) and
-- marks in a closed period.
create or replace function public.assert_enrollment_undoable(p_enrollment_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a where a.consumes_credit
  ) then
    raise exception 'the enrollment has present or burned marks — finish it instead'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
    where l.is_locked
  ) then
    raise exception 'the enrollment has marks in a closed period' using errcode = 'check_violation';
  end if;
end;
$$;

-- «Убрать из группы» — an enrollment made by mistake: the enrollment, its subscriptions and its
-- «заморожен» marks are deleted. Refused with «был» / «сгорело», with payments (they are immutable,
-- И41 — transfer_enrollment instead) and with marks in a closed period. An enrollment made from a
-- trial returns the trial to «был на пробном».
create or replace function public.remove_enrollment(p_enrollment_id uuid)
returns table (marks_deleted integer, subscriptions_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marks integer;
  v_subs integer;
begin
  perform public.assert_admin();

  perform 1 from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  perform public.assert_enrollment_undoable(p_enrollment_id);
  if exists (
    select 1 from public.payments p
    join public.subscriptions s on s.id = p.subscription_id
    where s.enrollment_id = p_enrollment_id
  ) then
    raise exception 'the enrollment has payments — transfer it to another group or refund'
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'remove_enrollment', true);

  with gone as (
    delete from public.attendance a
    where a.id in (select m.id from public.enrollment_attendance(p_enrollment_id) m)
    returning 1
  )
  select count(*) into v_marks from gone;

  perform set_config('iqup.undo_enrollment', p_enrollment_id::text, true);
  update public.trials t set status = 'attended', enrollment_id = null
  where t.enrollment_id = p_enrollment_id;
  perform set_config('iqup.undo_enrollment', '', true);

  with gone as (
    delete from public.subscriptions s where s.enrollment_id = p_enrollment_id returning 1
  )
  select count(*) into v_subs from gone;

  delete from public.enrollments e where e.id = p_enrollment_id;

  perform set_config('iqup.audit_reason', '', true);
  return query select v_marks, v_subs;
end;
$$;

-- «Перевести в другую группу» — the enrollment with its subscriptions and payments moves to a group
-- of the same type (same tariff, so the price paid stays right); another type is refused — refund
-- first. Start: p_start_date or the later of the enrollment start and the group start; the
-- subscription that started with the enrollment follows. «Заморожен» marks of the old group are
-- deleted; «был» / «сгорело» and closed periods refuse, as in remove_enrollment.
create or replace function public.transfer_enrollment(
  p_enrollment_id uuid,
  p_group_id uuid,
  p_start_date date default null
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_from public.groups%rowtype;
  v_to public.groups%rowtype;
  v_start date;
begin
  perform public.assert_admin();

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  select * into v_to from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_to.id = v_enrollment.group_id then
    raise exception 'the enrollment is already in this group' using errcode = 'check_violation';
  end if;
  if v_to.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  select * into v_from from public.groups g where g.id = v_enrollment.group_id;
  if v_to.group_type <> v_from.group_type then
    raise exception 'the target group has another type — refund first' using errcode = 'check_violation';
  end if;

  perform public.assert_enrollment_undoable(p_enrollment_id);

  v_start := coalesce(p_start_date, greatest(v_enrollment.start_date, v_to.start_date));
  if v_start < v_to.start_date or (v_to.end_date is not null and v_start > v_to.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;
  if v_enrollment.end_date is not null and v_start > v_enrollment.end_date then
    raise exception 'start date is after the enrollment end' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_enrollment.student_id
      and e.group_id = p_group_id
      and e.start_date <= coalesce(v_enrollment.end_date, 'infinity'::date)
      and coalesce(e.end_date, 'infinity'::date) >= v_start
  ) then
    raise exception 'the student is already enrolled in the target group on these dates'
      using errcode = 'unique_violation';
  end if;

  perform set_config('iqup.audit_reason', 'transfer_enrollment', true);

  delete from public.attendance a
  where a.id in (select m.id from public.enrollment_attendance(p_enrollment_id) m);

  update public.enrollments set group_id = p_group_id, start_date = v_start where id = p_enrollment_id;
  update public.subscriptions s
  set started_at = v_start
  where s.enrollment_id = p_enrollment_id and s.started_at = v_enrollment.start_date;

  perform set_config('iqup.audit_reason', '', true);
  return v_start;
end;
$$;

-- ─── 3b. change_group_teacher ───────────────────────────────────────────────

-- Lessons of the group from p_from (default: the group start) that would move to another teacher.
create or replace function public.change_group_teacher_preview(
  p_group_id uuid,
  p_teacher_id uuid,
  p_from date default null
)
returns table (lessons_total integer, lessons_held integer, lessons_locked integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
begin
  perform public.assert_admin();
  select coalesce(p_from, g.start_date) into v_from from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;

  return query
  select
    count(*) filter (where not l.is_locked)::integer,
    count(*) filter (where not l.is_locked and l.status = 'held')::integer,
    count(*) filter (where l.is_locked)::integer
  from public.lessons l
  where l.group_id = p_group_id and l.lesson_date >= v_from
    and l.teacher_id is distinct from p_teacher_id;
end;
$$;

-- «Изменить группу» → «Учитель» + «С какой даты»: every lesson of the group from p_from (planned,
-- held, cancelled) goes to the new teacher — the payroll of the held ones follows — and the group's
-- teacher becomes the new one (later lessons are generated for them). Lessons before p_from keep
-- their teacher. Refused while a lesson from p_from is in a closed period (invariant 2).
-- Journal: the groups row (reason change_group_teacher:<from>) and one lessons row per moved lesson.
create or replace function public.change_group_teacher(
  p_group_id uuid,
  p_teacher_id uuid,
  p_from date default null
)
returns table (lessons_moved integer, lessons_held integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_from date;
  v_moved integer;
  v_held integer;
begin
  perform public.assert_admin();

  select * into v_group from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if p_teacher_id is null or not exists (select 1 from public.teachers t where t.id = p_teacher_id) then
    raise exception 'teacher % not found', p_teacher_id using errcode = 'foreign_key_violation';
  end if;
  v_from := coalesce(p_from, v_group.start_date);

  if exists (
    select 1 from public.lessons l
    where l.group_id = p_group_id and l.lesson_date >= v_from and l.is_locked
      and l.teacher_id is distinct from p_teacher_id
  ) then
    raise exception 'lessons from % are in a closed period', v_from using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'change_group_teacher:' || v_from::text, true);

  with moved as (
    update public.lessons l
    set teacher_id = p_teacher_id
    where l.group_id = p_group_id and l.lesson_date >= v_from and l.teacher_id is distinct from p_teacher_id
    returning l.status
  )
  select count(*)::integer, count(*) filter (where status = 'held')::integer
  into v_moved, v_held
  from moved;

  if v_group.teacher_id is distinct from p_teacher_id then
    update public.groups set teacher_id = p_teacher_id where id = p_group_id;
  end if;

  perform set_config('iqup.audit_reason', '', true);
  return query select v_moved, v_held;
end;
$$;

-- ─── 3c. delete_group ───────────────────────────────────────────────────────

-- Why a group cannot be deleted (empty — it can): marks, enrollments, trials, payments, closed lessons.
create or replace function public.group_delete_blockers(p_group_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reasons text[] := '{}';
begin
  perform public.assert_admin();
  if not exists (select 1 from public.groups g where g.id = p_group_id) then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from public.attendance a join public.lessons l on l.id = a.lesson_id
    where l.group_id = p_group_id
  ) then
    v_reasons := v_reasons || 'marks';
  end if;
  if exists (select 1 from public.enrollments e where e.group_id = p_group_id) then
    v_reasons := v_reasons || 'enrollments';
  end if;
  if exists (select 1 from public.trials t where t.group_id = p_group_id) then
    v_reasons := v_reasons || 'trials';
  end if;
  if exists (
    select 1 from public.payments p
    join public.subscriptions s on s.id = p.subscription_id
    join public.enrollments e on e.id = s.enrollment_id
    where e.group_id = p_group_id
  ) then
    v_reasons := v_reasons || 'payments';
  end if;
  if exists (select 1 from public.lessons l where l.group_id = p_group_id and l.is_locked) then
    v_reasons := v_reasons || 'locked';
  end if;
  return v_reasons;
end;
$$;

-- «Удалить группу» — a group created by mistake: the group, its schedule and its lessons (no marks
-- on them) are deleted. Refused with the reasons of group_delete_blockers — archive it instead.
create or replace function public.delete_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reasons text[];
  v_lessons integer;
begin
  perform public.assert_admin();

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  v_reasons := public.group_delete_blockers(p_group_id);
  if cardinality(v_reasons) > 0 then
    raise exception 'group cannot be deleted: %', array_to_string(v_reasons, ', ')
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'delete_group', true);
  with gone as (
    delete from public.lessons l where l.group_id = p_group_id returning 1
  )
  select count(*) into v_lessons from gone;
  delete from public.schedule_rules r where r.group_id = p_group_id;
  delete from public.groups g where g.id = p_group_id;
  perform set_config('iqup.audit_reason', '', true);

  return v_lessons;
end;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────

revoke execute on function
  public.enrollment_attendance(uuid),
  public.assert_enrollment_undoable(uuid)
from public, anon, authenticated;

revoke execute on function
  public.enrollment_undo_info(uuid),
  public.remove_enrollment(uuid),
  public.transfer_enrollment(uuid, uuid, date),
  public.change_group_teacher_preview(uuid, uuid, date),
  public.change_group_teacher(uuid, uuid, date),
  public.group_delete_blockers(uuid),
  public.delete_group(uuid)
from public, anon;

grant execute on function
  public.enrollment_undo_info(uuid),
  public.remove_enrollment(uuid),
  public.transfer_enrollment(uuid, uuid, date),
  public.change_group_teacher_preview(uuid, uuid, date),
  public.change_group_teacher(uuid, uuid, date),
  public.group_delete_blockers(uuid),
  public.delete_group(uuid)
to authenticated;
