-- Issue #12: confirm_lesson (0010) — «Провести занятие». Self-contained fixtures, rolled back.
begin;
select plan(35);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: a…1 teacher A (group A), a…2 teacher B (group B), a…3 admin
insert into auth.users (id, email) values
  ('ac000000-0000-4000-8000-000000000001', 'teacher12a@test.local'),
  ('ac000000-0000-4000-8000-000000000002', 'teacher12b@test.local'),
  ('ac000000-0000-4000-8000-000000000003', 'admin12@test.local');

insert into public.teachers (id, full_name, phone) values
  ('bc000000-0000-4000-8000-000000000001', 'Teacher A', '996000001201'),
  ('bc000000-0000-4000-8000-000000000002', 'Teacher B', '996000001202');
insert into public.profiles (id, phone, full_name, roles) values
  ('ac000000-0000-4000-8000-000000000001', '996000001201', 'Teacher A', '{teacher}'),
  ('ac000000-0000-4000-8000-000000000002', '996000001202', 'Teacher B', '{teacher}'),
  ('ac000000-0000-4000-8000-000000000003', '996000001203', 'Admin', '{admin}');

insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from)
values ('cc000000-0000-4000-8000-000000000001', 'mini', 12, 3200, 4, 60, 2, '1990-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('dc000000-0000-4000-8000-000000000001', 'Group A', (select id from public.subjects where name = 'Математика'), 8, 'mini', 'bc000000-0000-4000-8000-000000000001', '2000-01-01', 'active'),
  ('dc000000-0000-4000-8000-000000000002', 'Group B', (select id from public.subjects where name = 'Химия'), 9, 'mini', 'bc000000-0000-4000-8000-000000000002', '2000-01-01', 'active');

-- S1 — 2 freezes used; S2 — first subscription used up, a second one waits; S3 — only an exhausted one;
-- S4 — left the group before the lessons (not on the roster); S5 — group B
insert into public.students (id, full_name) values
  ('ec000000-0000-4000-8000-000000000001', 'S1'),
  ('ec000000-0000-4000-8000-000000000002', 'S2'),
  ('ec000000-0000-4000-8000-000000000003', 'S3'),
  ('ec000000-0000-4000-8000-000000000004', 'S4'),
  ('ec000000-0000-4000-8000-000000000005', 'S5');

insert into public.enrollments (id, student_id, group_id, start_date, end_date, status) values
  ('fc000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', '2000-01-01', null, 'active'),
  ('fc000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000001', '2000-01-01', null, 'active'),
  ('fc000000-0000-4000-8000-000000000003', 'ec000000-0000-4000-8000-000000000003', 'dc000000-0000-4000-8000-000000000001', '2000-01-01', null, 'active'),
  ('fc000000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000004', 'dc000000-0000-4000-8000-000000000001', '2000-01-01', public.bishkek_today() - 10, 'finished'),
  ('fc000000-0000-4000-8000-000000000005', 'ec000000-0000-4000-8000-000000000005', 'dc000000-0000-4000-8000-000000000002', '2000-01-01', null, 'active');

insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('1c000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 12, 3200, 3200, '2000-01-01'),
  ('1c000000-0000-4000-8000-000000000021', 'fc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001', 1, 3200, 3200, '2000-01-01'),
  ('1c000000-0000-4000-8000-000000000022', 'fc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001', 12, 3200, 3200, '2000-02-01'),
  ('1c000000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000001', 1, 3200, 3200, '2000-01-01'),
  ('1c000000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000004', 'cc000000-0000-4000-8000-000000000001', 12, 3200, 3200, '2000-01-01'),
  ('1c000000-0000-4000-8000-000000000005', 'fc000000-0000-4000-8000-000000000005', 'cc000000-0000-4000-8000-000000000001', 12, 3200, 3200, '2000-01-01');

-- …01, …02: held earlier (S1 froze twice, S2 / S3 used their one-lesson subscriptions)
-- …11–…13: group A, past days; …14: today 00:00 (already started); …15: next week; …16 cancelled; …17 locked
-- …21: group B, yesterday
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min, status) values
  ('2c000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 6, '09:00', 60, 'held'),
  ('2c000000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 5, '09:00', 60, 'held'),
  ('2c000000-0000-4000-8000-000000000011', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 3, '09:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000012', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 2, '09:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000013', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 1, '09:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000014', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today(), '00:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000015', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() + 7, '09:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000016', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 4, '09:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000017', 'dc000000-0000-4000-8000-000000000001', public.bishkek_today() - 4, '12:00', 60, 'planned'),
  ('2c000000-0000-4000-8000-000000000021', 'dc000000-0000-4000-8000-000000000002', public.bishkek_today() - 1, '09:00', 60, 'planned');

insert into public.attendance (lesson_id, student_id, subscription_id, status) values
  ('2c000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'absent_frozen'),
  ('2c000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'absent_frozen'),
  ('2c000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000021', 'present'),
  ('2c000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', '1c000000-0000-4000-8000-000000000003', 'present'),
  -- a draft for a student who has left: dropped on confirmation
  ('2c000000-0000-4000-8000-000000000014', 'ec000000-0000-4000-8000-000000000004', '1c000000-0000-4000-8000-000000000004', 'present');

select public.cancel_lesson('2c000000-0000-4000-8000-000000000016', 'center');
update public.lessons set is_locked = true where id = '2c000000-0000-4000-8000-000000000017';

-- marks of the whole roster (S1–S3)
create function pg_temp.marks(s1 text, s2 text, s3 text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('student_id', 'ec000000-0000-4000-8000-000000000001', 'status', s1),
    jsonb_build_object('student_id', 'ec000000-0000-4000-8000-000000000002', 'status', s2),
    jsonb_build_object('student_id', 'ec000000-0000-4000-8000-000000000003', 'status', s3)
  );
$$;
grant execute on function pg_temp.marks(text, text, text) to authenticated;

-- ─── Grants ─────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.confirm_lesson(uuid, jsonb)', 'execute'),
  'anon cannot call confirm_lesson'
);
select ok(
  not has_function_privilege('authenticated', 'public.attendance_subscription(uuid, uuid)', 'execute'),
  'attendance_subscription is internal'
);

-- ─── Teacher A ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select throws_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000021',
       '[{"student_id":"ec000000-0000-4000-8000-000000000005","status":"present"}]') $$,
  '42501', null, 'teacher cannot confirm a lesson of another teacher''s group'
);

-- the roster must be marked exactly
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000011',
       '[{"student_id":"ec000000-0000-4000-8000-000000000001","status":"present"},
         {"student_id":"ec000000-0000-4000-8000-000000000002","status":"present"}]') $$,
  '%ec000000-0000-4000-8000-000000000003 is not marked%', 'every enrolled student must be marked'
);
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000011',
       pg_temp.marks('present', 'present', 'present')
       || '[{"student_id":"ec000000-0000-4000-8000-000000000004","status":"present"}]') $$,
  '%is not enrolled in the group%', 'a student who left the group is not on the roster'
);
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000011',
       pg_temp.marks('present', 'present', 'present')
       || '[{"student_id":"ec000000-0000-4000-8000-000000000001","status":"absent_burned"}]') $$,
  '%is marked twice%', 'a student cannot be marked twice'
);
select throws_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000011', pg_temp.marks('present', 'late', 'present')) $$,
  '23514', null, 'unknown status is rejected'
);
select throws_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000011', '{"a":1}') $$,
  '23514', null, 'marks must be an array'
);

