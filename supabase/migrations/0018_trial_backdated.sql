-- #54 · Пробный задним числом (review of #53, question 2): a child came to a lesson without a booking
-- (the teacher put «+» in Excel or told the admin) — the admin books the lead on today's or an already
-- past (not cancelled) lesson right away as attended / no_show.
-- 1. trials_guard: an INSERT may start as attended / no_show — admin only, on a not cancelled lesson
--    today or earlier, the mark (came / marked_at / marked_by) is set like the teacher's «Был / Не
--    пришёл». The scheduled INSERT and every UPDATE rule stay as in 0015.
-- 2. v_audit_feed: such an insert is a correction after the fact — kind 'retro' (И32).
-- 3. enroll_trial: a lead whose name and parent phone match an existing student is that student
--    (a former pupil came back through a trial) — no duplicate students row; the discounts follow the
--    existing student (В5, 15 % to a returning one). Same phone with another name (a sibling) is a new
--    student, as before.
-- Trials still never touch attendance, subscriptions or payroll (Ж2/Ж6).

-- ─── 1. trials_guard ────────────────────────────────────────────────────────

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

-- ─── 2. v_audit_feed: a trial booked after the fact is 'retro' ──────────────

-- Same as 0014 plus one 'retro' case: trials insert with a status other than scheduled.
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
  case
    when a.entity = 'lessons' and a.action = 'update'
         and a.before ->> 'status' = 'planned' and a.after ->> 'status' = 'held'
         and coalesce((a.after ->> 'confirmed_late')::boolean, false)
      then 'late'
    when a.entity = 'attendance'
      or (a.entity = 'lessons' and a.before ->> 'status' = 'held'
          and (a.action = 'delete' or a.after ->> 'status' <> 'held'))
      or (a.entity = 'teacher_rates' and a.action <> 'insert'
          and (a.before ->> 'valid_from')::date <= (a.at at time zone 'Asia/Bishkek')::date)
      or (a.entity = 'trials' and a.action = 'insert' and a.after ->> 'status' <> 'scheduled')
      then 'retro'
    when a.entity in ('subscriptions', 'payments')
      then 'payment'
    when a.entity = 'lessons' and a.action = 'update'
         and a.before ->> 'status' = 'planned' and a.after ->> 'status' = 'held'
      then 'attendance'
    else 'other'
  end as kind,
  case
    when a.entity = 'lessons' and a.reason = 'confirm_lesson' then (
      select coalesce(jsonb_agg(m.after ->> 'status' order by m.after ->> 'status'), '[]'::jsonb)
      from public.audit_log m
      where m.entity = 'attendance'
        and m.reason = 'confirm_lesson'
        and m.at = a.at
        and m.after ->> 'lesson_id' = a.entity_id::text
    )
  end as marks
from public.audit_log a
where not (a.entity = 'attendance' and a.reason is not distinct from 'confirm_lesson');

revoke all on public.v_audit_feed from anon, authenticated;
grant select on public.v_audit_feed to authenticated;

-- ─── 3. enroll_trial: no duplicate student ──────────────────────────────────

-- Same as 0016, plus: a lead whose name (trimmed, case-insensitive) and parent phone match exactly one
-- existing student is enrolled as that student (no second students row; is_returning / В5 follow the
-- existing one). Several matches → refused, the admin books the trial as «Уже учится» instead.
create or replace function public.enroll_trial(
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
  v_matches uuid[];
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
  if v_student_id is null and v_trial.parent_phone is not null then
    select array_agg(s.id) into v_matches
    from public.students s
    where s.parent_phone = v_trial.parent_phone
      and lower(btrim(s.full_name)) = lower(btrim(v_trial.full_name));
    if cardinality(v_matches) > 1 then
      raise exception 'several students match the trial name and phone' using errcode = 'unique_violation';
    end if;
    v_student_id := v_matches[1];
  end if;
  if v_student_id is null then
    insert into public.students (full_name, grade, parent_phone, notes, referred_by_student_id)
    values (btrim(v_trial.full_name), v_trial.grade, v_trial.parent_phone,
            nullif(btrim(coalesce(v_trial.note, '')), ''), v_trial.referred_by_student_id)
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
