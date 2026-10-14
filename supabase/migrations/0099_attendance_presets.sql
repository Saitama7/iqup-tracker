-- #84 · Заморозка заранее от администратора («Предупредил о пропуске»).
-- The student warned the center before the lesson (В2) → the admin sets «Заморозка» for a planned
-- lesson of today or later, with an optional comment. It is not a mark: attendance is written only by
-- confirm_lesson after the lesson is held (И19, attendance_guard), so a preset lives in its own table
-- and touches neither the balance nor the payroll until the lesson is confirmed.
-- 1. attendance_presets (lesson, student, status = absent_frozen, comment, who, when) — admin only,
--    through set_attendance_preset / clear_attendance_preset; the lesson's teacher reads presets of
--    own lessons (prefilled «Заморозка · Админ: предупредил» on У3/УД2), staff read all.
--    The freeze limit (В2: freeze_limit per subscription) is checked already here: frozen marks of the
--    subscription + presets of other planned lessons charged to it.
-- 2. confirm_lesson: same as 0020, plus a roster student without a mark in p_marks gets the preset
--    («Заморозка») by default; an explicit mark wins (the student came after all).
-- 3. audit_log trigger + audit_search_text case (invariant 4).
-- Safe on production data: new table / functions / policies / triggers, create or replace of
-- confirm_lesson (same signature, same behaviour when there are no presets) and audit_search_text
-- (same body + one case); nothing existing is changed or deleted; re-running the file is a no-op.

-- ─── 1. attendance_presets ──────────────────────────────────────────────────

create table if not exists public.attendance_presets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  -- only «Заморозка» for now; the column keeps the shape of a mark
  status public.attendance_status not null default 'absent_frozen' check (status = 'absent_frozen'),
  comment text check (comment is null or length(comment) between 1 and 500),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (lesson_id, student_id)
);
comment on table public.attendance_presets is
  'Admin''s «Заморозка» set before the lesson (#84). Not a mark: confirm_lesson takes it as the default.';
create index if not exists attendance_presets_student_idx on public.attendance_presets (student_id);

-- Insert / update: an admin (or the service role), a planned lesson of today or later outside a closed
-- period, the student enrolled on its date, the freeze limit of the subscription. Author and time —
-- from the database. Delete: only while the lesson is planned (a held lesson keeps its history);
-- a deleted lesson takes its presets along.
create or replace function public.attendance_presets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_sub uuid;
  v_limit integer;
  v_used integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may set a freeze in advance' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    select * into v_lesson from public.lessons l where l.id = old.lesson_id;
    if found and v_lesson.status <> 'planned' then
      raise exception 'lesson % is not planned — the preset stays', old.lesson_id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into v_lesson from public.lessons l where l.id = new.lesson_id;
  if not found then
    raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
  end if;
  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', new.lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'planned' then
    raise exception 'lesson % is not planned', new.lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.lesson_date < public.bishkek_today() then
    raise exception 'lesson % is in the past', new.lesson_id using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.lesson_id <> old.lesson_id or new.student_id <> old.student_id) then
    raise exception 'a preset cannot move to another lesson or student' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.group_id = v_lesson.group_id and e.student_id = new.student_id
      and e.start_date <= v_lesson.lesson_date
      and (e.end_date >= v_lesson.lesson_date or (e.end_date is null and e.status = 'active'))
  ) then
    raise exception 'student % is not enrolled in the group on %', new.student_id, v_lesson.lesson_date
      using errcode = 'check_violation';
  end if;

  -- В2: frozen marks of the subscription this lesson goes to + presets of other planned lessons that
  -- go to the same one. Same message as enforce_freeze_limit (0001) — the client maps it.
  v_sub := public.attendance_subscription(new.lesson_id, new.student_id);
  if v_sub is not null then
    select t.freeze_limit into v_limit
    from public.subscriptions s
    join public.tariffs t on t.id = s.tariff_id
    where s.id = v_sub
    for update of s;

    select
      (select count(*) from public.attendance a
       where a.subscription_id = v_sub and a.status = 'absent_frozen' and a.lesson_id <> new.lesson_id)
      + (select count(*) from public.attendance_presets p
         join public.lessons l on l.id = p.lesson_id
         where p.student_id = new.student_id
           and p.lesson_id <> new.lesson_id
           and l.status = 'planned'
           and public.attendance_subscription(p.lesson_id, p.student_id) = v_sub)
    into v_used;

    if v_used >= v_limit then
      raise exception 'freeze limit (%) exceeded for subscription %', v_limit, v_sub
        using errcode = 'check_violation', hint = 'mark as absent_burned';
    end if;
  end if;

  new.status := 'absent_frozen';
  new.comment := nullif(btrim(new.comment), '');
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_presets_guard on public.attendance_presets;
create trigger attendance_presets_guard
before insert or update or delete on public.attendance_presets
for each row execute function public.attendance_presets_guard();

