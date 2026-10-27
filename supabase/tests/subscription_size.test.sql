-- #101 · subscription size at purchase (0030, И89): buy_subscription / enroll_student / enroll_trial
-- with p_lessons — lessons_total = p_lessons, price_full = round(package_price × p_lessons /
-- lessons_in_package), the В5 discount from it; out of 1 … 2 × lessons_in_package — refused; after-school
-- ignores it; the old calls — as before. An 8/4 800 package: balance, debt, refund and payroll (К6)
-- count from 8 lessons at 600. Self-contained fixtures (2002 + today), rolled back.
begin;
select plan(24);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin
insert into auth.users (id, email) values
  ('a1010000-0000-4000-8000-000000000001', 'teacher101@test.local'),
  ('a1010000-0000-4000-8000-000000000003', 'admin101@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b1010000-0000-4000-8000-000000000001', 'Teacher 101', '996000010101');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1010000-0000-4000-8000-000000000001', '996000010101', 'Teacher 101', '{teacher}'),
  ('a1010000-0000-4000-8000-000000000003', '996000010103', 'Admin', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b1010000-0000-4000-8000-000000000001', 45, '2002-01-01');

-- individual 7 200 / 12 (600 a lesson) in 2002 and from yesterday (newer than the seed's); after-school by hours
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('f1010000-0000-4000-8000-000000000001', 'individual', 12, 7200, 1, 60, 2, '2002-01-01', null),
  ('f1010000-0000-4000-8000-000000000002', 'individual', 12, 7200, 1, 60, 2, public.bishkek_today() - 1, null),
  ('f1010000-0000-4000-8000-000000000003', 'afterschool', 20, 7400, 8, 180, 2, '2002-01-01', 100),
  ('f1010000-0000-4000-8000-000000000004', 'group', 12, 3200, 10, 60, 2, '2002-01-01', null);

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d1010000-0000-4000-8000-000000000001', 'Инд 101', (select id from public.subjects where name = 'Математика'), 8, 'individual', 'b1010000-0000-4000-8000-000000000001', '2002-01-01', 'active'),
  ('d1010000-0000-4000-8000-000000000002', 'Продлёнка 101', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b1010000-0000-4000-8000-000000000001', '2002-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd1010000-0000-4000-8000-000000000002', d, '13:00', '2002-03-01' from generate_series(1, 5) d;
select public.generate_lessons('d1010000-0000-4000-8000-000000000002', '2002-04-30');

-- S1 — enrolled in 2002 with 8 lessons; S2 — returning (15 %); S3 — old call (12);
-- S4 — enrolment without a package, buys 8 lessons today; S5 / S6 — after-school with / without p_lessons
insert into public.students (id, full_name, is_returning) values
  ('e1010000-0000-4000-8000-000000000001', 'S1', false),
  ('e1010000-0000-4000-8000-000000000002', 'S2', true),
  ('e1010000-0000-4000-8000-000000000003', 'S3', false),
  ('e1010000-0000-4000-8000-000000000004', 'S4', true),
  ('e1010000-0000-4000-8000-000000000005', 'S5', false),
  ('e1010000-0000-4000-8000-000000000006', 'S6', false);
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('c1010000-0000-4000-8000-000000000004', 'e1010000-0000-4000-8000-000000000004', 'd1010000-0000-4000-8000-000000000001', '2002-01-01');

create function pg_temp.sub_of(p_student uuid)
returns table (lessons_total integer, price_full integer, discount_percent integer, price_final integer)
language sql as $$
  select s.lessons_total, s.price_full, s.discount_percent, s.price_final
  from public.subscriptions s join public.enrollments e on e.id = s.enrollment_id
  where e.student_id = p_student
  order by s.created_at desc, s.id desc
  limit 1;
$$;
grant execute on function pg_temp.sub_of(uuid) to authenticated;

-- ─── Price of a size ────────────────────────────────────────────────────────
select is(public.subscription_size_price('f1010000-0000-4000-8000-000000000001', 8), 4800,
  'И89: 7 200 / 12 × 8 = 4 800');
select is(public.subscription_size_price('f1010000-0000-4000-8000-000000000004', 8), 2133,
  'И89: 3 200 / 12 × 8 = 2 133,33 → 2 133');

-- ─── As admin ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1010000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000001', 'd1010000-0000-4000-8000-000000000001', '2002-01-01', p_lessons => 8) $$,
  'enroll_student with 8 lessons'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1010000-0000-4000-8000-000000000001') $$,
  $$ values (8, 4800, 0, 4800) $$,
  'enroll_student: 8 lessons · 4 800'
);
select lives_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000002', 'd1010000-0000-4000-8000-000000000001', '2002-01-01', 15, 'returning', null, 8) $$,
  'enroll_student with 8 lessons and 15 %'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1010000-0000-4000-8000-000000000002') $$,
  $$ values (8, 4800, 15, 4080) $$,
  'В5 from the 8-lesson price: 4 800 − 15 % = 4 080'
);
select lives_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000003', 'd1010000-0000-4000-8000-000000000001', '2002-01-01') $$,
  'old enroll_student call without p_lessons'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1010000-0000-4000-8000-000000000003') $$,
  $$ values (12, 7200, 0, 7200) $$,
  'no p_lessons → the tariff package (12 · 7 200)'
);
select throws_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000005', 'd1010000-0000-4000-8000-000000000001', '2002-01-01', p_lessons => 25) $$,
  '23514', 'lessons must be 1 … 24',
  'enroll_student: 25 lessons of a 12-lesson tariff — refused'
);
select throws_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000005', 'd1010000-0000-4000-8000-000000000001', '2002-01-01', p_lessons => 0) $$,
  '23514', 'lessons must be 1 … 24',
  'enroll_student: 0 lessons — refused'
);