-- lesson state
select throws_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000015', pg_temp.marks('present', 'present', 'present')) $$,
  '23514', 'lesson has not started yet', 'teacher cannot confirm a lesson that has not started'
);
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000016', pg_temp.marks('present', 'present', 'present')) $$,
  '%is cancelled%', 'a cancelled lesson cannot be confirmed'
);
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000017', pg_temp.marks('present', 'present', 'present')) $$,
  '%closed period%', 'a locked lesson cannot be confirmed'
);

-- third freeze on S1's subscription: the whole call rolls back
select throws_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000013', pg_temp.marks('absent_frozen', 'present', 'present')) $$,
  '23514', null, 'third freeze on a subscription fails the confirmation'
);
select is(
  (select status::text from public.lessons where id = '2c000000-0000-4000-8000-000000000013'),
  'planned',
  'after the failed freeze the lesson stays planned'
);
select is_empty(
  $$ select 1 from public.attendance where lesson_id = '2c000000-0000-4000-8000-000000000013' $$,
  'after the failed freeze no marks are saved'
);

-- yesterday, confirmed today: late
select isnt(
  public.confirm_lesson('2c000000-0000-4000-8000-000000000013', pg_temp.marks('present', 'present', 'absent_burned')),
  null,
  'teacher confirms own lesson, confirmed_at returned'
);
select ok(
  (select status = 'held' and confirmed_at is not null and confirmed_late
          and confirmed_by = 'ac000000-0000-4000-8000-000000000001'
   from public.lessons where id = '2c000000-0000-4000-8000-000000000013'),
  'held, confirmed_at / confirmed_by by the database, confirmed_late for a past day'
);
select results_eq(
  $$ select student_id, status::text, consumes_credit, marked_by from public.attendance
     where lesson_id = '2c000000-0000-4000-8000-000000000013' order by student_id $$,
  $$ values
     ('ec000000-0000-4000-8000-000000000001'::uuid, 'present', true, 'ac000000-0000-4000-8000-000000000001'::uuid),
     ('ec000000-0000-4000-8000-000000000002'::uuid, 'present', true, 'ac000000-0000-4000-8000-000000000001'::uuid),
     ('ec000000-0000-4000-8000-000000000003'::uuid, 'absent_burned', true, 'ac000000-0000-4000-8000-000000000001'::uuid) $$,
  'one mark per student; consumes_credit for present and absent_burned (invariant 5)'
);
select results_eq(
  $$ select student_id, subscription_id from public.attendance
     where lesson_id = '2c000000-0000-4000-8000-000000000013' order by student_id $$,
  $$ values
     ('ec000000-0000-4000-8000-000000000001'::uuid, '1c000000-0000-4000-8000-000000000001'::uuid),
     ('ec000000-0000-4000-8000-000000000002'::uuid, '1c000000-0000-4000-8000-000000000022'::uuid),
     ('ec000000-0000-4000-8000-000000000003'::uuid, '1c000000-0000-4000-8000-000000000003'::uuid) $$,
  'subscription: active with lessons left, else the next active one, else the last one «в долг»'
);
select results_eq(
  $$ select subscription_id, lessons_left from public.v_subscription_balances
     where student_id in ('ec000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000003')
     order by subscription_id $$,
  $$ values
     ('1c000000-0000-4000-8000-000000000003'::uuid, -1),
     ('1c000000-0000-4000-8000-000000000021'::uuid, 0),
     ('1c000000-0000-4000-8000-000000000022'::uuid, 11) $$,
  'balances: S2 moved on to the second subscription, S3 owes one lesson'
);