drop trigger if exists audit_log on public.attendance_presets;
create trigger audit_log after insert or update or delete on public.attendance_presets
for each row execute function public.write_audit_log();

alter table public.attendance_presets enable row level security;

drop policy if exists attendance_presets_select on public.attendance_presets;
create policy attendance_presets_select on public.attendance_presets
  for select to authenticated
  using (public.is_staff() or public.teaches_lesson(lesson_id));
-- no insert / update / delete policies: writes go through the admin RPCs below

revoke all on public.attendance_presets from anon;

-- «Предупредил о пропуске»: sets (or re-comments) the preset; returns its id.
create or replace function public.set_attendance_preset(
  p_lesson_id uuid,
  p_student_id uuid,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may set a freeze in advance' using errcode = 'insufficient_privilege';
  end if;
  if p_comment is not null and length(btrim(p_comment)) > 500 then
    raise exception 'comment is longer than 500 characters' using errcode = 'check_violation';
  end if;
  insert into public.attendance_presets (lesson_id, student_id, comment)
  values (p_lesson_id, p_student_id, p_comment)
  on conflict (lesson_id, student_id) do update set comment = excluded.comment
  returning id into v_id;
  return v_id;
end;
$$;

-- «Снять»: removes the preset of a planned lesson; false — there was none.
create or replace function public.clear_attendance_preset(p_lesson_id uuid, p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may remove a freeze set in advance' using errcode = 'insufficient_privilege';
  end if;
  delete from public.attendance_presets p where p.lesson_id = p_lesson_id and p.student_id = p_student_id;
  return found;
end;
$$;

revoke execute on function
  public.attendance_presets_guard(),
  public.set_attendance_preset(uuid, uuid, text),
  public.clear_attendance_preset(uuid, uuid)
from public, anon;
revoke execute on function public.attendance_presets_guard() from authenticated;
grant execute on function
  public.set_attendance_preset(uuid, uuid, text),
  public.clear_attendance_preset(uuid, uuid)
to authenticated;

-- ─── 2. confirm_lesson: the preset is the default mark ──────────────────────

-- Same as 0020; a roster student missing from p_marks gets the preset's status instead of
-- «student … is not marked». Presets of students outside the roster are ignored.
create or replace function public.confirm_lesson(p_lesson_id uuid, p_marks jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_marks jsonb;
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

  -- #84: the admin's «Заморозка» set in advance for whoever is left unmarked.
  v_marks := p_marks || coalesce((
    select jsonb_agg(jsonb_build_object('student_id', p.student_id, 'status', p.status))
    from public.attendance_presets p
    where p.lesson_id = p_lesson_id
      and p.student_id = any (v_roster)
      and p.student_id <> all (v_seen)
  ), '[]'::jsonb);
  v_seen := v_seen || array(
    select p.student_id from public.attendance_presets p
    where p.lesson_id = p_lesson_id and p.student_id = any (v_roster) and p.student_id <> all (v_seen)
  );

  select r into v_missing from unnest(v_roster) r where r <> all (v_seen) limit 1;
  if v_missing is not null then
    raise exception 'student % is not marked', v_missing using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'confirm_lesson', true);

  delete from public.attendance a
  where a.lesson_id = p_lesson_id and a.student_id <> all (v_seen);

  for v_mark in select * from jsonb_array_elements(v_marks) loop
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

grant execute on function public.confirm_lesson(uuid, jsonb) to authenticated;

-- ─── 3. journal search: presets by student and group ────────────────────────

-- Same as 0021 plus attendance_presets.
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
    when 'attendance', 'attendance_presets' then
      v_student := (p_row ->> 'student_id')::uuid;
      select l.group_id into v_group from public.lessons l where l.id = (p_row ->> 'lesson_id')::uuid;
    when 'attendance_correction_requests' then
      v_teacher := (p_row ->> 'teacher_id')::uuid;
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

-- ─── realtime: the teacher's sheet follows the admin's preset ───────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_presets'
  ) then
    alter publication supabase_realtime add table public.attendance_presets;
  end if;
end;
$$;