-- buy_subscription today (tariff from yesterday, 7 200 / 12), В5 15 % — S4 has no package yet
select lives_ok(
  $$ select * from public.buy_subscription('c1010000-0000-4000-8000-000000000004', 4080, 'cash', null, null, 15, 'returning', 8) $$,
  'buy_subscription with 8 lessons and 15 %'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1010000-0000-4000-8000-000000000004') $$,
  $$ values (8, 4800, 15, 4080) $$,
  'buy_subscription: 8 lessons · 4 800, 4 080 with 15 %'
);
select is(
  (select paid_lessons::integer from public.v_student_balance b join public.subscriptions s on s.id = b.subscription_id
   join public.enrollments e on e.id = s.enrollment_id where e.student_id = 'e1010000-0000-4000-8000-000000000004'),
  8,
  '4 080 paid of 4 080 → 8 of 8'
);
select lives_ok(
  $$ select * from public.buy_subscription('c1010000-0000-4000-8000-000000000004', 7200, 'cash') $$,
  'old buy_subscription call without p_lessons'
);
select results_eq(
  $$ select s.lessons_total, s.price_full, s.discount_percent, s.price_final from public.subscriptions s
     where s.enrollment_id = 'c1010000-0000-4000-8000-000000000004' order by s.lessons_total $$,
  $$ values (8, 4800, 15, 4080), (12, 7200, 0, 7200) $$,
  'buy_subscription without p_lessons → 12 · 7 200'
);
select throws_ok(
  $$ select * from public.buy_subscription('c1010000-0000-4000-8000-000000000004', 100, 'cash', p_lessons => 30) $$,
  '23514', 'lessons must be 1 … 24',
  'buy_subscription: 30 lessons — refused'
);

-- after-school (К13, #111): a package of days like every type — p_lessons is its size
select lives_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000005', 'd1010000-0000-4000-8000-000000000002', '2002-03-01', p_lessons => 8) $$,
  'after-school enroll with p_lessons'
);
select lives_ok(
  $$ select * from public.enroll_student('e1010000-0000-4000-8000-000000000006', 'd1010000-0000-4000-8000-000000000002', '2002-03-01') $$,
  'after-school enroll without p_lessons'
);
select results_eq(
  $$ select s.lessons_total, s.price_full, s.hours_total from public.subscriptions s
     join public.enrollments e on e.id = s.enrollment_id where e.student_id = 'e1010000-0000-4000-8000-000000000005' $$,
  $$ values (8, 2960, null::numeric) $$,
  'after-school: 8 days of 20 · 7 400 → 2 960, no hours'
);

