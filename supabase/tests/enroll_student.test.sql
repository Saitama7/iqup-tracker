-- Issue #8: enroll_student() RPC (enrollment + subscription in one transaction, tariff on the
-- start date, discounts В5) and RLS on students for teachers. Self-contained fixtures, rolled back.
begin;
select plan(28);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: a…1 admin, a…2 teacher A, a…3 teacher B, a…4 accountant
insert into auth.users (id, email) values
  ('a8000000-0000-4000-8000-000000000001', 'admin8@test.local'),
  ('a8000000-0000-4000-8000-000000000002', 'teacher8a@test.local'),
  ('a8000000-0000-4000-8000-000000000003', 'teacher8b@test.local'),
  ('a8000000-0000-4000-8000-000000000004', 'acc8@test.local');

insert into public.teachers (id, full_name, phone) values
  ('b8000000-0000-4000-8000-000000000001', 'Teacher A', '996000000801'),
  ('b8000000-0000-4000-8000-000000000002', 'Teacher B', '996000000802');

insert into public.profiles (id, phone, full_name, roles) values
  ('a8000000-0000-4000-8000-000000000001', '996000000800', 'Admin', '{admin}'),
  ('a8000000-0000-4000-8000-000000000002', '996000000801', 'Teacher A', '{teacher}'),
  ('a8000000-0000-4000-8000-000000000003', '996000000802', 'Teacher B', '{teacher}'),
  ('a8000000-0000-4000-8000-000000000004', '996000000803', 'Accountant', '{accountant}');

-- 'pair' tariffs of the test only: 3 200 until 2001-09-01, 4 000 from then on
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('c8000000-0000-4000-8000-000000000001', 'pair', 12, 3200, 2, 60, 2, '1990-01-01'),
  ('c8000000-0000-4000-8000-000000000002', 'pair', 12, 4000, 2, 60, 2, '2001-09-01');

insert into public.groups (id, name, subject, grade, group_type, teacher_id, start_date, status) values
  ('d8000000-0000-4000-8000-000000000001', 'Pair A', 'Математика', 8, 'pair', 'b8000000-0000-4000-8000-000000000001', '2000-01-01', 'active'),
  ('d8000000-0000-4000-8000-000000000002', 'Pair B', 'Химия', 9, 'pair', 'b8000000-0000-4000-8000-000000000002', '2000-01-01', 'active'),
  ('d8000000-0000-4000-8000-000000000003', 'Old', 'Химия', 9, 'pair', 'b8000000-0000-4000-8000-000000000002', '2000-01-01', 'archived'),
  -- seed tariffs for 'individual' start in 2025: none in effect in 2001
  ('d8000000-0000-4000-8000-000000000004', 'Solo', 'Химия', 9, 'individual', 'b8000000-0000-4000-8000-000000000002', '2000-01-01', 'active');

-- e…1 new, e…2 returning, e…3 brought by e…1, e…4 never enrolled anywhere
insert into public.students (id, full_name, is_returning, referred_by_student_id) values
  ('e8000000-0000-4000-8000-000000000001', 'New', false, null),
  ('e8000000-0000-4000-8000-000000000002', 'Returning', true, null),
  ('e8000000-0000-4000-8000-000000000004', 'Nobody', false, null);
insert into public.students (id, full_name, referred_by_student_id) values
  ('e8000000-0000-4000-8000-000000000003', 'Friend', 'e8000000-0000-4000-8000-000000000001');

create temp table r (key text primary key, enrollment_id uuid, subscription_id uuid);
grant all on r to authenticated;

-- ─── Teacher: cannot call, sees only own students ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', '2002-01-01') $$,
  '42501', null, 'teacher cannot enroll, even into own group'
);
select throws_ok(
  $$ insert into public.students (full_name) values ('X') $$,
  '42501', null, 'teacher cannot create students'
);

-- ─── Accountant: cannot call ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', '2002-01-01') $$,
  '42501', null, 'accountant cannot enroll'
);

-- ─── Anon: no execute grant ─────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', '2002-01-01') $$,
  '42501', null, 'anon cannot call enroll_student'
);

-- ─── Admin ──────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- new student, no discount, start 2001-08-15 → tariff 3 200 (valid_from 1990)
insert into r select 'new', * from public.enroll_student(
  'e8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', '2001-08-15');
select results_eq(
  $$ select e.student_id, e.group_id, e.start_date, e.status::text
     from public.enrollments e join r on r.enrollment_id = e.id where r.key = 'new' $$,
  $$ values ('e8000000-0000-4000-8000-000000000001'::uuid, 'd8000000-0000-4000-8000-000000000001'::uuid, '2001-08-15'::date, 'active') $$,
  'enrollment is created with the start date'
);
select results_eq(
  $$ select s.tariff_id, s.lessons_total, s.price_full, s.discount_percent, s.discount_reason::text, s.price_final, s.started_at, s.enrollment_id = r.enrollment_id
     from public.subscriptions s join r on r.subscription_id = s.id where r.key = 'new' $$,
  $$ values ('c8000000-0000-4000-8000-000000000001'::uuid, 12, 3200, 0, 'none', 3200, '2001-08-15'::date, true) $$,
  'subscription takes the tariff in effect on the start date'
);
select results_eq(
  $$ select lessons_used, lessons_left from public.v_subscription_balances b join r on r.subscription_id = b.subscription_id where r.key = 'new' $$,
  $$ values (0, 12) $$,
  'new subscription: 0 used, 12 left'
);

