-- 0002 — after a lesson is held, only an admin may change its attendance (docs/05-decisions.md Б, R1-8 #12).
-- Teachers mark attendance while the lesson is planned; confirming (status → held) may follow in the same transaction.

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

create index on public.enrollments (student_id);
