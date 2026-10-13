-- #60 · Старт группы и дата зачисления задним числом (дозаполнение сентября на проде).
-- set_group_start(): groups.start_date moves earlier (schedule rules that started with the group
-- follow it, lessons of the new stretch are generated like generate_lessons does — holidays,
-- tariff duration) or later (planned lessons before the new date are removed; refused while held /
-- cancelled / closed lessons, enrollments or trials sit before it). end_date is not touched.
-- set_enrollment_start(): enrollments.start_date within the group dates and ≤ its end_date; the
-- subscription that started with the enrollment follows; refused while the enrollment has
-- attendance before the new date or another enrollment of the student in the group overlaps.
-- Journal: groups get an audit trigger for start_date only (the rest of groups is not audited yet);
-- enrollments / subscriptions / lessons are audited since 0001.

-- ─── audit: groups.start_date ───────────────────────────────────────────────

create trigger audit_log after update of start_date on public.groups
for each row when (old.start_date is distinct from new.start_date)
execute function public.write_audit_log();

-- ─── set_group_start ────────────────────────────────────────────────────────

-- Returns how many lessons were created (earlier) or removed (later).
create function public.set_group_start(p_group_id uuid, p_start_date date)
returns table (lessons_created integer, lessons_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_created integer := 0;
  v_deleted integer := 0;
begin
  perform public.assert_admin();

  select * into v_group from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  if p_start_date is null then
    raise exception 'start date is required' using errcode = 'check_violation';
  end if;
  if v_group.end_date is not null and p_start_date > v_group.end_date then
    raise exception 'group start is after the group end' using errcode = 'check_violation';
  end if;
  if p_start_date = v_group.start_date then
    return query select 0, 0;
    return;
  end if;

  if p_start_date < v_group.start_date then
    if public.tariff_duration(v_group.group_type, p_start_date) is null then
      raise exception 'no tariff for % on the group start %', v_group.group_type, p_start_date
        using errcode = 'check_violation';
    end if;

    update public.groups set start_date = p_start_date where id = p_group_id;
    -- the schedule the group started with now starts with it; later changes keep their dates
    update public.schedule_rules r
    set valid_from = p_start_date
    where r.group_id = p_group_id and r.valid_from = v_group.start_date;
    -- only the new stretch: existing slots are never duplicated (unique slot + on conflict)
    v_created := public.generate_lessons(p_group_id, v_group.start_date - 1);
  else
    if exists (
      select 1 from public.lessons l
      where l.group_id = p_group_id and l.lesson_date < p_start_date
        and (l.status <> 'planned' or l.is_locked)
    ) then
      raise exception 'there are held or cancelled lessons before the new group start'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.enrollments e
      where e.group_id = p_group_id and e.start_date < p_start_date
    ) then
      raise exception 'there are enrollments before the new group start'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.trials t
      join public.lessons l on l.id = t.lesson_id
      where l.group_id = p_group_id and l.lesson_date < p_start_date
    ) then
      raise exception 'there are trial lessons before the new group start'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.attendance a
      join public.lessons l on l.id = a.lesson_id
      where l.group_id = p_group_id and l.lesson_date < p_start_date
    ) then
      raise exception 'there are attendance marks before the new group start'
        using errcode = 'check_violation';
    end if;

    with gone as (
      delete from public.lessons l
      where l.group_id = p_group_id and l.lesson_date < p_start_date and l.status = 'planned'
      returning 1
    )
    select count(*) into v_deleted from gone;

    delete from public.schedule_rules r
    where r.group_id = p_group_id and r.valid_to is not null and r.valid_to < p_start_date;
    update public.schedule_rules r
    set valid_from = p_start_date
    where r.group_id = p_group_id and r.valid_from < p_start_date;

    update public.groups set start_date = p_start_date where id = p_group_id;
  end if;

  return query select v_created, v_deleted;
end;
$$;

-- ─── set_enrollment_start ───────────────────────────────────────────────────

create function public.set_enrollment_start(p_enrollment_id uuid, p_start_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_group public.groups%rowtype;
begin
  perform public.assert_admin();

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  if p_start_date is null then
    raise exception 'start date is required' using errcode = 'check_violation';
  end if;
  if p_start_date = v_enrollment.start_date then
    return;
  end if;

  select * into v_group from public.groups g where g.id = v_enrollment.group_id;
  if p_start_date < v_group.start_date
     or (v_group.end_date is not null and p_start_date > v_group.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;
  if v_enrollment.end_date is not null and p_start_date > v_enrollment.end_date then
    raise exception 'start date is after the enrollment end' using errcode = 'check_violation';
  end if;

  -- the same student in the same group: periods must not overlap (and unique start date)
  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_enrollment.student_id
      and e.group_id = v_enrollment.group_id
      and e.id <> v_enrollment.id
      and e.start_date <= coalesce(v_enrollment.end_date, 'infinity'::date)
      and coalesce(e.end_date, 'infinity'::date) >= p_start_date
  ) then
    raise exception 'another enrollment of the student in this group overlaps these dates'
      using errcode = 'unique_violation';
  end if;

  -- marks of this enrollment: charged to its subscriptions, or in the group since it started
  if exists (
    select 1 from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    where a.student_id = v_enrollment.student_id
      and l.group_id = v_enrollment.group_id
      and l.lesson_date < p_start_date
      and (
        l.lesson_date >= v_enrollment.start_date
        or a.subscription_id in (
          select s.id from public.subscriptions s where s.enrollment_id = v_enrollment.id
        )
      )
  ) then
    raise exception 'the enrollment has attendance before the new date' using errcode = 'check_violation';
  end if;

  update public.enrollments set start_date = p_start_date where id = p_enrollment_id;
  update public.subscriptions s
  set started_at = p_start_date
  where s.enrollment_id = p_enrollment_id and s.started_at = v_enrollment.start_date;
end;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────

revoke execute on function
  public.set_group_start(uuid, date),
  public.set_enrollment_start(uuid, date)
from public, anon;

grant execute on function
  public.set_group_start(uuid, date),
  public.set_enrollment_start(uuid, date)
to authenticated;
