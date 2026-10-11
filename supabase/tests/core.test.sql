-- Core invariants and RLS for R1 (issues #2, #17). Self-contained fixtures, rolled back at the end.
begin;
select plan(35);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: a…1 teacher A, a…2 teacher B, a…3 admin, a…4 accountant
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'teacher-a@test.local'),
  ('a0000000-0000-4000-8000-000000000002', 'teacher-b@test.local'),
  ('a0000000-0000-4000-8000-000000000003', 'admin@test.local'),
  ('a0000000-0000-4000-8000-000000000004', 'accountant@test.local');

insert into public.profiles (id, phone, full_name, roles) values
  ('a0000000-0000-4000-8000-000000000001', '996000000001', 'Teacher A', '{teacher}'),
  ('a0000000-0000-4000-8000-000000000002', '996000000002', 'Teacher B', '{teacher}'),
  ('a0000000-0000-4000-8000-000000000003', '996000000003', 'Admin', '{admin}'),
  ('a0000000-0000-4000-8000-000000000004', '996000000004', 'Accountant', '{accountant}');

insert into public.teachers (id, user_id, full_name) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Teacher A'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Teacher B');

insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from)
values ('c0000000-0000-4000-8000-000000000001', 'group', 12, 3200, 10, 60, 2, '2000-01-01');

insert into public.groups (id, name, subject, grade, group_type, teacher_id, start_date, status) values
  ('d0000000-0000-4000-8000-000000000001', 'Test A', 'Математика', 8, 'group', 'b0000000-0000-4000-8000-000000000001', '2000-01-01', 'active'),
  ('d0000000-0000-4000-8000-000000000002', 'Test B', 'Химия', 9, 'group', 'b0000000-0000-4000-8000-000000000002', '2000-01-01', 'active');

insert into public.students (id, full_name) values
  ('e0000000-0000-4000-8000-000000000001', 'Student A'),
  ('e0000000-0000-4000-8000-000000000002', 'Student B'),
  ('e0000000-0000-4000-8000-000000000003', 'Student A2'); -- group A, never marked

insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '2000-01-01'),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', '2000-01-01'),
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', '2000-01-01');

insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('10000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 12, 3200, 3200, '2000-01-01'),
  ('10000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 12, 3200, 3200, '2000-01-01');

-- lessons …1–…3: group A in the past; …4: group B in the past; …5: group A next week
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min) values
  ('20000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', public.bishkek_today() - 3, '09:00', 60),
  ('20000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', public.bishkek_today() - 2, '09:00', 60),
  ('20000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', public.bishkek_today() - 1, '09:00', 60),
  ('20000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000002', public.bishkek_today() - 1, '09:00', 60),
  ('20000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', public.bishkek_today() + 7, '09:00', 60);

-- ─── Teacher A: visibility ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select results_eq('select id from public.groups', array['d0000000-0000-4000-8000-000000000001'::uuid], 'teacher sees only own groups');
select is((select count(*) from public.lessons where group_id <> 'd0000000-0000-4000-8000-000000000001'), 0::bigint, 'teacher sees no foreign lessons');
select is((select count(*) from public.lessons), 4::bigint, 'teacher sees all own lessons');
select results_eq('select id from public.students order by id', array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003']::uuid[], 'teacher sees only students of own groups');
select results_eq('select id from public.enrollments order by id', array['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003']::uuid[], 'teacher sees only own enrollments');
select results_eq('select id from public.subscriptions', array['10000000-0000-4000-8000-000000000001'::uuid], 'teacher sees only own students'' subscriptions');
select results_eq('select id from public.profiles', array['a0000000-0000-4000-8000-000000000001'::uuid], 'teacher sees only own profile');
select is_empty('select 1 from public.audit_log', 'teacher cannot read audit_log');
select ok((select count(*) > 0 from public.tariffs), 'teacher reads tariffs');

-- ─── Teacher A: writes ──────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.groups (name, subject, group_type, teacher_id, start_date)
     values ('X', 'X', 'group', 'b0000000-0000-4000-8000-000000000001', '2000-01-01') $$,
  '42501', null, 'teacher cannot create groups'
);
select lives_ok(
  $$ insert into public.attendance (id, lesson_id, student_id, subscription_id, status) values
     ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'present') $$,
  'teacher marks attendance on own planned lesson'
);
select throws_ok(
  $$ insert into public.attendance (lesson_id, student_id, subscription_id, status) values
     ('20000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'present') $$,
  '42501', null, 'teacher cannot mark attendance on a foreign lesson'
);

-- confirmation (R1-8 order: marks while planned, then status → held in the same transaction)
select lives_ok(
  $$ update public.lessons set status = 'held' where id = '20000000-0000-4000-8000-000000000001' $$,
  'teacher holds own past lesson'
);
select ok(
  (select confirmed_at is not null and confirmed_late and confirmed_by = 'a0000000-0000-4000-8000-000000000001'
   from public.lessons where id = '20000000-0000-4000-8000-000000000001'),
  'confirmed_at/by set by DB, late flag for a past day'
);
select throws_ok(
  $$ update public.attendance set status = 'absent_burned' where id = '30000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'teacher cannot change attendance after the lesson is held'
);
select throws_ok(
  $$ insert into public.attendance (lesson_id, student_id, status) values
     ('20000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'present') $$,
  '42501', null, 'teacher cannot add attendance to a held lesson'
);
select throws_ok(
  $$ update public.lessons set confirmed_at = now() - interval '1 day' where id = '20000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'teacher cannot change confirmed_at'
);
select throws_ok(
  $$ update public.lessons set lesson_date = lesson_date + 1 where id = '20000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'teacher cannot reschedule a lesson'
);
select throws_ok(
  $$ update public.lessons set status = 'held' where id = '20000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'teacher cannot hold a lesson that has not started'
);
select lives_ok(
  $$ insert into public.lessons (group_id, lesson_date, planned_start, duration_min, is_extra)
     values ('d0000000-0000-4000-8000-000000000001', public.bishkek_today() + 3, '16:00', 60, true) $$,
  'teacher creates an extra lesson for own group'
);
select throws_ok(
  $$ insert into public.lessons (group_id, lesson_date, planned_start, duration_min)
     values ('d0000000-0000-4000-8000-000000000001', public.bishkek_today() + 4, '16:00', 60) $$,
  '42501', null, 'teacher cannot create a regular lesson'
);

-- freeze limit: 2 per subscription
select lives_ok(
  $$ insert into public.attendance (lesson_id, student_id, subscription_id, status) values
     ('20000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'absent_frozen'),
     ('20000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'absent_frozen') $$,
  'two freezes on one subscription are allowed'
);
select throws_ok(
  $$ insert into public.attendance (lesson_id, student_id, subscription_id, status) values
     ('20000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'absent_frozen') $$,
  '23514', null, 'third freeze on one subscription fails'
);
select results_eq(
  $$ select lessons_used, lessons_left, freezes_used from public.v_subscription_balances
     where subscription_id = '10000000-0000-4000-8000-000000000001' $$,
  $$ values (1, 11, 2) $$,
  'v_subscription_balances counts credits and freezes'
);
select results_eq(
  $$ select effective_status from public.v_lesson_status where id in
     ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005')
     order by lesson_date $$,
  $$ values ('held'), ('unconfirmed'), ('planned') $$,
  'v_lesson_status marks past planned lessons as unconfirmed'
);

-- ─── Admin edits a held lesson's attendance ─────────────────────────────────
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ update public.attendance set status = 'absent_burned' where id = '30000000-0000-4000-8000-000000000001' $$,
  'admin changes attendance after the lesson is held'
);
select lives_ok(
  $$ insert into public.attendance (lesson_id, student_id, status) values
     ('20000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'present') $$,
  'admin adds attendance to a held lesson'
);

-- ─── Closed period ──────────────────────────────────────────────────────────
reset role;
set local request.jwt.claims = '';
update public.lessons set is_locked = true where id = '20000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select throws_ok(
  $$ update public.lessons set comment = 'fix' where id = '20000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'admin cannot edit a locked lesson'
);
select throws_ok(
  $$ update public.attendance set status = 'absent_burned' where id = '30000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'admin cannot edit attendance of a locked lesson'
);
select throws_ok(
  $$ delete from public.attendance where id = '30000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'admin cannot delete attendance of a locked lesson'
);
select lives_ok(
  $$ update public.lessons set is_locked = false where id = '20000000-0000-4000-8000-000000000001' $$,
  'admin may reopen a period (is_locked only)'
);

-- ─── Accountant ─────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';

select ok((select count(*) >= 5 from public.lessons), 'accountant reads all lessons');
select throws_ok(
  $$ insert into public.holidays (day, name) values ('2000-01-01', 'X') $$,
  '42501', null, 'accountant cannot write'
);
update public.lessons set comment = 'accountant was here' where id = '20000000-0000-4000-8000-000000000002';

-- ─── Audit log ──────────────────────────────────────────────────────────────
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*) from public.lessons where comment = 'accountant was here'),
  0::bigint,
  'accountant update is filtered by RLS'
);
select ok(
  exists (
    select 1 from public.audit_log
    where entity = 'lessons' and entity_id = '20000000-0000-4000-8000-000000000001'
      and action = 'update' and actor_id = 'a0000000-0000-4000-8000-000000000001'
      and before ->> 'status' = 'planned' and after ->> 'status' = 'held'
  ),
  'audit_log records the teacher confirmation with before/after'
);

select * from finish();
rollback;
