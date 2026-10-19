-- #94 · update_lesson / lesson_edit_payroll_impact (0028): admin only, a reason; a held lesson moves
-- (date, time, duration, teacher, substitute) only through the RPC (lessons_guard), not into the
-- future, with its students on the roster of the new date; an after-school lesson with hour marks keeps
-- its date; the preview equals the change of v_payroll_preview; the journal files it as «retro».
-- change_group_teacher still moves held lessons. Self-contained fixtures in March 2005, rolled back.
--
-- March 2005: Mondays 7, 14, 21, 28; Wednesdays 2, 9, 16, 23, 30.
begin;
select plan(27);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher A, …2 teacher B, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9420000-0000-4000-8000-000000000001', 'teacher942a@test.local'),
  ('a9420000-0000-4000-8000-000000000002', 'teacher942b@test.local'),
  ('a9420000-0000-4000-8000-000000000003', 'admin942@test.local'),
  ('a9420000-0000-4000-8000-000000000004', 'acc942@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9420000-0000-4000-8000-000000000001', 'Teacher 942 A', '996000094201'),
  ('b9420000-0000-4000-8000-000000000002', 'Teacher 942 B', '996000094202');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9420000-0000-4000-8000-000000000001', '996000094201', 'Teacher 942 A', '{teacher}'),
  ('a9420000-0000-4000-8000-000000000002', '996000094202', 'Teacher 942 B', '{teacher}'),
  ('a9420000-0000-4000-8000-000000000003', '996000094203', 'Admin 942', '{admin}'),
  ('a9420000-0000-4000-8000-000000000004', '996000094204', 'Accountant 942', '{accountant}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b9420000-0000-4000-8000-000000000001', 40, '2005-01-01'),
  ('b9420000-0000-4000-8000-000000000002', 50, '2005-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('mini', 12, 3200, 6, 60, 2, '2005-01-01', null),
  ('afterschool', 20, 7400, 8, 180, 2, '2005-01-01', 100);

-- G1 — mini, Mon / Wed 15:00 (teacher A); G2 — after-school Mon–Fri 13:00 (teacher A)
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d9420000-0000-4000-8000-000000000001', 'Group 942', (select id from public.subjects where name = 'Математика'), 8, 'mini', 'b9420000-0000-4000-8000-000000000001', '2005-03-01', 'active'),
  ('d9420000-0000-4000-8000-000000000002', 'Продлёнка 942', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b9420000-0000-4000-8000-000000000001', '2005-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from) values
  ('d9420000-0000-4000-8000-000000000001', 1, '15:00', '2005-03-01'),
  ('d9420000-0000-4000-8000-000000000001', 3, '15:00', '2005-03-01');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd9420000-0000-4000-8000-000000000002', d, '13:00', '2005-03-01' from generate_series(1, 5) d;
select public.generate_lessons('d9420000-0000-4000-8000-000000000001', '2005-03-31');
select public.generate_lessons('d9420000-0000-4000-8000-000000000002', '2005-03-31');

insert into public.students (id, full_name)
select ('e9420000-0000-4000-8000-00000000000' || n)::uuid, 'S942-' || n from generate_series(1, 4) n;

create function pg_temp.lesson(p_group int, p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = ('d9420000-0000-4000-8000-00000000000' || p_group)::uuid and lesson_date = p_date;
$$;
create function pg_temp.st(n int)
returns uuid language sql as $$ select ('e9420000-0000-4000-8000-00000000000' || n)::uuid; $$;
create function pg_temp.pay(p_teacher text)
returns integer language sql as $$
  select coalesce((select base_amount from public.v_payroll_preview
    where teacher_id = ('b9420000-0000-4000-8000-00000000000' || p_teacher)::uuid and month = '2005-03-01'), 0);
$$;
create function pg_temp.present(variadic p_students int[])
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('student_id', pg_temp.st(n), 'status', 'present')) from unnest(p_students) n;
$$;
create table pg_temp.seen (key text primary key, n integer);
grant execute on function pg_temp.lesson(int, date), pg_temp.st(int), pg_temp.pay(text), pg_temp.present(int[])
  to authenticated, anon;
grant all on pg_temp.seen to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9420000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select public.enroll_student(pg_temp.st(1), 'd9420000-0000-4000-8000-000000000001', '2005-03-01');
select public.enroll_student(pg_temp.st(2), 'd9420000-0000-4000-8000-000000000001', '2005-03-01');
select public.enroll_student(pg_temp.st(3), 'd9420000-0000-4000-8000-000000000001', '2005-03-14');
select * from public.enroll_student(pg_temp.st(4), 'd9420000-0000-4000-8000-000000000002', '2005-03-01');
-- 07.03: S1, S2; 14.03: S1, S2, S3; after-school 07.03: S4
select public.confirm_lesson(pg_temp.lesson(1, '2005-03-07'), pg_temp.present(1, 2));
select public.confirm_lesson(pg_temp.lesson(1, '2005-03-14'), pg_temp.present(1, 2, 3));
select public.confirm_lesson(pg_temp.lesson(2, '2005-03-07'), pg_temp.present(4));
select public.cancel_lesson(pg_temp.lesson(1, '2005-03-21'), 'center', null);

-- ─── Access ─────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9420000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-07'), '2005-03-08', '17:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '42501', null, 'the teacher cannot edit a lesson'
);
select throws_ok(
  $$ select * from public.lesson_edit_payroll_impact(pg_temp.lesson(1, '2005-03-07'), null, null) $$,
  '42501', null, 'the teacher cannot read the impact'
);
set local request.jwt.claims = '{"sub":"a9420000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-07'), '2005-03-08', '17:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '42501', null, 'the accountant cannot edit a lesson'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.update_lesson('00000000-0000-4000-8000-000000000000', '2005-03-08', '17:00', 60,
       '00000000-0000-4000-8000-000000000000', null, 'x') $$,
  '42501', null, 'anon cannot edit a lesson'
);