select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', '2002-01-01') $$,
  '23505', null, 'cannot enroll twice into the same group while active'
);

-- returning student, 15 % on the first subscription, after the September price change
insert into r select 'ret', * from public.enroll_student(
  'e8000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000001', '2001-09-01', 15, 'returning');
select results_eq(
  $$ select s.tariff_id, s.price_full, s.discount_percent, s.price_final
     from public.subscriptions s join r on r.subscription_id = s.id where r.key = 'ret' $$,
  $$ values ('c8000000-0000-4000-8000-000000000002'::uuid, 4000, 15, 3400) $$,
  'start on valid_from picks the new tariff; 15 % → round(4000 × 0.85)'
);
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000002', '2001-09-01', 15, 'returning') $$,
  '23514', null, '15 % only on the first subscription'
);
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000002', '2001-09-01', 15, 'returning') $$,
  '23514', null, '15 % only for a returning student'
);

-- referral: e…1 brought one friend (e…3) → 5 % once
insert into r select 'ref', * from public.enroll_student(
  'e8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000002', '2001-10-01', 5, 'referral');
select results_eq(
  $$ select s.price_full, s.discount_percent, s.discount_reason::text, s.price_final
     from public.subscriptions s join r on r.subscription_id = s.id where r.key = 'ref' $$,
  $$ values (4000, 5, 'referral', 3800) $$,
  '5 % «приведи друга» to the student who brought a friend'
);
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000001', '2001-10-01', 5, 'referral') $$,
  '23514', null, '5 % needs a friend brought'
);

-- discount values and reasons must match
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000001', '2001-10-01', 10, 'returning') $$,
  '23514', null, 'only 0 / 5 / 15 %'
);
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000001', '2001-10-01', 5, 'none') $$,
  '23514', null, 'a discount needs its reason'
);

-- group dates and status
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000001', '1999-12-31') $$,
  '23514', null, 'cannot start before the group'
);
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000003', '2001-10-01') $$,
  '23514', null, 'cannot enroll into an archived group'
);
select throws_ok(
  $$ select * from public.enroll_student('e8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-000000000004', '2001-10-01') $$,
  '23514', null, 'no tariff in effect on the start date — refused'
);

-- failed calls leave nothing behind (one transaction)
select is(
  (select count(*) from public.enrollments where student_id = 'e8000000-0000-4000-8000-000000000004'),
  0::bigint,
  'refused enrollment writes no rows'
);

select is(
  (select count(*) from public.audit_log a join r on a.entity_id in (r.enrollment_id, r.subscription_id)
   where a.entity in ('enrollments', 'subscriptions') and a.action = 'insert'
     and a.actor_id = 'a8000000-0000-4000-8000-000000000001'),
  6::bigint,
  'enrollments and subscriptions land in audit_log with the admin as actor'
);

-- ─── Teacher A sees only students of own groups ─────────────────────────────
set local request.jwt.claims = '{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select results_eq(
  $$ select id from public.students where id::text like 'e8%' order by id $$,
  $$ values ('e8000000-0000-4000-8000-000000000001'::uuid), ('e8000000-0000-4000-8000-000000000002'::uuid) $$,
  'teacher A sees the students enrolled in own group only'
);
select results_eq(
  $$ select group_id from public.enrollments where id in (select enrollment_id from r) $$,
  $$ values ('d8000000-0000-4000-8000-000000000001'::uuid), ('d8000000-0000-4000-8000-000000000001'::uuid) $$,
  'teacher A does not see the enrollment into teacher B''s group'
);
select results_eq(
  $$ select count(*) from public.v_subscription_balances where subscription_id in (select subscription_id from r) $$,
  $$ values (2::bigint) $$,
  'teacher A sees balances of own students only'
);
select is_empty(
  $$ select 1 from public.students where id = 'e8000000-0000-4000-8000-000000000004' $$,
  'teacher does not see students who are not enrolled'
);
select is_empty(
  $$ update public.students set notes = 'x' where id = 'e8000000-0000-4000-8000-000000000001' returning id $$,
  'teacher cannot edit a student'
);

-- ─── Teacher B ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select id from public.students where id::text like 'e8%' $$,
  $$ values ('e8000000-0000-4000-8000-000000000001'::uuid) $$,
  'teacher B sees only the student enrolled into own group'
);

-- ─── Accountant reads everything, writes nothing ────────────────────────────
set local request.jwt.claims = '{"sub":"a8000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select is(
  (select count(*) from public.students where id::text like 'e8%'),
  4::bigint,
  'accountant reads all students'
);
select throws_ok(
  $$ insert into public.students (full_name) values ('X') $$,
  '42501', null, 'accountant cannot create students'
);

select * from finish();
rollback;