select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000013', pg_temp.marks('present', 'present', 'present')) $$,
  '%already confirmed%', 'a second confirmation fails'
);
select is(
  (select count(*) from public.attendance where lesson_id = '2c000000-0000-4000-8000-000000000013' and status = 'absent_burned'),
  1::bigint,
  'the second confirmation changed nothing'
);

-- today: not late; a draft of a student who left is dropped
select lives_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000014', pg_temp.marks('present', 'absent_burned', 'present')) $$,
  'teacher confirms today''s lesson'
);
select ok(
  (select status = 'held' and not confirmed_late from public.lessons where id = '2c000000-0000-4000-8000-000000000014'),
  'confirmed_late is false on the lesson day'
);
select results_eq(
  $$ select student_id from public.attendance where lesson_id = '2c000000-0000-4000-8000-000000000014' order by student_id $$,
  $$ values ('ec000000-0000-4000-8000-000000000001'::uuid), ('ec000000-0000-4000-8000-000000000002'::uuid), ('ec000000-0000-4000-8000-000000000003'::uuid) $$,
  'marks of students outside the roster are removed'
);

-- empty marks for a group that has students
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000012', '[]') $$,
  '%is not marked%', 'empty marks for a group with students fail'
);

-- ─── Teacher B / admin ──────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select lives_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000021',
       '[{"student_id":"ec000000-0000-4000-8000-000000000005","status":"absent_frozen","note":"предупредил"}]') $$,
  'teacher B confirms own lesson (extra keys in a mark are ignored)'
);

-- create_extra_lesson (0010): the group's teacher, today or later
select lives_ok(
  $$ select public.create_extra_lesson('dc000000-0000-4000-8000-000000000002', public.bishkek_today(), '20:00') $$,
  'teacher B adds an extra lesson to own group today'
);
select throws_ok(
  $$ select public.create_extra_lesson('dc000000-0000-4000-8000-000000000001', public.bishkek_today(), '20:00') $$,
  '42501', null, 'teacher B cannot add an extra lesson to another group'
);
select throws_like(
  $$ select public.create_extra_lesson('dc000000-0000-4000-8000-000000000002', public.bishkek_today() - 1, '20:00') $$,
  '%in the past%', 'a teacher cannot add an extra lesson in the past'
);

set local request.jwt.claims = '{"sub":"ac000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000012', pg_temp.marks('absent_burned', 'present', 'present')) $$,
  'admin confirms a lesson of any group'
);
select is(
  (select confirmed_by from public.lessons where id = '2c000000-0000-4000-8000-000000000012'),
  'ac000000-0000-4000-8000-000000000003'::uuid,
  'confirmed_by is the admin'
);
select throws_like(
  $$ select public.confirm_lesson('2c000000-0000-4000-8000-000000000012', pg_temp.marks('present', 'present', 'present')) $$,
  '%already confirmed%', 'admin cannot confirm twice either'
);

-- ─── Audit log ──────────────────────────────────────────────────────────────
reset role;
set local request.jwt.claims = '';
select ok(
  exists (
    select 1 from public.audit_log
    where entity = 'lessons' and entity_id = '2c000000-0000-4000-8000-000000000013'
      and action = 'update' and actor_id = 'ac000000-0000-4000-8000-000000000001'
      and before ->> 'status' = 'planned' and after ->> 'status' = 'held'
      and reason = 'confirm_lesson'
  ),
  'audit_log records the confirmation (planned → held) with reason confirm_lesson'
);
select is(
  (select count(*) from public.audit_log
   where entity = 'attendance' and action = 'insert' and reason = 'confirm_lesson'
     and after ->> 'lesson_id' = '2c000000-0000-4000-8000-000000000013'),
  3::bigint,
  'audit_log records every mark of the confirmation'
);
select ok(
  exists (
    select 1 from public.audit_log
    where entity = 'attendance' and action = 'delete' and reason = 'confirm_lesson'
      and before ->> 'student_id' = 'ec000000-0000-4000-8000-000000000004'
  ),
  'audit_log records the dropped draft'
);

select * from finish();
rollback;
