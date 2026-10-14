-- #74 · Исправление отметок проведённого занятия админом + запрос учителя на исправление.
-- 1. correct_attendance(lesson, marks, reason) — admin only: changes marks of a held lesson outside a
--    closed period with a required reason (audit_log.reason). Payroll and balances are views over
--    attendance (invariant 3) — they follow by themselves; the freeze limit stays (enforce_freeze_limit).
-- 2. attendance_correction_requests — a teacher asks to fix the marks of own held lesson (proposed
--    marks + comment); the admin applies (= correct_attendance with the teacher's comment as the
--    reason) or rejects with a reason. RLS: the teacher inserts for own lessons (lessons.teacher_id,
--    0020) and reads own requests; staff read all; decisions only through the admin RPCs.
-- Safe on production data: only new objects (table, functions, policies, triggers) and
-- create or replace of audit_search_text (same body + one case); nothing existing is changed or
-- deleted; re-running the file is a no-op.

-- ─── marks of a correction ──────────────────────────────────────────────────

-- p_marks: [{"student_id": uuid, "status": "present" | "absent_frozen" | "absent_burned"}, …] — a
-- non-empty subset of the lesson: each student has a mark on it or is enrolled on its date, once.
create or replace function public.assert_correction_marks(p_lesson_id uuid, p_marks jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_mark jsonb;
  v_student uuid;
  v_status public.attendance_status;
  v_seen uuid[] := '{}';
begin
  select * into v_lesson from public.lessons l where l.id = p_lesson_id;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    raise exception 'marks must be a non-empty json array' using errcode = 'check_violation';
  end if;

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
    if not exists (
      select 1 from public.attendance a where a.lesson_id = p_lesson_id and a.student_id = v_student
    ) and not exists (
      select 1 from public.enrollments e
      where e.group_id = v_lesson.group_id and e.student_id = v_student
        and e.start_date <= v_lesson.lesson_date
        and (e.end_date >= v_lesson.lesson_date or (e.end_date is null and e.status = 'active'))
    ) then
      raise exception 'student % is not enrolled in the group on %', v_student, v_lesson.lesson_date
        using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_student;
  end loop;
end;
$$;

-- ─── 1. correct_attendance ──────────────────────────────────────────────────

-- Admin: new marks for some students of a held lesson. Unchanged marks are skipped (a repeat is a
-- no-op); returns how many marks changed. Subscription: kept, unless the mark had none or turns from
-- «заморозка» into a charged one — then picked like in confirm_lesson (attendance_subscription).
-- Journal: one attendance row per changed mark, reason = p_reason.
create or replace function public.correct_attendance(p_lesson_id uuid, p_marks jsonb, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_mark jsonb;
  v_student uuid;
  v_status public.attendance_status;
  v_old public.attendance%rowtype;
  v_changed integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may correct the marks of a held lesson'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;
  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'held' then
    raise exception 'lesson % is not held', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_reason = '' then
    raise exception 'reason is required' using errcode = 'check_violation';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = 'check_violation';
  end if;

  perform public.assert_correction_marks(p_lesson_id, p_marks);
  perform set_config('iqup.audit_reason', v_reason, true);

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

  perform set_config('iqup.audit_reason', '', true);
  return v_changed;
end;
$$;

-- ─── 2. attendance_correction_requests ──────────────────────────────────────

create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  teacher_id uuid not null default public.current_teacher_id() references public.teachers (id),
  -- proposed marks, same shape as correct_attendance: [{student_id, status}, …]
  marks jsonb not null check (jsonb_typeof(marks) = 'array' and jsonb_array_length(marks) > 0),
  comment text not null check (length(btrim(comment)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  -- why it was rejected (required then)
  decision_comment text check (decision_comment is null or length(btrim(decision_comment)) between 1 and 500),
  check ((status = 'pending') = (decided_at is null)),
  check (status <> 'rejected' or decision_comment is not null)
);
comment on table public.attendance_correction_requests is
  'Teacher asks the admin to fix the marks of own held lesson (#74). Decided only by apply_/reject_correction_request.';
create index if not exists attendance_correction_requests_lesson_idx
  on public.attendance_correction_requests (lesson_id, created_at desc);
create index if not exists attendance_correction_requests_teacher_idx
  on public.attendance_correction_requests (teacher_id);
-- one open request per lesson (a double tap, two devices)
create unique index if not exists attendance_correction_requests_pending_key
  on public.attendance_correction_requests (lesson_id) where status = 'pending';

-- Insert: pending, author and time from the database, lesson held and open, marks valid.
-- Update: only the decision (pending → approved / rejected) by an admin; the rest is frozen.
create or replace function public.attendance_correction_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_lesson from public.lessons l where l.id = new.lesson_id;
    if not found then
      raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
    end if;
    if v_lesson.is_locked then
      raise exception 'lesson % is in a closed period', new.lesson_id using errcode = 'check_violation';
    end if;
    if v_lesson.status <> 'held' then
      raise exception 'lesson % is not held', new.lesson_id using errcode = 'check_violation';
    end if;
    if auth.uid() is not null then
      if not public.teaches_lesson(new.lesson_id) then
        raise exception 'only the lesson''s teacher may ask to correct its marks'
          using errcode = 'insufficient_privilege';
      end if;
      new.teacher_id := public.current_teacher_id();
    else
      new.teacher_id := coalesce(new.teacher_id, v_lesson.teacher_id);
    end if;
    perform public.assert_correction_marks(new.lesson_id, new.marks);
    new.comment := btrim(new.comment);
    new.status := 'pending';
    new.created_by := auth.uid();
    new.created_at := now();
    new.decided_by := null;
    new.decided_at := null;
    new.decision_comment := null;
    return new;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may decide a correction request' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.lesson_id <> old.lesson_id or new.teacher_id <> old.teacher_id
     or new.marks <> old.marks or new.comment <> old.comment
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'a correction request cannot be edited' using errcode = 'check_violation';
  end if;
  if old.status <> 'pending' then
    raise exception 'correction request % is already decided', old.id using errcode = 'check_violation';
  end if;
  if new.status = 'pending' then
    raise exception 'a correction request is decided as approved or rejected' using errcode = 'check_violation';
  end if;
  new.decided_by := auth.uid();
  new.decided_at := now();
  new.decision_comment := nullif(btrim(new.decision_comment), '');
  return new;
end;
$$;

drop trigger if exists attendance_correction_requests_guard on public.attendance_correction_requests;
create trigger attendance_correction_requests_guard
before insert or update on public.attendance_correction_requests
for each row execute function public.attendance_correction_requests_guard();

drop trigger if exists audit_log on public.attendance_correction_requests;
create trigger audit_log after insert or update on public.attendance_correction_requests
for each row execute function public.write_audit_log();

alter table public.attendance_correction_requests enable row level security;

drop policy if exists attendance_correction_requests_select on public.attendance_correction_requests;
create policy attendance_correction_requests_select on public.attendance_correction_requests
  for select to authenticated
  using (teacher_id = public.current_teacher_id() or public.is_staff());
drop policy if exists attendance_correction_requests_insert on public.attendance_correction_requests;
create policy attendance_correction_requests_insert on public.attendance_correction_requests
  for insert to authenticated
  with check (public.teaches_lesson(lesson_id) and teacher_id = public.current_teacher_id());
-- no update / delete policies: decisions go through the RPCs below

revoke all on public.attendance_correction_requests from anon;

-- ─── apply / reject ─────────────────────────────────────────────────────────

-- «Применить»: the proposed marks as an admin correction, reason = the teacher's comment. Already
-- approved → 0, nothing changes (idempotent); rejected → refused.
create or replace function public.apply_correction_request(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.attendance_correction_requests%rowtype;
  v_changed integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may apply a correction request' using errcode = 'insufficient_privilege';
  end if;
  select * into v_req from public.attendance_correction_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'correction request % not found', p_request_id using errcode = 'foreign_key_violation';
  end if;
  if v_req.status = 'approved' then
    return 0;
  end if;
  if v_req.status = 'rejected' then
    raise exception 'correction request % is rejected', p_request_id using errcode = 'check_violation';
  end if;

  v_changed := public.correct_attendance(v_req.lesson_id, v_req.marks, v_req.comment);
  update public.attendance_correction_requests set status = 'approved' where id = p_request_id;
  return v_changed;
end;
$$;

-- «Отклонить» with a reason the teacher sees. Already rejected → no-op; approved → refused.
create or replace function public.reject_correction_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.attendance_correction_requests%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may reject a correction request' using errcode = 'insufficient_privilege';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason is required' using errcode = 'check_violation';
  end if;
  select * into v_req from public.attendance_correction_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'correction request % not found', p_request_id using errcode = 'foreign_key_violation';
  end if;
  if v_req.status = 'rejected' then
    return;
  end if;
  if v_req.status = 'approved' then
    raise exception 'correction request % is already approved', p_request_id using errcode = 'check_violation';
  end if;
  update public.attendance_correction_requests
  set status = 'rejected', decision_comment = btrim(p_reason)
  where id = p_request_id;
end;
$$;

revoke execute on function
  public.assert_correction_marks(uuid, jsonb),
  public.attendance_correction_requests_guard(),
  public.correct_attendance(uuid, jsonb, text),
  public.apply_correction_request(uuid),
  public.reject_correction_request(uuid, text)
from public, anon;
revoke execute on function
  public.assert_correction_marks(uuid, jsonb),
  public.attendance_correction_requests_guard()
from authenticated;
grant execute on function
  public.correct_attendance(uuid, jsonb, text),
  public.apply_correction_request(uuid),
  public.reject_correction_request(uuid, text)
to authenticated;

-- ─── journal search: requests by group and teacher ──────────────────────────

-- Same as 0019 plus attendance_correction_requests.
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

-- ─── realtime: the admin's badge and the teacher's status ───────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'attendance_correction_requests'
  ) then
    alter publication supabase_realtime add table public.attendance_correction_requests;
  end if;
end;
$$;
