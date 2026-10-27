-- #109 · subscription price of its own (0033, К11, К12, И90): individual — 12 hours for 7 200, a 90-min
-- group defaults to 8 lessons · 7 200 (900 a lesson); p_price — the admin's price, the В5 discount from
-- it; update_subscription — admin with a reason, refused in a closed period, the guard refuses a direct
-- write; previews — payroll 300 → 450 a mark, balance 20 / 7 400 → 12 / 5 400. Self-contained, rolled back.
begin;
select plan(34);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin
insert into auth.users (id, email) values
  ('a1090000-0000-4000-8000-000000000001', 'teacher109@test.local'),
  ('a1090000-0000-4000-8000-000000000003', 'admin109@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b1090000-0000-4000-8000-000000000001', 'Teacher 109', '996000010901');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1090000-0000-4000-8000-000000000001', '996000010901', 'Teacher 109', '{teacher}'),
  ('a1090000-0000-4000-8000-000000000003', '996000010903', 'Admin', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b1090000-0000-4000-8000-000000000001', 50, '2003-01-01');

-- individual 7 200 / 12 h (60-min lessons by the tariff) in 2003 and from yesterday; group 3 200 / 12;
-- after-school by hours
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('f1090000-0000-4000-8000-000000000001', 'individual', 12, 7200, 1, 60, 2, '2003-01-01', null),
  ('f1090000-0000-4000-8000-000000000002', 'individual', 12, 7200, 1, 60, 2, public.bishkek_today() - 1, null),
  ('f1090000-0000-4000-8000-000000000003', 'group', 12, 3200, 10, 60, 2, '2003-01-01', null),
  ('f1090000-0000-4000-8000-000000000004', 'afterschool', 20, 7400, 8, 180, 2, '2003-01-01', 100);

-- G1 — individual, Sat / Sun by 1,5 h (Байхан, #100); G2 — individual by the tariff (60 min);
-- G3 — a group; G4 — after-school
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status, lesson_duration_min) values
  ('d1090000-0000-4000-8000-000000000001', 'Инд 109 · 1,5 ч', (select id from public.subjects where name = 'Математика'), 8, 'individual', 'b1090000-0000-4000-8000-000000000001', '2003-01-01', 'active', 90),
  ('d1090000-0000-4000-8000-000000000002', 'Инд 109', (select id from public.subjects where name = 'Математика'), 8, 'individual', 'b1090000-0000-4000-8000-000000000001', '2003-01-01', 'active', null),
  ('d1090000-0000-4000-8000-000000000003', 'Группа 109', (select id from public.subjects where name = 'Математика'), 8, 'group', 'b1090000-0000-4000-8000-000000000001', '2003-01-01', 'active', null),
  ('d1090000-0000-4000-8000-000000000004', 'Продлёнка 109', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b1090000-0000-4000-8000-000000000001', '2003-03-01', 'active', null);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd1090000-0000-4000-8000-000000000004', d, '13:00', '2003-03-01' from generate_series(1, 5) d;
select public.generate_lessons('d1090000-0000-4000-8000-000000000004', '2003-04-30');

-- S1 — G1 by default; S2 — G1 with own price 12 / 5 400; S3 — returning, own price with 15 %;
-- S4 — G1 enrolled without a package, buys one today; S5 — G2; S6 — G3; S7 — after-school;
-- S8 — G2, the payroll / edit case; S9 — G3, 20 / 7 400 paid 5 400 (Сайкал)
insert into public.students (id, full_name, is_returning) values
  ('e1090000-0000-4000-8000-000000000001', 'S1', false),
  ('e1090000-0000-4000-8000-000000000002', 'S2', false),
  ('e1090000-0000-4000-8000-000000000003', 'S3', true),
  ('e1090000-0000-4000-8000-000000000004', 'S4', false),
  ('e1090000-0000-4000-8000-000000000005', 'S5', false),
  ('e1090000-0000-4000-8000-000000000006', 'S6', false),
  ('e1090000-0000-4000-8000-000000000007', 'S7', false),
  ('e1090000-0000-4000-8000-000000000008', 'S8', false),
  ('e1090000-0000-4000-8000-000000000009', 'S9', false);
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('c1090000-0000-4000-8000-000000000004', 'e1090000-0000-4000-8000-000000000004', 'd1090000-0000-4000-8000-000000000001', '2003-01-01'),
  ('c1090000-0000-4000-8000-000000000008', 'e1090000-0000-4000-8000-000000000008', 'd1090000-0000-4000-8000-000000000002', '2003-01-01'),
  ('c1090000-0000-4000-8000-000000000009', 'e1090000-0000-4000-8000-000000000009', 'd1090000-0000-4000-8000-000000000003', '2003-01-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('51090000-0000-4000-8000-000000000008', 'c1090000-0000-4000-8000-000000000008', 'f1090000-0000-4000-8000-000000000001', 12, 7200, 7200, '2003-01-01'),
  ('51090000-0000-4000-8000-000000000009', 'c1090000-0000-4000-8000-000000000009', 'f1090000-0000-4000-8000-000000000003', 20, 7400, 7400, '2003-01-01');
insert into public.payments (subscription_id, amount, method, paid_at) values
  ('51090000-0000-4000-8000-000000000008', 7200, 'cash', '2003-01-01 10:00+06'),
  ('51090000-0000-4000-8000-000000000009', 5400, 'cash', '2003-01-01 10:00+06');

-- S8: one held lesson in January (present); S9: 12 held days in January, a held lesson of S8 in
-- February — closed below
set session_replication_role = replica;
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at) values
  ('31090000-0000-4000-8000-000000000001', 'd1090000-0000-4000-8000-000000000002', 'b1090000-0000-4000-8000-000000000001', '2003-01-11', '09:00', 60, 'held', now());
insert into public.attendance (lesson_id, student_id, subscription_id, status) values
  ('31090000-0000-4000-8000-000000000001', 'e1090000-0000-4000-8000-000000000008', '51090000-0000-4000-8000-000000000008', 'present');
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at)
select ('32090000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'd1090000-0000-4000-8000-000000000003', 'b1090000-0000-4000-8000-000000000001',
       date '2003-01-01' + n, '09:00', 60, 'held', now()
from generate_series(1, 12) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('32090000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e1090000-0000-4000-8000-000000000009', '51090000-0000-4000-8000-000000000009', 'present'
from generate_series(1, 12) n;
set session_replication_role = origin;

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

-- ─── Defaults (К11) ─────────────────────────────────────────────────────────
select is(public.subscription_default_lessons('f1090000-0000-4000-8000-000000000001', 'd1090000-0000-4000-8000-000000000001'), 8,
  'К11: 12 h of 1,5-h lessons → 8 lessons');
select is(public.subscription_default_price('f1090000-0000-4000-8000-000000000001', 'd1090000-0000-4000-8000-000000000001'), 7200,
  'К11: 8 × 900 = 7 200');
select is(public.subscription_default_price('f1090000-0000-4000-8000-000000000001', 'd1090000-0000-4000-8000-000000000001', 4), 3600,
  'К11: 4 lessons of 1,5 h = 3 600');
select is(public.subscription_default_lessons('f1090000-0000-4000-8000-000000000001', 'd1090000-0000-4000-8000-000000000002'), 12,
  'individual by the tariff (60 min) — 12 lessons');
select is(public.subscription_default_price('f1090000-0000-4000-8000-000000000003', 'd1090000-0000-4000-8000-000000000003', 8), 2133,
  'a group — И89 as before: 3 200 / 12 × 8');

-- ─── As admin ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1090000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000001', 'd1090000-0000-4000-8000-000000000001', '2003-01-01') $$,
  'enroll_student into the 1,5-h individual group without p_lessons / p_price'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1090000-0000-4000-8000-000000000001') $$,
  $$ values (8, 7200, 0, 7200) $$,
  'К11: 8 lessons · 7 200 by default'
);
select lives_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000002', 'd1090000-0000-4000-8000-000000000001', '2003-01-01', p_lessons => 12, p_price => 5400) $$,
  'enroll_student with p_lessons 12, p_price 5 400'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1090000-0000-4000-8000-000000000002') $$,
  $$ values (12, 5400, 0, 5400) $$,
  'К12: own price — 12 · 5 400'
);
select lives_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000003', 'd1090000-0000-4000-8000-000000000001', '2003-01-01', 15, 'returning', null, 12, 5400) $$,
  'enroll_student with own price and 15 %'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1090000-0000-4000-8000-000000000003') $$,
  $$ values (12, 5400, 15, 4590) $$,
  'В5 from the own price: 5 400 − 15 % = 4 590'
);
select lives_ok(
  $$ select * from public.buy_subscription('c1090000-0000-4000-8000-000000000004', 7200, 'cash') $$,
  'buy_subscription for the 1,5-h individual group without p_lessons'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1090000-0000-4000-8000-000000000004') $$,
  $$ values (8, 7200, 0, 7200) $$,
  'buy_subscription: 8 · 7 200 by default'
);
select lives_ok(
  $$ select * from public.buy_subscription('c1090000-0000-4000-8000-000000000004', 5400, 'cash', p_lessons => 12, p_price => 5400) $$,
  'buy_subscription with p_price 5 400, p_lessons 12'
);
select results_eq(
  $$ select s.lessons_total, s.price_full, s.discount_percent, s.price_final from public.subscriptions s
     where s.enrollment_id = 'c1090000-0000-4000-8000-000000000004' order by s.price_full $$,
  $$ values (12, 5400, 0, 5400), (8, 7200, 0, 7200) $$,
  'buy_subscription: 12 · 5 400'
);
select lives_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000005', 'd1090000-0000-4000-8000-000000000002', '2003-01-01') $$,
  'enroll_student into a 60-min individual group'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1090000-0000-4000-8000-000000000005') $$,
  $$ values (12, 7200, 0, 7200) $$,
  '60 min — 12 · 7 200 as before'
);
select lives_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000006', 'd1090000-0000-4000-8000-000000000003', '2003-01-01') $$,
  'enroll_student into a group'
);
select results_eq(
  $$ select * from pg_temp.sub_of('e1090000-0000-4000-8000-000000000006') $$,
  $$ values (12, 3200, 0, 3200) $$,
  'a group — 12 · 3 200 as before'
);
select throws_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000007', 'd1090000-0000-4000-8000-000000000003', '2003-01-01', p_price => 0) $$,
  '23514', 'price must be 1 … 1000000',
  'price 0 — refused'
);
select throws_ok(
  $$ select * from public.enroll_student('e1090000-0000-4000-8000-000000000007', 'd1090000-0000-4000-8000-000000000004', '2003-03-01', p_price => 5400) $$,
  '23514', 'a price is for lesson packages only',
  'after-school by hours — no own price (#111)'
);

