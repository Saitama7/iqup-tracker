-- 0008 — группы и расписание (issue #9, А3 / А4): генерация занятий, смена расписания,
-- отмена, доп. урок, архив. Docs: 01-domain-model.md §4, 02-architecture.md §6, 05-decisions А5–А7, Б3, Б4.
--
-- Lesson slots are (group_id, lesson_date, planned_start) — unique since 0001, so generation is
-- idempotent: `on conflict do nothing` never re-creates a slot that exists in any status
-- (a cancelled lesson stays cancelled). The instant of a lesson is
-- (lesson_date + planned_start) at time zone 'Asia/Bishkek' (invariant 8).
-- duration_min comes from the group's tariff in effect on the lesson date — the same
-- «latest valid_from <= date» rule as enroll_student (0007) and tariffFor() in the client.
--
-- All functions are security definer and admin-only; calls without auth.uid() (service role,
-- seed) are allowed, anon has no execute grant.

-- ─── groups.room — «каб. 1» on А4, «Кабинет» in «Новая группа» ──────────────

alter table public.groups add column room text check (room is null or length(trim(room)) > 0);

-- ─── helpers ────────────────────────────────────────────────────────────────

create function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may manage groups and lessons' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Start instant of a lesson slot in Asia/Bishkek.
create function public.lesson_starts_at(p_date date, p_start time)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select (p_date + p_start) at time zone 'Asia/Bishkek'; $$;

-- Tariff duration of a group type on a date (null — no tariff in effect yet).
create function public.tariff_duration(p_group_type public.group_type, p_date date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select t.lesson_duration_min from public.tariffs t
  where t.group_type = p_group_type and t.valid_from <= p_date
  order by t.valid_from desc
  limit 1;
$$;

-- ─── generate_lessons ───────────────────────────────────────────────────────

-- Planned lessons of one group from its schedule_rules up to p_until (inclusive), within
-- groups.start_date / end_date and each rule's valid_from / valid_to, skipping holidays (Б4).
-- Returns the number of lessons created; a second call with the same p_until returns 0.
create function public.generate_lessons(p_group_id uuid, p_until date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_created integer;
begin
  perform public.assert_admin();

  select * into v_group from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' or p_until is null then
    return 0;
  end if;

  with slots as (
    select d::date as lesson_date, r.start_time
    from public.schedule_rules r
    cross join lateral generate_series(
      greatest(r.valid_from, v_group.start_date)::timestamp,
      least(p_until, coalesce(r.valid_to, p_until), coalesce(v_group.end_date, p_until))::timestamp,
      interval '1 day'
    ) as d
    where r.group_id = p_group_id
      and extract(isodow from d)::integer = r.weekday
      and not exists (select 1 from public.holidays h where h.day = d::date)
  ),
  inserted as (
    insert into public.lessons (group_id, lesson_date, planned_start, duration_min)
    select p_group_id, s.lesson_date, s.start_time, public.tariff_duration(v_group.group_type, s.lesson_date)
    from slots s
    -- no tariff on that date yet → no lesson (it would have no price); generated once a tariff exists
    where public.tariff_duration(v_group.group_type, s.lesson_date) is not null
    on conflict (group_id, lesson_date, planned_start) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  return v_created;
end;
$$;

-- All running groups (forming and active; archived never) — the dashboard calls it on load with
-- an 8-week horizon (R1-6), А3 on open. Returns the total number of lessons created.
create function public.ensure_lessons(p_until date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_group_id uuid;
begin
  perform public.assert_admin();
  for v_group_id in
    select g.id from public.groups g where g.status in ('forming', 'active') order by g.id
  loop
    v_total := v_total + public.generate_lessons(v_group_id, p_until);
  end loop;
  return v_total;
end;
$$;

-- ─── create_group ───────────────────────────────────────────────────────────

-- «Новая группа» (А3): group + one schedule rule per weekday (same time) + lessons up to p_until,
-- one transaction. The group starts as forming (01-domain-model §7 #14).
create function public.create_group(
  p_name text,
  p_subject text,
  p_grade integer,
  p_group_type public.group_type,
  p_teacher_id uuid,
  p_weekdays integer[],
  p_start_time time,
  p_start_date date,
  p_room text,
  p_until date
)
returns table (group_id uuid, lessons_created integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  perform public.assert_admin();

  if p_weekdays is null or cardinality(p_weekdays) = 0
     or exists (select 1 from unnest(p_weekdays) w where w not between 1 and 7) then
    raise exception 'pick at least one weekday' using errcode = 'check_violation';
  end if;
  if p_start_time is null or p_start_date is null then
    raise exception 'time and start date are required' using errcode = 'check_violation';
  end if;
  if public.tariff_duration(p_group_type, p_start_date) is null then
    raise exception 'no tariff for % on %', p_group_type, p_start_date using errcode = 'check_violation';
  end if;

  insert into public.groups (name, subject, grade, group_type, teacher_id, start_date, room)
  values (trim(p_name), trim(p_subject), p_grade, p_group_type, p_teacher_id, p_start_date,
          nullif(trim(coalesce(p_room, '')), ''))
  returning id into v_group_id;

  insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
  select v_group_id, w, p_start_time, p_start_date
  from (select distinct unnest(p_weekdays) as w) d;

  return query select v_group_id, public.generate_lessons(v_group_id, p_until);
end;
$$;

-- ─── reschedule_group ───────────────────────────────────────────────────────

-- Schedule change from p_valid_from (today or later): rules in effect are closed with
-- valid_to = p_valid_from − 1 (rules that would only start later are dropped), new rules start
-- p_valid_from; regular planned lessons from p_valid_from that have not started yet are deleted
-- and regenerated by the new rules up to p_until. Held / cancelled / extra / started lessons stay.
create function public.reschedule_group(
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
    returning 1
  )
  select count(*) into v_deleted from gone;

  insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
  select p_group_id, w, p_start_time, p_valid_from
  from (select distinct unnest(p_weekdays) as w) d;

  return query select v_deleted, public.generate_lessons(p_group_id, p_until);
end;
$$;

-- ─── cancel_lesson ──────────────────────────────────────────────────────────

-- Cancel a planned lesson: center / teacher (А6) or the whole group froze (А5.1). Not paid, no
-- credit consumed (lessons_guard / payroll count held only); made up by an extra lesson.
-- 'holiday' is for the holidays flow, not this action.
create function public.cancel_lesson(p_lesson_id uuid, p_reason public.cancel_reason, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
begin
  perform public.assert_admin();

  if p_reason is null or p_reason not in ('center', 'teacher', 'all_frozen') then
    raise exception 'cancel reason must be center, teacher or all_frozen' using errcode = 'check_violation';
  end if;

  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;
  if v_lesson.status <> 'planned' then
    raise exception 'only a planned lesson can be cancelled' using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', coalesce(nullif(trim(p_comment), ''), 'cancel: ' || p_reason), true);
  -- marks made while the lesson was planned are drafts: a cancelled lesson has no attendance
  delete from public.attendance a where a.lesson_id = p_lesson_id;
  update public.lessons
  set status = 'cancelled', cancel_reason = p_reason,
      comment = coalesce(nullif(trim(p_comment), ''), comment)
  where id = p_lesson_id;
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

-- No attendance on a cancelled lesson, for anyone (it would consume credit in v_subscription_balances).
-- Same function as 0002 plus that check.
create or replace function public.attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson_ids uuid[];
begin
  v_lesson_ids := case tg_op
    when 'INSERT' then array[new.lesson_id]
    when 'DELETE' then array[old.lesson_id]
    else array[old.lesson_id, new.lesson_id]
  end;
  if exists (select 1 from public.lessons l where l.id = any (v_lesson_ids) and l.is_locked) then
    raise exception 'attendance belongs to a closed period' using errcode = 'check_violation';
  end if;

  -- Teacher: only while the lesson is planned. Admin and service role (no auth.uid()) are not restricted.
  if auth.uid() is not null and not public.is_admin()
     and exists (select 1 from public.lessons l where l.id = any (v_lesson_ids) and l.status <> 'planned') then
    raise exception 'attendance can be changed only while the lesson is planned'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if exists (select 1 from public.lessons l where l.id = new.lesson_id and l.status = 'cancelled') then
    raise exception 'lesson % is cancelled — no attendance', new.lesson_id using errcode = 'check_violation';
  end if;

  new.marked_at := now();
  new.marked_by := auth.uid();

  if new.subscription_id is not null and not exists (
    select 1
    from public.subscriptions s
    join public.enrollments e on e.id = s.enrollment_id
    where s.id = new.subscription_id and e.student_id = new.student_id
  ) then
    raise exception 'subscription % does not belong to student %', new.subscription_id, new.student_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.attendance_guard() from public, anon, authenticated;

-- ─── create_extra_lesson ────────────────────────────────────────────────────

-- «Доп. урок» (Б3): date and time set by the admin; optionally makes up a cancelled lesson of the
-- same group (one extra lesson per cancelled one). Duration from the tariff on that date.
create function public.create_extra_lesson(
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
begin
  perform public.assert_admin();

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

-- ─── archive_group ──────────────────────────────────────────────────────────

-- «Архивировать» (А4): no more generation; future planned lessons without attendance are removed so
-- they do not show up in «Сегодня». Held / cancelled history stays.
create function public.archive_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  perform public.assert_admin();

  update public.groups set status = 'archived' where id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;

  with gone as (
    delete from public.lessons l
    where l.group_id = p_group_id
      and l.status = 'planned'
      and public.lesson_starts_at(l.lesson_date, l.planned_start) > now()
      and not exists (select 1 from public.attendance a where a.lesson_id = l.id)
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────

revoke execute on function
  public.assert_admin(),
  public.tariff_duration(public.group_type, date),
  public.generate_lessons(uuid, date),
  public.ensure_lessons(date),
  public.create_group(text, text, integer, public.group_type, uuid, integer[], time, date, text, date),
  public.reschedule_group(uuid, date, integer[], time, date),
  public.cancel_lesson(uuid, public.cancel_reason, text),
  public.create_extra_lesson(uuid, date, time, uuid),
  public.archive_group(uuid)
from public, anon;

revoke execute on function public.assert_admin(), public.tariff_duration(public.group_type, date)
from authenticated;

grant execute on function
  public.generate_lessons(uuid, date),
  public.ensure_lessons(date),
  public.create_group(text, text, integer, public.group_type, uuid, integer[], time, date, text, date),
  public.reschedule_group(uuid, date, integer[], time, date),
  public.cancel_lesson(uuid, public.cancel_reason, text),
  public.create_extra_lesson(uuid, date, time, uuid),
  public.archive_group(uuid)
to authenticated;
