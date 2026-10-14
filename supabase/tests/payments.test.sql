-- #47 · payments (0016): RLS (admin writes only through the RPCs, payments immutable — И41, accountant reads, a teacher reads only own students'
-- payments — Д3), the checks, v_student_balance (В7.1 partial payment, В7 debt, И37 carry to the next
-- subscription, В8 refund), record_payment / buy_subscription / refund_subscription, audit_log,
-- trials.referred_by_student_id → students (В5). Self-contained fixtures in 2002, rolled back.
begin;
select plan(52);

-- ─── Fixtures (as postgres, triggers off) ───────────────────────────────────
-- users: …1 teacher A, …2 teacher B, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a4700000-0000-4000-8000-000000000001', 'teacher47a@test.local'),
  ('a4700000-0000-4000-8000-000000000002', 'teacher47b@test.local'),
  ('a4700000-0000-4000-8000-000000000003', 'admin47@test.local'),
  ('a4700000-0000-4000-8000-000000000004', 'acc47@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b4700000-0000-4000-8000-000000000001', 'Teacher A', '996000004701'),
  ('b4700000-0000-4000-8000-000000000002', 'Teacher B', '996000004702');
insert into public.profiles (id, phone, full_name, roles) values
  ('a4700000-0000-4000-8000-000000000001', '996000004701', 'Teacher A', '{teacher}'),
  ('a4700000-0000-4000-8000-000000000002', '996000004702', 'Teacher B', '{teacher}'),
  ('a4700000-0000-4000-8000-000000000003', '996000004703', 'Admin', '{admin}'),
  ('a4700000-0000-4000-8000-000000000004', '996000004704', 'Accountant', '{accountant}');

insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('f4700000-0000-4000-8000-000000000001', 'pair', 12, 3200, 2, 60, 2, '2002-01-01'),
  ('f4700000-0000-4000-8000-000000000002', 'pair', 12, 3600, 2, 60, 2, public.bishkek_today() - 1);

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d4700000-0000-4000-8000-000000000001', 'Group 47A', (select id from public.subjects where name = 'Математика'), 8, 'pair', 'b4700000-0000-4000-8000-000000000001', '2002-01-01', 'active'),
  ('d4700000-0000-4000-8000-000000000002', 'Group 47B', (select id from public.subjects where name = 'Химия'), 9, 'pair', 'b4700000-0000-4000-8000-000000000002', '2002-01-01', 'active');

