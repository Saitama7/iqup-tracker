-- #46 · Пробные занятия (А11 + sections on У2/У3/УД2/А1/А2/А4). Docs: 05-decisions Ж1–Ж8,
-- 01-domain-model.md TRIAL and §5.1.
--
-- A trial is a free visit of a not-yet-enrolled pupil (a lead) or of an existing student to one
-- concrete lesson of a group. It never touches attendance, subscriptions or payroll (Ж2/Ж6): there is
-- no reference from attendance / v_payroll_preview / v_subscription_balances to this table, and group
-- fill («8 / 10») counts enrollments only.
--
-- The lead's name, class and parent phone live on the trial row itself (the lead becomes a `students`
-- row only on «Оплатил → зачислить», §5.1) — the teacher reads them from here, students RLS untouched.
--
-- Status (§5.1, issue names): scheduled → attended | no_show (teacher marks, «Был / Не пришёл»);
-- no_show → scheduled («Записать заново» on another lesson) | closed («Закрыть»);
-- attended → enrolled (enroll_trial: enrollment + subscription) | closed («Отказ»);
-- scheduled → scheduled on another lesson («Перенести») | closed. enrolled / closed are final.
-- `came` keeps the teacher's mark after the decision — the «пришли → оплатили» funnel (А11).
--
-- RLS: admin writes; a teacher reads trials of own groups and marks them attended / no_show only
-- (trials_guard); accountant reads. Every change goes to audit_log (invariant 4).

create type public.trial_status as enum ('scheduled', 'attended', 'no_show', 'enrolled', 'closed');
create type public.trial_source as enum ('instagram', 'referral', '2gis', 'other');