-- ─── 8 / 4 800: balance, debt, refund, payroll (as postgres) ────────────────
reset role;

-- S1 pays 4 800; 6 held lessons in January 2002, all present
select public.record_payment(
  (select s.id from public.subscriptions s join public.enrollments e on e.id = s.enrollment_id
   where e.student_id = 'e1010000-0000-4000-8000-000000000001'), 4800, 'cash', '2002-01-01');
set session_replication_role = replica;
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at)
select ('31010000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'd1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-000000000001',
       date '2002-01-01' + n, '09:00', 60, 'held', now()
from generate_series(1, 10) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('31010000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e1010000-0000-4000-8000-000000000001',
       (select s.id from public.subscriptions s join public.enrollments e on e.id = s.enrollment_id
        where e.student_id = 'e1010000-0000-4000-8000-000000000001'),
       'present'
from generate_series(1, 6) n;
set session_replication_role = origin;

select results_eq(
  $$ select b.paid_lessons::integer, b.lessons_used::integer, b.lessons_left::integer, b.debt_lessons::integer, b.refund_suggested::integer
     from public.v_student_balance b join public.subscriptions s on s.id = b.subscription_id
     join public.enrollments e on e.id = s.enrollment_id where e.student_id = 'e1010000-0000-4000-8000-000000000001' $$,
  $$ values (8, 6, 2, 0, 1200) $$,
  '8 / 4 800, paid, 6 used → 2 left, refund 2 × 600 = 1 200'
);
select is(
  (select base_amount::integer from public.v_payroll_preview
   where teacher_id = 'b1010000-0000-4000-8000-000000000001' and month = '2002-01-01'),
  1620,
  'К6: 6 × 4 800 / 8 × 45 % = 6 × 600 × 45 % = 1 620'
);

-- 4 more lessons → 10 used of 8 → debt 2 × 600
set session_replication_role = replica;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('31010000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e1010000-0000-4000-8000-000000000001',
       (select s.id from public.subscriptions s join public.enrollments e on e.id = s.enrollment_id
        where e.student_id = 'e1010000-0000-4000-8000-000000000001'),
       'present'
from generate_series(7, 10) n;
set session_replication_role = origin;

select results_eq(
  $$ select b.lessons_used::integer, b.debt_lessons::integer, b.debt_som::integer, b.refund_suggested::integer
     from public.v_student_balance b join public.subscriptions s on s.id = b.subscription_id
     join public.enrollments e on e.id = s.enrollment_id where e.student_id = 'e1010000-0000-4000-8000-000000000001' $$,
  $$ values (10, 2, 1200, 0) $$,
  '10 used of 8 → debt 2 lessons, 1 200 сом'
);

-- enroll_trial passes p_lessons to enroll_student
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status)
values ('31010000-0000-4000-8000-000000000099', 'd1010000-0000-4000-8000-000000000001',
        'b1010000-0000-4000-8000-000000000001', '2002-02-01', '09:00', 60, 'planned');
insert into public.trials (id, full_name, parent_phone, group_id, lesson_id, status, came, source, created_by)
values ('71010000-0000-4000-8000-000000000001', 'Лид 101', '996700010101', 'd1010000-0000-4000-8000-000000000001',
        '31010000-0000-4000-8000-000000000099', 'attended', true, 'other', 'a1010000-0000-4000-8000-000000000003');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1010000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select * from public.enroll_trial('71010000-0000-4000-8000-000000000001', '2002-02-02', 0, 'none', 4) $$,
  'enroll_trial with 4 lessons'
);
select results_eq(
  $$ select s.lessons_total, s.price_full from public.subscriptions s
     join public.trials t on t.enrollment_id = s.enrollment_id
     where t.id = '71010000-0000-4000-8000-000000000001' $$,
  $$ values (4, 2400) $$,
  'enroll_trial: 4 lessons · 2 400'
);

select * from finish();
rollback;