-- S1 (A): partial 1 600 of 3 200 → 6 lessons, 7 used → debt 1 lesson.
-- S2 (A): paid in full, 15 used → 3 «в долг», then a new subscription takes them over (И37).
-- S3 (B): teacher B's student. S4 (A): paid in full, 4 used → refund 8 lessons. Friend F brought S1.
-- S5 (B): 1 000 of 3 200 → 3 lessons, 5 used → the «закрыть долг» amount must really close it (И37, ceil).
insert into public.students (id, full_name) values
  ('e4700000-0000-4000-8000-000000000001', 'S1'),
  ('e4700000-0000-4000-8000-000000000002', 'S2'),
  ('e4700000-0000-4000-8000-000000000003', 'S3'),
  ('e4700000-0000-4000-8000-000000000004', 'S4'),
  ('e4700000-0000-4000-8000-000000000005', 'S5');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('c4700000-0000-4000-8000-000000000001', 'e4700000-0000-4000-8000-000000000001', 'd4700000-0000-4000-8000-000000000001', '2002-01-01'),
  ('c4700000-0000-4000-8000-000000000002', 'e4700000-0000-4000-8000-000000000002', 'd4700000-0000-4000-8000-000000000001', '2002-01-01'),
  ('c4700000-0000-4000-8000-000000000003', 'e4700000-0000-4000-8000-000000000003', 'd4700000-0000-4000-8000-000000000002', '2002-01-01'),
  ('c4700000-0000-4000-8000-000000000004', 'e4700000-0000-4000-8000-000000000004', 'd4700000-0000-4000-8000-000000000001', '2002-01-01'),
  ('c4700000-0000-4000-8000-000000000005', 'e4700000-0000-4000-8000-000000000005', 'd4700000-0000-4000-8000-000000000002', '2002-01-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('54700000-0000-4000-8000-000000000001', 'c4700000-0000-4000-8000-000000000001', 'f4700000-0000-4000-8000-000000000001', 12, 3200, 3200, '2002-01-01'),
  ('54700000-0000-4000-8000-000000000002', 'c4700000-0000-4000-8000-000000000002', 'f4700000-0000-4000-8000-000000000001', 12, 3200, 3200, '2002-01-01'),
  ('54700000-0000-4000-8000-000000000003', 'c4700000-0000-4000-8000-000000000003', 'f4700000-0000-4000-8000-000000000001', 12, 3200, 3200, '2002-01-01'),
  ('54700000-0000-4000-8000-000000000004', 'c4700000-0000-4000-8000-000000000004', 'f4700000-0000-4000-8000-000000000001', 12, 3200, 3200, '2002-01-01'),
  ('54700000-0000-4000-8000-000000000005', 'c4700000-0000-4000-8000-000000000005', 'f4700000-0000-4000-8000-000000000001', 12, 3200, 3200, '2002-01-01');

set session_replication_role = replica;
-- 15 held lessons of group A in 2002
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at)
select ('34700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'd4700000-0000-4000-8000-000000000001',
       (select teacher_id from public.groups where id = 'd4700000-0000-4000-8000-000000000001'),
       date '2002-01-01' + n, '09:00', 60, 'held', now()
from generate_series(1, 15) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('34700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e4700000-0000-4000-8000-000000000001', '54700000-0000-4000-8000-000000000001',
       case when n = 8 then 'absent_frozen' else 'present' end::public.attendance_status
from generate_series(1, 8) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('34700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e4700000-0000-4000-8000-000000000002', '54700000-0000-4000-8000-000000000002', 'present'
from generate_series(1, 15) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('34700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'e4700000-0000-4000-8000-000000000004', '54700000-0000-4000-8000-000000000004', 'present'
from generate_series(1, 4) n;
-- 5 held lessons of group B, S5 present on all
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at)
select ('34700000-0000-4000-8000-0000000000' || (20 + n)::text)::uuid,
       'd4700000-0000-4000-8000-000000000002',
       (select teacher_id from public.groups where id = 'd4700000-0000-4000-8000-000000000002'),
       date '2002-01-01' + n, '09:00', 60, 'held', now()
from generate_series(1, 5) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('34700000-0000-4000-8000-0000000000' || (20 + n)::text)::uuid,
       'e4700000-0000-4000-8000-000000000005', '54700000-0000-4000-8000-000000000005', 'present'
from generate_series(1, 5) n;
set session_replication_role = origin;

create function pg_temp.bal(p_sub uuid)
returns table (paid_lessons integer, carried_in integer, lessons_used integer, debt_lessons integer,
               debt_som integer, refund_suggested integer)
language sql as $$
  select b.paid_lessons, b.carried_in, b.lessons_used, b.debt_lessons, b.debt_som, b.refund_suggested
  from public.v_student_balance b where b.subscription_id = p_sub;
$$;
grant execute on function pg_temp.bal(uuid) to authenticated;

-- ─── Admin records payments ─────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4700000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000001', 1600, 'mbank', null, 'половина') $$,
  'admin records a partial payment'
);
select is(
  (select created_by from public.payments where subscription_id = '54700000-0000-4000-8000-000000000001'),
  'a4700000-0000-4000-8000-000000000003'::uuid,
  'created_by is the signed-in admin'
);
select ok(
  (select abs(extract(epoch from paid_at - now())) < 5 from public.payments
   where subscription_id = '54700000-0000-4000-8000-000000000001'),
  'paid today → paid_at is DB time'
);
select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000002', 3200, 'cash', public.bishkek_today() - 3) $$,
  'admin records a payment dated three days ago'
);
select is(
  (select (paid_at at time zone 'Asia/Bishkek')::text from public.payments
   where subscription_id = '54700000-0000-4000-8000-000000000002'),
  ((public.bishkek_today() - 3) + time '12:00')::text,
  'an earlier day → noon of that day in Bishkek'
);
select throws_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000002', 100, 'cash', public.bishkek_today() + 1) $$,
  '23514', null,
  'a payment cannot be dated in the future'
);
select throws_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000002', 0, 'cash') $$,
  '23514', null,
  'amount must be positive'
);
select throws_ok(
  $$ insert into public.payments (subscription_id, amount, method) values ('54700000-0000-4000-8000-000000000002', 100, 'cash') $$,
  '42501', null,
  'И41: no write policy — even the admin writes only through the RPCs'
);
select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000003', 3200, 'mbank') $$,
  'admin records a payment for teacher B''s student'
);
select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000004', 3200, 'cash') $$,
  'admin records a full payment for S4'
);

