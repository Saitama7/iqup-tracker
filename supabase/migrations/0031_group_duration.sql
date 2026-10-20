-- #100 · Своя длительность занятий у группы (Сб/Вс по 1,5 часа) — приоритет над тарифом. Docs:
-- 05-decisions И88, 01-domain-model GROUP.
--
-- groups.lesson_duration_min (null — as in the tariff) wins over tariffs.lesson_duration_min for the
-- lessons the database creates: generate_lessons (create_group, reschedule_group, set_group_start,
-- ensure_lessons), generate_lessons_on (a holiday removed) and create_extra_lesson — all through
-- group_lesson_duration(group, date). Lessons that exist keep their duration_min; set_group_duration
-- (admin) changes the group's value and the planned lessons from a date — held and cancelled ones and a
-- closed period are never touched. Payroll does not depend on the length (А1 — per student per lesson).
-- After-school (afterschool) has no group length: hours come from the student's plan (И58).
-- Production-safe: a nullable column (every existing group follows its tariff as before), replaced
-- functions keep their signatures except create_group (+ p_duration_min default null).

-- ─── groups.lesson_duration_min ─────────────────────────────────────────────

alter table public.groups
  add column lesson_duration_min integer
    check (lesson_duration_min between 15 and 600),
  add constraint groups_afterschool_duration_check
    check (lesson_duration_min is null or group_type <> 'afterschool');

comment on column public.groups.lesson_duration_min is
  'Lesson length of the group, minutes (#100, И88); null — the tariff''s lesson_duration_min. New lessons only; set_group_duration moves the planned ones.';

-- The journal: the group's length (set_group_duration) next to start_date / teacher_id (0020).
drop trigger if exists audit_log on public.groups;
create trigger audit_log after update of start_date, teacher_id, lesson_duration_min on public.groups
for each row when (
  old.start_date is distinct from new.start_date
  or old.teacher_id is distinct from new.teacher_id
  or old.lesson_duration_min is distinct from new.lesson_duration_min
)
execute function public.write_audit_log();

-- ─── group_lesson_duration ──────────────────────────────────────────────────

