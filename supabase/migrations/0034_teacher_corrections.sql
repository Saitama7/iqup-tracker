-- #110 · К10: учитель сам исправляет отметки своего проведённого занятия в открытом периоде.
-- 1. teacher_correct_attendance(lesson, marks, comment) — security definer; only the lesson's teacher
--    (lessons.teacher_id → teachers.user_id = auth.uid(), teaches_lesson 0020), not an admin (the admin
--    has correct_attendance with a required reason), a held lesson outside a closed period; the
--    comment is optional (0…500). Same logic as correct_attendance (0021): only differing marks change,
--    an unmarked student enrolled on the date gets a mark (#107), the subscription is picked like in
--    confirm_lesson, a repeat is a no-op; after-school — hours from the plan, no student with 0 h
--    (assert_correction_marks, 0025). Journal: one attendance row per changed mark, the author is the
--    teacher (auth.uid()), reason «Исправил учитель» or «Исправил учитель: <комментарий>».
-- 2. attendance_guard: a teacher changes the marks of a non-planned lesson only inside that RPC —
--    set_config('iqup.teacher_correct', 'on', true), cleared right after (the same pattern as
--    iqup.admin_edit, 0028). The closed-period wall stays for everyone.
-- attendance_correction_requests stay (И52) for the requests already sent; the UI no longer creates
-- new ones.
-- Safe on production data: one new function and create or replace of attendance_guard (same body as
-- 0008 plus the flag); nothing is changed or deleted; re-running the file is a no-op.

-- ─── 1. attendance_guard: the teacher's correction ──────────────────────────

-- Same as 0008 plus: a teacher passes the «only while planned» check inside teacher_correct_attendance.
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

  -- Teacher: only while the lesson is planned, or inside teacher_correct_attendance (#110).
  -- Admin and service role (no auth.uid()) are not restricted.
  if auth.uid() is not null and not public.is_admin()
     and coalesce(current_setting('iqup.teacher_correct', true), '') <> 'on'
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

-- ─── 2. teacher_correct_attendance ──────────────────────────────────────────

-- Teacher: new marks for some students of own held lesson. Returns how many marks changed.
create or replace function public.teacher_correct_attendance(
  p_lesson_id uuid,
  p_marks jsonb,
  p_comment text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_mark jsonb;
  v_student uuid;
  v_status public.attendance_status;
  v_old public.attendance%rowtype;
  v_changed integer := 0;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'teacher_correct_attendance is for the lesson''s teacher; an admin uses correct_attendance'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;
  if not public.teaches_lesson(p_lesson_id) then
    raise exception 'only the lesson''s teacher may correct its marks'
      using errcode = 'insufficient_privilege';
  end if;
  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'held' then
    raise exception 'lesson % is not held', p_lesson_id using errcode = 'check_violation';
  end if;
  if length(v_comment) > 500 then
    raise exception 'comment is too long' using errcode = 'check_violation';
  end if;

  perform public.assert_correction_marks(p_lesson_id, p_marks);
  perform set_config('iqup.audit_reason',
    case when v_comment = '' then 'Исправил учитель' else 'Исправил учитель: ' || v_comment end, true);
  perform set_config('iqup.teacher_correct', 'on', true);

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    v_student := (v_mark ->> 'student_id')::uuid;
    v_status := (v_mark ->> 'status')::public.attendance_status;
    select * into v_old from public.attendance a
    where a.lesson_id = p_lesson_id and a.student_id = v_student
    for update;
    if not found then
      insert into public.attendance (lesson_id, student_id, subscription_id, status)
      values (p_lesson_id, v_student, public.attendance_subscription(p_lesson_id, v_student), v_status);
      v_changed := v_changed + 1;
    elsif v_old.status <> v_status then
      update public.attendance a
      set status = v_status,
          subscription_id = case
            when a.subscription_id is null
              or (a.status = 'absent_frozen' and v_status <> 'absent_frozen')
              then coalesce(public.attendance_subscription(p_lesson_id, v_student), a.subscription_id)
            else a.subscription_id
          end
      where a.id = v_old.id;
      v_changed := v_changed + 1;
    end if;
  end loop;

  perform set_config('iqup.teacher_correct', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_changed;
end;
$$;

revoke execute on function public.teacher_correct_attendance(uuid, jsonb, text) from public, anon;
grant execute on function public.teacher_correct_attendance(uuid, jsonb, text) to authenticated;