-- ─── v_student_balance ──────────────────────────────────────────────────────
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000001') $$,
  $$ values (6, 0, 7, 1, 267, 0) $$,
  'В7.1: 1 600 of 3 200 → 6 lessons; 7 used → debt 1 lesson, 267 сом'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000002') $$,
  $$ values (12, 0, 15, 3, 800, 0) $$,
  'В7: paid in full, 15 used → 3 lessons «в долг», 800 сом'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000004') $$,
  $$ values (12, 0, 4, 0, 0, 2133) $$,
  'В8: paid in full, 4 used → refund 8 × 266,67 = 2 133'
);
select is(
  (select freezes_used from public.v_student_balance where subscription_id = '54700000-0000-4000-8000-000000000001'),
  1,
  'a freeze is counted but not used'
);

-- И37 ceil: 3 200 / 12, paid 1 000 (→ 3 lessons), 5 used → 333,33 owed → 334; paying it closes the debt
select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000005', 1000, 'cash') $$,
  'admin records 1 000 for S5'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000005') $$,
  $$ values (3, 0, 5, 2, 334, 0) $$,
  'И37: debt 2 lessons, 333,33 rounded UP to 334'
);
select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000005', 334, 'cash') $$,
  'admin records the «закрыть долг» amount'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000005') $$,
  $$ values (5, 0, 5, 0, 0, 0) $$,
  'И37: paying debt_som opens every debt lesson — no debt left'
);

-- buy_subscription: S2's next package takes over the 3 lessons «в долг» (И37)
select lives_ok(
  $$ select * from public.buy_subscription('c4700000-0000-4000-8000-000000000002', 3200, 'mbank') $$,
  'admin buys a new subscription with its payment'
);
select results_eq(
  $$ select b.paid_lessons, b.carried_in, b.lessons_used, b.debt_lessons, b.lessons_left, b.is_current
     from public.v_student_balance b
     join public.subscriptions s on s.id = b.subscription_id
     where s.enrollment_id = 'c4700000-0000-4000-8000-000000000002'
     order by s.started_at $$,
  $$ values (12, 0, 12, 0, 0, false), (10, 3, 3, 0, 9, true) $$,
  'И37: the old one is closed at 12, the new one (3 200 of 3 600 → 10 paid) starts with the 3 lessons carried, 9 left'
);
select is(
  (select price_final from public.subscriptions s
   where s.enrollment_id = 'c4700000-0000-4000-8000-000000000002' order by s.started_at desc limit 1),
  3600,
  'the new subscription is priced by the group tariff in effect today'
);
select throws_ok(
  $$ select * from public.buy_subscription('c4700000-0000-4000-8000-000000000002', 3040, 'mbank', null, null, 5, 'referral') $$,
  '23514', null,
  '5 % only for someone who brought a friend'
);
select throws_ok(
  $$ select * from public.buy_subscription('c4700000-0000-4000-8000-000000000002', 2720, 'mbank', null, null, 15, 'returning') $$,
  '23514', null,
  '15 % only on the very first subscription'
);

-- closing a debt on the same subscription: S1 pays the rest → 12 paid lessons, no debt
select lives_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000001', 1600, 'cash') $$,
  'admin records the rest'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000001') $$,
  $$ values (12, 0, 7, 0, 0, 1333) $$,
  'the rest paid → 12 lessons, no debt, 5 remaining'
);

-- refund_subscription (В8)
select throws_ok(
  $$ select public.refund_subscription('54700000-0000-4000-8000-000000000004', 2133, 'cash', '  ') $$,
  '23514', null,
  'a refund needs a reason'
);
select throws_ok(
  $$ select public.refund_subscription('54700000-0000-4000-8000-000000000004', 3300, 'cash', 'переезд') $$,
  '23514', null,
  'a refund cannot exceed what was paid'
);
select lives_ok(
  $$ select public.refund_subscription('54700000-0000-4000-8000-000000000004', 2133, 'cash', 'переезд') $$,
  'admin refunds the remaining lessons'
);
select results_eq(
  $$ select amount, kind::text, reason from public.payments
     where subscription_id = '54700000-0000-4000-8000-000000000004' and kind = 'refund' $$,
  $$ values (-2133, 'refund', 'переезд') $$,
  'the refund is a negative payment with the reason'
);
select is(
  (select status::text from public.subscriptions where id = '54700000-0000-4000-8000-000000000004'),
  'refunded',
  'the subscription is refunded'
);
select results_eq(
  $$ select status::text, end_date from public.enrollments where id = 'c4700000-0000-4000-8000-000000000004' $$,
  $$ values ('active', null::date) $$,
  'И42: a refund is only about the money — the enrollment stays active'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000004') $$,
  $$ values (4, 0, 4, 0, 0, 0) $$,
  'a refunded subscription owes nothing and suggests nothing'
);
select throws_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000004', 100, 'cash') $$,
  '23514', null,
  'no payments on a refunded subscription'
);

select ok(
  (select count(*) from public.audit_log where entity = 'payments') >= 6,
  'every payment and refund is in audit_log'
);