-- ─── Previews (admin) ───────────────────────────────────────────────────────
select results_eq(
  $$ select marks, mark_before, mark_after, amount_before, amount_after
     from public.subscription_update_preview('51090000-0000-4000-8000-000000000008', 8, 7200) $$,
  $$ values (1, 300, 450, 300 + 12 * 185, 450 + 12 * 185) $$,
  'К11 preview: 12 / 7 200 → 8 / 7 200 — 300 → 450 a mark, the month +150'
);
select results_eq(
  $$ select phase, lessons_total, price_final, paid_som, lessons_used, lessons_left, debt_lessons, debt_som
     from public.subscription_balance_preview('51090000-0000-4000-8000-000000000009', 12, 5400) order by phase desc $$,
  $$ values ('before', 20, 7400, 5400, 12, 8, 0, 0), ('after', 12, 5400, 5400, 12, 0, 0, 0) $$,
  'К12 preview: 20 / 7 400 → 12 / 5 400, paid 5 400 — nothing left to pay'
);
select is(
  (select count(*)::integer from public.audit_log
   where entity_id = '51090000-0000-4000-8000-000000000008' and action = 'update'),
  0,
  'a preview writes nothing (rolled back)'
);

-- ─── update_subscription ────────────────────────────────────────────────────
select throws_ok(
  $$ select public.update_subscription('51090000-0000-4000-8000-000000000008', 8, 7200, ' ') $$,
  '23514', 'reason is required',
  'update_subscription without a reason — refused'
);
select throws_ok(
  $$ update public.subscriptions set lessons_total = 8 where id = '51090000-0000-4000-8000-000000000008' $$,
  '42501', 'a subscription''s size and price change only by update_subscription',
  'a direct write of the size — refused by subscriptions_guard'
);
select lives_ok(
  $$ select public.update_subscription('51090000-0000-4000-8000-000000000008', 8, 7200, 'К11: 12 часов = 8 занятий по 1,5 ч') $$,
  'update_subscription 12 / 7 200 → 8 / 7 200'
);
select results_eq(
  $$ select lessons_total, price_full, price_final from public.subscriptions where id = '51090000-0000-4000-8000-000000000008' $$,
  $$ values (8, 7200, 7200) $$,
  'the subscription is 8 · 7 200'
);
select is(
  (select base_amount::integer from public.v_payroll_preview
   where teacher_id = 'b1090000-0000-4000-8000-000000000001' and month = '2003-01-01'),
  450 + 12 * 185,
  'К6: the mark now pays 450 (and the 12 group days 3 700 / 20 × 50 % — unchanged)'
);
select results_eq(
  $$ select action, reason, kind, (before ->> 'lessons_total')::integer, (after ->> 'lessons_total')::integer
     from public.audit_log where entity = 'subscriptions' and action = 'update'
       and entity_id = '51090000-0000-4000-8000-000000000008' $$,
  $$ values ('update'::text, 'К11: 12 часов = 8 занятий по 1,5 ч'::text, 'retro'::text, 12, 8) $$,
  'journal: one subscriptions update with the reason — «Правки задним числом»'
);
select lives_ok(
  $$ select public.update_subscription('51090000-0000-4000-8000-000000000009', 12, 5400, 'Продлёнка: 12 дней за 5 400') $$,
  'update_subscription 20 / 7 400 → 12 / 5 400'
);