create table public.trials (
  id uuid primary key default gen_random_uuid(),
  -- an existing student; a lead gets one on enroll_trial
  student_id uuid references public.students (id),
  full_name text not null check (length(btrim(full_name)) > 0),
  grade integer check (grade between 1 and 11),
  parent_phone text check (parent_phone ~ '^996[0-9]{9}$'),
  group_id uuid not null references public.groups (id), -- always the lesson's group (trials_guard)
  lesson_id uuid not null references public.lessons (id),
  status public.trial_status not null default 'scheduled',
  came boolean, -- teacher's mark: true «был», false «не пришёл», null not marked yet
  source public.trial_source,
  note text,
  enrollment_id uuid references public.enrollments (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  marked_at timestamptz,
  marked_by uuid references public.profiles (id),
  check ((status = 'enrolled') = (enrollment_id is not null))
);
create index on public.trials (group_id);
create index on public.trials (lesson_id);
create index on public.trials (status);
-- one person once per lesson (a double tap on «Записать на пробное»)
create unique index trials_lesson_person_key on public.trials (lesson_id, lower(btrim(full_name)));

-- ─── trials_guard ───────────────────────────────────────────────────────────

create function public.trials_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_student public.students%rowtype;
  v_teacher_cols constant text[] := array['status', 'came', 'marked_at', 'marked_by'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
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

  -- The lesson: on insert and on «Перенести» / «Записать заново» — a planned lesson, today or later.
  select * into v_lesson from public.lessons l where l.id = new.lesson_id;
  if not found then
    raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
  end if;
  new.group_id := v_lesson.group_id;

  if tg_op = 'INSERT' or new.lesson_id <> old.lesson_id then
    if new.status <> 'scheduled' then
      raise exception 'a trial moves to another lesson only as scheduled' using errcode = 'check_violation';
    end if;
    if v_lesson.status <> 'planned' or v_lesson.lesson_date < public.bishkek_today() then
      raise exception 'a trial is booked on a planned lesson today or later' using errcode = 'check_violation';
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

create trigger trials_guard
before insert or update on public.trials
for each row execute function public.trials_guard();

create trigger audit_log after insert or update or delete on public.trials
for each row execute function public.write_audit_log();

revoke execute on function public.trials_guard() from public, anon, authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.trials enable row level security;

create policy trials_select on public.trials for select to authenticated
  using (public.teaches_group(group_id) or public.is_staff());
create policy trials_admin_write on public.trials for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy trials_teacher_mark on public.trials for update to authenticated
  using (public.teaches_group(group_id)) with check (public.teaches_group(group_id));

alter publication supabase_realtime add table public.trials;

-- ─── enroll_trial («Оплатил → зачислить», Ж5) ───────────────────────────────

-- The lead becomes a student (name, class, parent phone from the trial), then enroll_student()
-- creates the enrollment and the subscription in the trial's group — same rules (tariff on the start
-- date, discounts В5). The trial lesson stays free: the subscription starts after it (§7 #17).
create function public.enroll_trial(
  p_trial_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none'
)
returns table (enrollment_id uuid, subscription_id uuid, student_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial public.trials%rowtype;
  v_lesson_date date;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_subscription_id uuid;
begin
  perform public.assert_admin();

  select * into v_trial from public.trials t where t.id = p_trial_id for update;
  if not found then
    raise exception 'trial % not found', p_trial_id using errcode = 'foreign_key_violation';
  end if;
  if v_trial.status <> 'attended' then
    raise exception 'only an attended trial can be enrolled' using errcode = 'check_violation';
  end if;

  select l.lesson_date into v_lesson_date from public.lessons l where l.id = v_trial.lesson_id;
  if p_start_date is null or p_start_date <= v_lesson_date then
    raise exception 'the subscription starts after the trial lesson' using errcode = 'check_violation';
  end if;

  v_student_id := v_trial.student_id;
  if v_student_id is null then
    insert into public.students (full_name, grade, parent_phone, notes)
    values (btrim(v_trial.full_name), v_trial.grade, v_trial.parent_phone, nullif(btrim(coalesce(v_trial.note, '')), ''))
    returning id into v_student_id;
  end if;

  select e.enrollment_id, e.subscription_id into v_enrollment_id, v_subscription_id
  from public.enroll_student(v_student_id, v_trial.group_id, p_start_date, p_discount_pct, p_discount_reason) e;

  update public.trials
  set status = 'enrolled', enrollment_id = v_enrollment_id, student_id = v_student_id
  where id = p_trial_id;

  return query select v_enrollment_id, v_subscription_id, v_student_id;
end;
$$;

revoke execute on function public.enroll_trial(uuid, date, integer, public.discount_reason) from public, anon;
grant execute on function public.enroll_trial(uuid, date, integer, public.discount_reason) to authenticated;

-- ─── reschedule_group keeps lessons with trials ─────────────────────────────

-- Same as 0008 plus one rule: a planned lesson someone is booked on for a trial is not deleted by a
-- schedule change (like a lesson with marks) — the admin moves the trial («Перенести») first.
create or replace function public.reschedule_group(
  p_group_id uuid,
  p_valid_from date,
  p_weekdays integer[],
  p_start_time time,
  p_until date
)
returns table (lessons_deleted integer, lessons_created integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_deleted integer;
begin
  perform public.assert_admin();

  select * into v_group from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  if p_valid_from is null or p_valid_from < public.bishkek_today() then
    raise exception 'a schedule change starts today or later' using errcode = 'check_violation';
  end if;
  if p_valid_from < v_group.start_date
     or (v_group.end_date is not null and p_valid_from > v_group.end_date) then
    raise exception 'schedule change is outside the group dates' using errcode = 'check_violation';
  end if;
  if p_weekdays is null or cardinality(p_weekdays) = 0
     or exists (select 1 from unnest(p_weekdays) w where w not between 1 and 7)
     or p_start_time is null then
    raise exception 'pick at least one weekday and a time' using errcode = 'check_violation';
  end if;

  delete from public.schedule_rules r
  where r.group_id = p_group_id and r.valid_from >= p_valid_from;

  update public.schedule_rules r
  set valid_to = p_valid_from - 1
  where r.group_id = p_group_id and (r.valid_to is null or r.valid_to >= p_valid_from);

  with gone as (
    delete from public.lessons l
    where l.group_id = p_group_id
      and l.status = 'planned'
      and not l.is_extra
      and l.lesson_date >= p_valid_from
      and public.lesson_starts_at(l.lesson_date, l.planned_start) > now()
      and not exists (select 1 from public.attendance a where a.lesson_id = l.id)
      and not exists (select 1 from public.trials t where t.lesson_id = l.id)
      -- a slot the new schedule keeps (same weekday and time) stays with its substitute / comment
      and not (extract(isodow from l.lesson_date)::integer = any (p_weekdays) and l.planned_start = p_start_time)
    returning 1
  )
  select count(*) into v_deleted from gone;

  insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
  select p_group_id, w, p_start_time, p_valid_from
  from (select distinct unnest(p_weekdays) as w) d;

  return query select v_deleted, public.generate_lessons(p_group_id, p_until);
end;
$$;