-- ─── Accountant reads only ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4700000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select is(
  (select count(*)::integer from public.payments where subscription_id in
     (select id from public.subscriptions where enrollment_id::text like 'c4700000%')),
  9,
  'accountant reads every payment'
);
select throws_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000003', 100, 'cash') $$,
  '42501', null,
  'accountant cannot record a payment (Г1)'
);
select throws_ok(
  $$ insert into public.payments (subscription_id, amount, method) values ('54700000-0000-4000-8000-000000000003', 100, 'cash') $$,
  '42501', null,
  'accountant cannot insert into payments'
);

-- ─── Teacher A: own students only (Д3) ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4700000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  (select count(*)::integer from public.payments where subscription_id in
     (select id from public.subscriptions where enrollment_id::text like 'c4700000%')),
  6,
  'teacher A sees payments of own students, not teacher B''s'
);
select is(
  (select count(*)::integer from public.payments where subscription_id = '54700000-0000-4000-8000-000000000003'),
  0,
  'teacher A does not see teacher B''s student payments'
);
select results_eq(
  $$ select * from pg_temp.bal('54700000-0000-4000-8000-000000000001') $$,
  $$ values (12, 0, 7, 0, 0, 1333) $$,
  'teacher A reads the balance of own student'
);
select is(
  (select count(*)::integer from public.v_student_balance where subscription_id = '54700000-0000-4000-8000-000000000003'),
  0,
  'teacher A does not see the balance of teacher B''s student'
);
select throws_ok(
  $$ select public.record_payment('54700000-0000-4000-8000-000000000001', 100, 'cash') $$,
  '42501', null,
  'teacher cannot record a payment'
);

-- ─── Payments are immutable (И41) ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4700000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ update public.payments set amount = 1 where subscription_id = '54700000-0000-4000-8000-000000000003' $$,
  'admin UPDATE goes through no policy'
);
reset role;
select is(
  (select amount from public.payments where subscription_id = '54700000-0000-4000-8000-000000000003'),
  3200,
  'И41: the admin cannot change a payment'
);
select throws_ok(
  $$ update public.payments set amount = 1 where subscription_id = '54700000-0000-4000-8000-000000000003' $$,
  '42501', null,
  'И41: payments_guard rejects UPDATE even past RLS'
);
select throws_ok(
  $$ delete from public.payments where subscription_id = '54700000-0000-4000-8000-000000000003' $$,
  '42501', null,
  'И41: payments_guard rejects DELETE even past RLS'
);
select throws_ok(
  $$ insert into public.payments (subscription_id, amount, method, kind) values ('54700000-0000-4000-8000-000000000002', -100, 'cash', 'refund') $$,
  '23514', null,
  'a refund without a reason is rejected'
);
select throws_ok(
  $$ insert into public.payments (subscription_id, amount, method) values ('54700000-0000-4000-8000-000000000002', -100, 'cash') $$,
  '23514', null,
  'a negative payment that is not a refund is rejected'
);

-- ─── Trials: «привёл друг» → referred_by_student_id (В5) ────────────────────
reset role;
set session_replication_role = replica;
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at) values
  ('34700000-0000-4000-8000-000000000099', 'd4700000-0000-4000-8000-000000000001',
   (select teacher_id from public.groups where id = 'd4700000-0000-4000-8000-000000000001'),
   public.bishkek_today() - 1, '09:00', 60, 'held', now());
insert into public.trials (id, full_name, group_id, lesson_id, status, came, source, referred_by_student_id) values
  ('74700000-0000-4000-8000-000000000001', 'Friend', 'd4700000-0000-4000-8000-000000000001',
   '34700000-0000-4000-8000-000000000099', 'attended', true, 'referral', 'e4700000-0000-4000-8000-000000000001');
set session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4700000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select * from public.enroll_trial('74700000-0000-4000-8000-000000000001', public.bishkek_today()) $$,
  'admin enrolls the friend'
);
select is(
  (select s.referred_by_student_id from public.students s join public.trials t on t.student_id = s.id
   where t.id = '74700000-0000-4000-8000-000000000001'),
  'e4700000-0000-4000-8000-000000000001'::uuid,
  'the new student keeps who brought them'
);
select lives_ok(
  $$ select * from public.buy_subscription('c4700000-0000-4000-8000-000000000001', 3420, 'cash', null, null, 5, 'referral') $$,
  'S1 now gets 5 % on the next subscription'
);

-- ─── Nobody signed in ───────────────────────────────────────────────────────
set local request.jwt.claims = '';
set local role anon;
select is(
  (select count(*)::integer from public.payments),
  0,
  'anon sees no payments'
);

select * from finish();
rollback;