-- ─── Closed period, teacher (as postgres, then teacher) ─────────────────────
reset role;
set session_replication_role = replica;
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at, is_locked) values
  ('31090000-0000-4000-8000-000000000002', 'd1090000-0000-4000-8000-000000000002', 'b1090000-0000-4000-8000-000000000001', '2003-02-08', '09:00', 60, 'held', now(), true);
insert into public.attendance (lesson_id, student_id, subscription_id, status) values
  ('31090000-0000-4000-8000-000000000002', 'e1090000-0000-4000-8000-000000000008', '51090000-0000-4000-8000-000000000008', 'present');
insert into public.payroll_periods (month) values ('2003-02-01');
set session_replication_role = origin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1090000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.update_subscription('51090000-0000-4000-8000-000000000008', 12, 7200, 'назад') $$,
  '23514', 'the subscription has marks in a closed period',
  'invariant 2: a mark in a closed period — refused'
);

set local request.jwt.claims = '{"sub":"a1090000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.update_subscription('51090000-0000-4000-8000-000000000009', 20, 7400, 'учитель') $$,
  '42501', 'only an admin may edit a subscription',
  'a teacher cannot call update_subscription'
);
select throws_ok(
  $$ select * from public.subscription_update_preview('51090000-0000-4000-8000-000000000009', 20, 7400) $$,
  '42501', null,
  'a teacher cannot see the preview'
);

select * from finish();
rollback;