-- Length of a new lesson of the group on a date: the group's own, else the tariff's on that date
-- (null — no tariff in effect yet, no lesson is generated).
create or replace function public.group_lesson_duration(p_group_id uuid, p_date date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(g.lesson_duration_min, public.tariff_duration(g.group_type, p_date))
  from public.groups g
  where g.id = p_group_id;
$$;

revoke execute on function public.group_lesson_duration(uuid, date) from public, anon, authenticated;

-- ─── generate_lessons (0008) ────────────────────────────────────────────────

-- Same as 0008; the length — group_lesson_duration.
create or replace function public.generate_lessons(p_group_id uuid, p_until date)
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
  priced as (
    select s.lesson_date, s.start_time,
      coalesce(v_group.lesson_duration_min, public.tariff_duration(v_group.group_type, s.lesson_date))
        as duration_min,
      public.tariff_duration(v_group.group_type, s.lesson_date) as tariff_min
    from slots s
  ),
  inserted as (
    insert into public.lessons (group_id, lesson_date, planned_start, duration_min)
    select p_group_id, p.lesson_date, p.start_time, p.duration_min
    from priced p
    -- no tariff on that date yet → no lesson (it would have no price); generated once a tariff exists
    where p.tariff_min is not null
    on conflict (group_id, lesson_date, planned_start) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  return v_created;
end;
$$;

-- ─── generate_lessons_on (0028) ─────────────────────────────────────────────

-- Same as 0028; the length — the group's own, else the tariff's.
create or replace function public.generate_lessons_on(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  with slots as (
    select g.id as group_id, g.group_type, g.lesson_duration_min, r.start_time
    from public.groups g
    join public.schedule_rules r on r.group_id = g.id
    where g.status in ('forming', 'active')
      and g.start_date <= p_day and (g.end_date is null or g.end_date >= p_day)
      and r.valid_from <= p_day and (r.valid_to is null or r.valid_to >= p_day)
      and r.weekday = extract(isodow from p_day)::integer
      and not exists (select 1 from public.holidays h where h.day = p_day)
  ),
  inserted as (
    insert into public.lessons (group_id, lesson_date, planned_start, duration_min)
    select s.group_id, p_day, s.start_time,
      coalesce(s.lesson_duration_min, public.tariff_duration(s.group_type, p_day))
    from slots s
    where public.tariff_duration(s.group_type, p_day) is not null
    on conflict (group_id, lesson_date, planned_start) do nothing
    returning 1
  )
  select count(*)::integer into v_created from inserted;
  return v_created;
end;
$$;

revoke execute on function public.generate_lessons_on(date) from public, anon, authenticated;

-- ─── create_extra_lesson (0020) ─────────────────────────────────────────────

-- Same as 0020; the length — group_lesson_duration (a tariff is still required on the date).
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

  if public.tariff_duration(v_group.group_type, p_date) is null then
    raise exception 'no tariff for % on %', v_group.group_type, p_date using errcode = 'check_violation';
  end if;
  v_duration := public.group_lesson_duration(p_group_id, p_date);

  insert into public.lessons (group_id, lesson_date, planned_start, duration_min, is_extra, makes_up_for_lesson_id)
  values (p_group_id, p_date, p_start, v_duration, true, p_makes_up_for)
  returning id into v_id;
  return v_id;
end;
$$;

-- ─── create_group (0013) + p_duration_min ───────────────────────────────────

drop function public.create_group(
  text, uuid, integer, public.group_type, uuid, integer[], time, date, text, date
);

-- «Новая группа» (А3): as 0013, plus the group's own lesson length (null — as in the tariff).
create function public.create_group(
  p_name text,
  p_subject_id uuid,
  p_grade integer,
  p_group_type public.group_type,
  p_teacher_id uuid,
  p_weekdays integer[],
  p_start_time time,
  p_start_date date,
  p_room text,
  p_until date,
  p_duration_min integer default null
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
  if p_duration_min is not null then
    if p_group_type = 'afterschool' then
      raise exception 'an after-school group has no lesson duration' using errcode = 'check_violation';
    end if;
    if p_duration_min not between 15 and 600 then
      raise exception 'lesson duration % is out of 15…600', p_duration_min using errcode = 'check_violation';
    end if;
  end if;

  insert into public.groups (name, subject_id, grade, group_type, teacher_id, start_date, room,
                             lesson_duration_min)
  values (trim(p_name), p_subject_id, p_grade, p_group_type, p_teacher_id, p_start_date,
          nullif(trim(coalesce(p_room, '')), ''), p_duration_min)
  returning id into v_group_id;

  insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
  select v_group_id, w, p_start_time, p_start_date
  from (select distinct unnest(p_weekdays) as w) d;

  return query select v_group_id, public.generate_lessons(v_group_id, p_until);
end;
$$;

revoke execute on function
  public.create_group(text, uuid, integer, public.group_type, uuid, integer[], time, date, text, date, integer)
  from public, anon;
grant execute on function
  public.create_group(text, uuid, integer, public.group_type, uuid, integer[], time, date, text, date, integer)
  to authenticated;

-- ─── set_group_duration ─────────────────────────────────────────────────────

-- «Длительность занятий» (А4 «Изменить группу»): the group's length (null — back to the tariff) and
-- the planned lessons of the group from p_from get it (each by its date when it follows the tariff).
-- Held and cancelled lessons keep theirs; a closed period — refused; after-school — refused.
-- Journal: the groups row with reason «set_group_duration:<from>:<before>:<after>» (minutes in effect
-- on p_from) and a lessons row per changed lesson. Returns the number of lessons changed.
create or replace function public.set_group_duration(p_group_id uuid, p_minutes integer, p_from date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_before integer;
  v_after integer;
  v_changed integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may change the lesson duration' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  if v_group.group_type = 'afterschool' then
    raise exception 'an after-school group has no lesson duration' using errcode = 'check_violation';
  end if;
  if p_from is null then
    raise exception 'duration change date is required' using errcode = 'check_violation';
  end if;
  if p_minutes is not null and p_minutes not between 15 and 600 then
    raise exception 'lesson duration % is out of 15…600', p_minutes using errcode = 'check_violation';
  end if;
  if public.payroll_month_closed(p_from) or exists (
    select 1 from public.lessons l
    where l.group_id = p_group_id and l.lesson_date >= p_from and l.status = 'planned' and l.is_locked
  ) then
    raise exception 'lessons from % are in a closed period', p_from using errcode = 'check_violation';
  end if;

  v_before := coalesce(v_group.lesson_duration_min, public.tariff_duration(v_group.group_type, p_from));
  v_after := coalesce(p_minutes, public.tariff_duration(v_group.group_type, p_from));

  perform set_config('iqup.audit_reason',
    'set_group_duration:' || p_from::text || ':' || coalesce(v_before::text, '') || ':'
      || coalesce(v_after::text, ''),
    true);

  update public.groups set lesson_duration_min = p_minutes where id = p_group_id;

  with changed as (
    update public.lessons l
    set duration_min = d.minutes
    from (
      select l2.id, public.group_lesson_duration(p_group_id, l2.lesson_date) as minutes
      from public.lessons l2
      where l2.group_id = p_group_id and l2.status = 'planned' and l2.lesson_date >= p_from
    ) d
    where l.id = d.id and d.minutes is not null and l.duration_min <> d.minutes
    returning 1
  )
  select count(*)::integer into v_changed from changed;

  perform set_config('iqup.audit_reason', '', true);
  return v_changed;
end;
$$;

revoke execute on function public.set_group_duration(uuid, integer, date) from public, anon;
grant execute on function public.set_group_duration(uuid, integer, date) to authenticated;
