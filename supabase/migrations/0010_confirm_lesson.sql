-- 0010 — «Провести занятие» (issue #12, У3 / УД2): attendance of the whole roster and the lesson → held
-- in one transaction. Docs: 01-domain-model.md §4–5, 05-decisions Б1–Б2, В1–В2, В7, И4, И5, И12.
--
-- Who: the group's teacher (groups.teacher_id = my teachers.id) or an admin; calls without auth.uid()
-- (service role) are allowed like the other RPCs, anon has no execute grant.
-- confirmed_at / confirmed_by / confirmed_late are set by lessons_guard (0001) on planned → held:
-- DB time, never edited (invariant 1); a teacher cannot hold a lesson before it starts (Б1).
-- Attendance goes through attendance_guard (locked period, cancelled lesson, subscription owner) and
-- enforce_freeze_limit (≤ freeze_limit per subscription) — any violation rolls the whole call back.

-- ─── Which subscription a mark is charged to (И5) ───────────────────────────

-- The student's subscriptions in the lesson's group, oldest first: the first active one with lessons
-- left (balance without this lesson's own mark), else the newest non-refunded one — charged «в долг»
-- (В7). Null — the student has no subscription in the group. Same rule as pickSubscription() in
-- src/features/lessons/attendance.ts (the counter «заморозок 1 / 2» on У3 reads that subscription).
create function public.attendance_subscription(p_lesson_id uuid, p_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with lesson as (
    select l.id, l.group_id from public.lessons l where l.id = p_lesson_id
  ),
  subs as (
    select
      s.id,
      s.status,
      s.started_at,
      s.created_at,
      s.lessons_total - (
        select count(*) from public.attendance a
        where a.subscription_id = s.id and a.consumes_credit and a.lesson_id <> p_lesson_id
      ) as lessons_left
    from lesson
    join public.enrollments e on e.group_id = lesson.group_id and e.student_id = p_student_id
    join public.subscriptions s on s.enrollment_id = e.id
    where s.status <> 'refunded'
  )
  select coalesce(
    (select id from subs where status = 'active' and lessons_left > 0
     order by started_at, created_at, id limit 1),
    (select id from subs order by started_at desc, created_at desc, id desc limit 1)
  );
$$;

-- ─── confirm_lesson ─────────────────────────────────────────────────────────

-- p_marks: [{"student_id": uuid, "status": "present" | "absent_frozen" | "absent_burned"}, …] — one mark
-- per student enrolled in the group on the lesson date, nobody else. Marks left on the lesson for
-- students outside that roster are drafts and are removed. Returns confirmed_at.
create function public.confirm_lesson(p_lesson_id uuid, p_marks jsonb)
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

  if auth.uid() is not null and not public.is_admin() and not public.teaches_group(v_lesson.group_id) then
    raise exception 'only the group''s teacher or an admin may confirm a lesson'
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

revoke execute on function
  public.attendance_subscription(uuid, uuid),
  public.confirm_lesson(uuid, jsonb)
from public, anon;
revoke execute on function public.attendance_subscription(uuid, uuid) from authenticated;
grant execute on function public.confirm_lesson(uuid, jsonb) to authenticated;