-- ─── Refusals (admin) ───────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9420000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-07'), '2005-03-08', '17:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, ' ') $$,
  '23514', 'reason is required', 'a reason is required'
);
select throws_ok(
  $$ update public.lessons set lesson_date = '2005-03-08' where id = pg_temp.lesson(1, '2005-03-07') $$,
  '23514', 'a held lesson is changed only by update_lesson', 'a direct date change of a held lesson is refused'
);
select throws_ok(
  $$ update public.lessons set teacher_id = 'b9420000-0000-4000-8000-000000000002' where id = pg_temp.lesson(1, '2005-03-07') $$,
  '23514', 'a held lesson is changed only by update_lesson', 'a direct teacher change of a held lesson is refused'
);
select lives_ok(
  $$ update public.lessons set substitute_teacher_id = 'b9420000-0000-4000-8000-000000000002' where id = pg_temp.lesson(1, '2005-03-07') $$,
  'the substitute (informational) is still set directly'
);
select throws_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-07'), public.bishkek_today() + 2, '17:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '23514', 'a held lesson cannot move to the future', 'a held lesson does not move into the future'
);
select throws_like(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-14'), '2005-03-09', '17:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '%is not enrolled in the group on%', 'the students must be on the roster of the new date'
);
select throws_like(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-21'), '2005-03-22', '17:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '%is cancelled%', 'a cancelled lesson is not edited'
);
select throws_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-07'), '2005-03-09', '15:00', 60,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '23505', null, 'the slot of another lesson of the group is taken'
);
select throws_like(
  $$ select public.update_lesson(pg_temp.lesson(2, '2005-03-07'), '2005-03-08', '17:00', 180,
       'b9420000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '%keeps its date and duration%', 'an after-school lesson with hour marks keeps its date'
);
select lives_ok(
  $$ select public.update_lesson(pg_temp.lesson(2, '2005-03-07'), '2005-03-07', '13:30', 180,
       'b9420000-0000-4000-8000-000000000002', null, 'вела Б') $$,
  'an after-school lesson with hour marks changes its time and teacher'
);

-- ─── Preview = the change of v_payroll_preview ──────────────────────────────
insert into pg_temp.seen values ('a', pg_temp.pay('1')), ('b', pg_temp.pay('2'));
create temp table impact as
select * from public.lesson_edit_payroll_impact(
  pg_temp.lesson(1, '2005-03-07'), '2005-03-08', 'b9420000-0000-4000-8000-000000000002');
select results_eq(
  $$ select teacher_name, month, amount from impact order by amount $$,
  $$ values ('Teacher 942 A'::text, '2005-03-01'::date, -213), ('Teacher 942 B'::text, '2005-03-01'::date, 267) $$,
  'A −213 (2 × 106,67), B +267 (2 × 133,33 at 50 %)'
);
select lives_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-07'), '2005-03-08', '17:00', 90,
       'b9420000-0000-4000-8000-000000000002', null, 'на самом деле вела Б во вторник') $$,
  'the admin moves the held lesson to Tuesday 17:00, 90 min, teacher B'
);
select results_eq(
  $$ select lesson_date, planned_start, duration_min, teacher_id, substitute_teacher_id, status::text
     from public.lessons where id = (select entity_id from public.audit_log
       where entity = 'lessons' and reason = 'на самом деле вела Б во вторник') $$,
  $$ values ('2005-03-08'::date, '17:00'::time, 90, 'b9420000-0000-4000-8000-000000000002'::uuid, null::uuid, 'held'::text) $$,
  'the lesson is moved and stays held'
);
select is(
  pg_temp.pay('1') - (select n from pg_temp.seen where key = 'a'),
  (select amount from impact where teacher_name = 'Teacher 942 A'),
  'teacher A loses exactly the preview'
);
select is(
  pg_temp.pay('2') - (select n from pg_temp.seen where key = 'b'),
  (select amount from impact where teacher_name = 'Teacher 942 B'),
  'teacher B gains exactly the preview'
);
select results_eq(
  $$ select kind, before ->> 'lesson_date', after ->> 'lesson_date' from public.audit_log
     where entity = 'lessons' and reason = 'на самом деле вела Б во вторник' $$,
  $$ values ('retro'::text, '2005-03-07'::text, '2005-03-08'::text) $$,
  'the journal: «Правки задним числом», before → after'
);
select is(
  (select count(*)::integer from public.attendance where lesson_id = pg_temp.lesson(1, '2005-03-08')),
  2, 'the marks stay with the lesson'
);
select lives_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-08'), '2005-03-08', '17:00', 90,
       'b9420000-0000-4000-8000-000000000002', null, 'повтор') $$,
  'the same values again'
);
select is_empty(
  $$ select 1 from public.audit_log where entity = 'lessons' and reason = 'повтор' $$,
  'the same values change nothing (no journal row)'
);
select is(
  (select count(*)::integer from public.lesson_edit_payroll_impact(pg_temp.lesson(1, '2005-03-28'), '2005-03-29', null)),
  0, 'a planned lesson has no payroll impact'
);
select lives_ok(
  $$ select public.update_lesson(pg_temp.lesson(1, '2005-03-28'), '2005-03-29', '16:00', 60,
       'b9420000-0000-4000-8000-000000000001', 'b9420000-0000-4000-8000-000000000002', 'перенос') $$,
  'a planned lesson moves too'
);

-- ─── change_group_teacher still moves held lessons ──────────────────────────
select lives_ok(
  $$ select * from public.change_group_teacher('d9420000-0000-4000-8000-000000000001',
       'b9420000-0000-4000-8000-000000000002', '2005-03-01') $$,
  'change_group_teacher moves the held lessons (iqup.admin_edit)'
);
select is(
  (select teacher_id from public.lessons where id = pg_temp.lesson(1, '2005-03-14')),
  'b9420000-0000-4000-8000-000000000002'::uuid, 'the held lesson of 14.03 is teacher B''s now'
);

select * from finish();
rollback;
