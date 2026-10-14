-- Issue #81: transfer to a group of another type with the remainder of the money, «Ушёл» with a refund,
-- «Записан по ошибке» with the payroll going down (0099). Hadija's case, surplus, debt, refusals,
-- closed period, access, journal; the seed payroll stays. Fixtures in 2003 (no seed holidays), rolled back.
begin;
select plan(73);

-- ─── Seed payroll before ────────────────────────────────────────────────────
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01'),
  38160, 'seed: Гульзат in September 2026 is 38 160'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  47546, 'seed: everyone in September 2026 is 47 546'
);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8100000-0000-4000-8000-000000000001', 'admin81@test.local'),
  ('a8100000-0000-4000-8000-000000000002', 'teacher81@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b8100000-0000-4000-8000-000000000001', null, 'Teacher 81 A', '996000008101'),
  ('b8100000-0000-4000-8000-000000000002', null, 'Teacher 81 B', '996000008102');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8100000-0000-4000-8000-000000000001', '996000008100', 'Admin 81', '{admin}'),
  ('a8100000-0000-4000-8000-000000000002', '996000008101', 'Teacher 81 A', '{teacher}');
update public.teachers set user_id = 'a8100000-0000-4000-8000-000000000002'
where id = 'b8100000-0000-4000-8000-000000000001' and user_id is null;
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8100000-0000-4000-8000-000000000001', 50, '1999-01-01'),
  ('b8100000-0000-4000-8000-000000000002', 40, '1999-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('individual', 12, 7200, 1, 60, 2, '1990-01-01'),
  ('mini', 12, 3800, 4, 60, 2, '1990-01-01'),
  ('group', 12, 3200, 10, 60, 2, '1990-01-01');

-- ВТ/ЧТ 09:00 from Tue 2 Sep 2003, lessons to the end of October.
-- IND (individual, A) · MINI (mini, B) · MINI2 (mini, B) · GRP (group, A) · GRP2 (group, A) · LOCK (group, A)
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select g.id::uuid, g.name, (select id from public.subjects where name = 'Математика'), 9, g.type::public.group_type,
       g.teacher::uuid, '2003-09-02', 'active'
from (values
  ('d8100000-0000-4000-8000-000000000001', 'S81 IND', 'individual', 'b8100000-0000-4000-8000-000000000001'),
  ('d8100000-0000-4000-8000-000000000002', 'S81 MINI', 'mini', 'b8100000-0000-4000-8000-000000000002'),
  ('d8100000-0000-4000-8000-000000000003', 'S81 MINI2', 'mini', 'b8100000-0000-4000-8000-000000000002'),
  ('d8100000-0000-4000-8000-000000000004', 'S81 GRP', 'group', 'b8100000-0000-4000-8000-000000000001'),
  ('d8100000-0000-4000-8000-000000000005', 'S81 GRP2', 'group', 'b8100000-0000-4000-8000-000000000001'),
  ('d8100000-0000-4000-8000-000000000006', 'S81 LOCK', 'group', 'b8100000-0000-4000-8000-000000000001')
) as g(id, name, type, teacher);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, w, '09:00', g.start_date
from public.groups g cross join unnest(array[2, 4]) w
where g.name like 'S81 %';
select public.generate_lessons(g.id, '2003-10-31') from public.groups g where g.name like 'S81 %';

create temp table l81 as
select l.id, g.name as grp, l.lesson_date, row_number() over (partition by g.id order by l.lesson_date)::integer as n
from public.lessons l join public.groups g on g.id = l.group_id
where g.name like 'S81 %';
grant all on l81 to authenticated;

-- Students → enrollment fNN / subscription cNN, all from 2 Sep 2003 at the group's tariff:
-- 01 Hadija IND 7200 paid, 9 «был»              → MINI from 2 Oct: remainder 1 800, to pay 2 000
-- 02 Surplus IND 7200 paid, 2 «был»             → MINI2, surplus refunded
-- 03 Keep IND 7200 paid, 2 «был»                → MINI2, surplus stays
-- 04 Debt GRP 1000 paid, 6 «был»                → MINI, debt 600 moves
-- 05 Leaves GRP 3200 paid, 3 «был»              → «ушёл» 30 Sep with a refund of 2 400
-- 06 Stays GRP 3200 paid, 3 «был», 1 frozen in Oct → «ушёл» 30 Sep, money stays
-- 07 Mistake GRP no payments, 3 «был»          → deleted, payroll −400
-- 08 MistakePaid GRP 3200 paid, 2 «был»        → payments refuse, then moved to MINI (transfer pair)
-- 09 MistakeSame GRP 1000 paid, 1 «был»        → moved whole to GRP2 (#73)
-- 10 MistakeRefund GRP 3200 paid               → refunded
-- 11 Locked LOCK 3200 paid, 1 «был» locked     → refused everywhere
insert into public.students (id, full_name)
select ('e81000000000400080000000000000' || lpad(n::text, 2, '0'))::uuid, 'Student 81 ' || n
from generate_series(1, 11) n;
insert into public.enrollments (id, student_id, group_id, start_date)
select ('f81000000000400080000000000000' || lpad(n::text, 2, '0'))::uuid,
       ('e81000000000400080000000000000' || lpad(n::text, 2, '0'))::uuid,
       case when n <= 3 then 'd8100000-0000-4000-8000-000000000001'::uuid
            when n = 11 then 'd8100000-0000-4000-8000-000000000006'::uuid
            else 'd8100000-0000-4000-8000-000000000004'::uuid end,
       '2003-09-02'
from generate_series(1, 11) n;
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('c81000000000400080000000000000' || right(e.id::text, 2))::uuid, e.id, t.id, 12, t.package_price, t.package_price, e.start_date
from public.enrollments e
join public.groups g on g.id = e.group_id
join public.tariffs t on t.group_type = g.group_type and t.valid_from = '1990-01-01'
where e.id::text like 'f8100000-%';
insert into public.payments (subscription_id, amount, method, paid_at)
select ('c81000000000400080000000000000' || lpad(p.n::text, 2, '0'))::uuid, p.amount, 'cash', '2003-09-02 10:00+06'
from (values (1, 7200), (2, 7200), (3, 7200), (4, 1000), (5, 3200), (6, 3200), (8, 3200), (9, 1000), (10, 3200), (11, 3200))
  as p(n, amount);

-- marks: the first N lessons of the group «был»
update public.lessons set status = 'held'
where id in (select id from l81 where grp in ('S81 IND', 'S81 GRP', 'S81 LOCK') and n <= 9);
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, ('e81000000000400080000000000000' || lpad(m.s::text, 2, '0'))::uuid,
       ('c81000000000400080000000000000' || lpad(m.s::text, 2, '0'))::uuid, 'present'
from (values (1, 'S81 IND', 9), (2, 'S81 IND', 2), (3, 'S81 IND', 2), (4, 'S81 GRP', 6), (5, 'S81 GRP', 3),
             (6, 'S81 GRP', 3), (7, 'S81 GRP', 3), (8, 'S81 GRP', 2), (9, 'S81 GRP', 1), (11, 'S81 LOCK', 1))
  as m(s, grp, lessons)
join l81 l on l.grp = m.grp and l.n <= m.lessons;
-- 06: a «заморожен» on the 10th GRP lesson (2 Oct) — after the day they leave
update public.lessons set status = 'held' where id = (select id from l81 where grp = 'S81 GRP' and n = 10);
insert into public.attendance (lesson_id, student_id, subscription_id, status) values
  ((select id from l81 where grp = 'S81 GRP' and n = 10), 'e8100000-0000-4000-8000-000000000006',
   'c8100000-0000-4000-8000-000000000006', 'absent_frozen');
update public.lessons set is_locked = true where id = (select id from l81 where grp = 'S81 LOCK' and n = 1);

create temp table pay81 as
select base_amount from public.v_payroll_preview
where teacher_id = 'b8100000-0000-4000-8000-000000000001' and month = '2003-09-01';
grant all on pay81 to authenticated;

-- ─── Access ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8100000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select * from public.transfer_student('f8100000-0000-4000-8000-000000000001', 'd8100000-0000-4000-8000-000000000002', '2003-10-02') $$,
  '42501', null, 'a teacher cannot transfer'
);
select throws_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000005', '2003-09-30') $$,
  '42501', null, 'a teacher cannot withdraw'
);
select throws_ok(
  $$ select * from public.delete_enrollment('f8100000-0000-4000-8000-000000000007') $$,
  '42501', null, 'a teacher cannot delete an enrollment'
);
select throws_ok(
  $$ select * from public.enrollment_settlement('f8100000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a teacher cannot read the settlement'
);
reset role;
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select * from public.delete_enrollment('f8100000-0000-4000-8000-000000000007') $$,
  '42501', null, 'anon cannot call delete_enrollment'
);
select throws_ok(
  $$ select public.subscription_settlement('f8100000-0000-4000-8000-000000000001') $$,
  '42501', null, 'subscription_settlement is internal'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a8100000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- ─── Hadija: individual 7200/12, 9 lessons → mini 3800 ──────────────────────
select results_eq(
  $$ select present_marks, paid_som, lessons_used, used_som, remainder, lesson_price
     from public.enrollment_settlement('f8100000-0000-4000-8000-000000000001') $$,
  $$ values (9, 7200, 9, 5400, 1800, 600::numeric) $$,
  'Hadija: paid 7 200, 9 × 600 = 5 400 used, 1 800 left'
);
select results_eq(
  $$ select start_date, whole_move, price, remainder, to_pay, surplus
     from public.transfer_preview('f8100000-0000-4000-8000-000000000001', 'd8100000-0000-4000-8000-000000000002', '2003-10-02') $$,
  $$ values ('2003-10-02'::date, false, 3800, 1800, 2000, 0) $$,
  'Hadija preview: mini 3 800 − 1 800 = 2 000 to pay'
);
select results_eq(
  $$ select transferred, refunded, whole_move, start_date
     from public.transfer_student('f8100000-0000-4000-8000-000000000001', 'd8100000-0000-4000-8000-000000000002', '2003-10-02') $$,
  $$ values (1800, 0, false, '2003-10-02'::date) $$,
  'Hadija transferred: 1 800 moved'
);
select results_eq(
  $$ select status::text, end_date from public.enrollments where id = 'f8100000-0000-4000-8000-000000000001' $$,
  $$ values ('finished', '2003-10-01'::date) $$,
  'old enrollment ends the day before the transfer'
);
select results_eq(
  $$ select s.price_final, b.paid_som, s.price_final - b.paid_som, e.start_date
     from public.enrollments e
     join public.subscriptions s on s.enrollment_id = e.id
     join public.v_student_balance b on b.subscription_id = s.id
     where e.student_id = 'e8100000-0000-4000-8000-000000000001' and e.group_id = 'd8100000-0000-4000-8000-000000000002' $$,
  $$ values (3800, 1800, 2000, '2003-10-02'::date) $$,
  'new mini subscription: 1 800 carried, 2 000 to pay'
);
select results_eq(
  $$ select p.amount, p.kind::text, p.method::text, p.reason
     from public.payments p join public.subscriptions s on s.id = p.subscription_id
     join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = 'e8100000-0000-4000-8000-000000000001' and p.kind = 'transfer'
     order by p.amount $$,
  $$ values (-1800, 'transfer', null::text, 'перенос в Математика · S81 MINI'),
            (1800, 'transfer', null::text, 'перенос из Математика · S81 IND') $$,
  'a transfer pair: − on the old subscription, + on the new one, no method'
);
select is(
  (select count(distinct p.transfer_id)::integer from public.payments p
   join public.subscriptions s on s.id = p.subscription_id join public.enrollments e on e.id = s.enrollment_id
   where e.student_id = 'e8100000-0000-4000-8000-000000000001' and p.kind = 'transfer'),
  1, 'both rows share one transfer_id'
);
select results_eq(
  $$ select paid_som, lessons_used, debt_som, refund_suggested from public.v_student_balance
     where subscription_id = 'c8100000-0000-4000-8000-000000000001' $$,
  $$ values (5400, 9, 0, 0) $$,
  'old subscription closed on the used lessons: nothing owed, nothing to refund'
);

-- ─── Surplus ────────────────────────────────────────────────────────────────
select results_eq(
  $$ select remainder, to_pay, surplus
     from public.transfer_preview('f8100000-0000-4000-8000-000000000002', 'd8100000-0000-4000-8000-000000000003', '2003-10-02') $$,
  $$ values (6000, 0, 2200) $$,
  'surplus preview: 6 000 left, 2 200 over the mini price'
);
select throws_ok(
  $$ select * from public.transfer_student('f8100000-0000-4000-8000-000000000002', 'd8100000-0000-4000-8000-000000000003', '2003-10-02', true) $$,
  '23514', 'payment method is required for a refund', 'a surplus refund needs a method'
);
select results_eq(
  $$ select transferred, refunded
     from public.transfer_student('f8100000-0000-4000-8000-000000000002', 'd8100000-0000-4000-8000-000000000003', '2003-10-02', true, 'cash') $$,
  $$ values (3800, 2200) $$,
  'surplus refunded: 3 800 moved, 2 200 back'
);
select results_eq(
  $$ select p.amount, p.kind::text from public.payments p
     where p.subscription_id = 'c8100000-0000-4000-8000-000000000002' order by p.paid_at, p.amount $$,
  $$ values (7200, 'payment'), (-3800, 'transfer'), (-2200, 'refund') $$,
  'old subscription: payment, transfer out, refund of the surplus'
);
select is(
  (select status::text from public.subscriptions where id = 'c8100000-0000-4000-8000-000000000002'),
  'refunded', 'the subscription with a refund is refunded'
);
select results_eq(
  $$ select transferred, refunded
     from public.transfer_student('f8100000-0000-4000-8000-000000000003', 'd8100000-0000-4000-8000-000000000003', '2003-10-02') $$,
  $$ values (6000, 0) $$,
  'surplus kept: all 6 000 moves'
);
select results_eq(
  $$ select b.paid_som, b.paid_lessons from public.v_student_balance b
     join public.subscriptions s on s.id = b.subscription_id join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = 'e8100000-0000-4000-8000-000000000003' and e.group_id = 'd8100000-0000-4000-8000-000000000003' $$,
  $$ values (6000, 18) $$,
  'the surplus stays on the balance: 6 000 = 18 mini lessons'
);

-- ─── Debt ───────────────────────────────────────────────────────────────────
select results_eq(
  $$ select remainder, to_pay from public.transfer_preview('f8100000-0000-4000-8000-000000000004', 'd8100000-0000-4000-8000-000000000002', '2003-10-02') $$,
  $$ values (-600, 4400) $$,
  'debt preview: 6 × 266.67 = 1 600 used of 1 000 paid → 600 owed, 4 400 to pay'
);
select results_eq(
  $$ select transferred from public.transfer_student('f8100000-0000-4000-8000-000000000004', 'd8100000-0000-4000-8000-000000000002', '2003-10-02') $$,
  $$ values (-600) $$,
  'the debt moves'
);
select results_eq(
  $$ select b.paid_som, s.price_final - b.paid_som from public.v_student_balance b
     join public.subscriptions s on s.id = b.subscription_id join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = 'e8100000-0000-4000-8000-000000000004' and e.group_id = 'd8100000-0000-4000-8000-000000000002' $$,
  $$ values (-600, 4400) $$,
  'new subscription starts 600 in debt'
);
select is(
  (select debt_som from public.v_student_balance where subscription_id = 'c8100000-0000-4000-8000-000000000004'),
  0, 'old subscription owes nothing'
);

-- ─── Transfer refusals ──────────────────────────────────────────────────────
select throws_ok(
  $$ select * from public.transfer_student('f8100000-0000-4000-8000-000000000005', 'd8100000-0000-4000-8000-000000000002', '2003-09-04') $$,
  '23514', 'the enrollment has present or burned marks on or after 2003-09-04', '«был» after the transfer date refuses'
);
select throws_ok(
  $$ select * from public.transfer_student('f8100000-0000-4000-8000-000000000001', 'd8100000-0000-4000-8000-000000000003', '2003-10-07') $$,
  '23514', 'enrollment is finished', 'a finished enrollment is not transferred'
);
select throws_ok(
  $$ select * from public.transfer_student('f8100000-0000-4000-8000-000000000011', 'd8100000-0000-4000-8000-000000000002', '2003-09-01') $$,
  '23514', 'start date is outside the group dates', 'not before the group start'
);

-- ─── Payroll of the transfers ───────────────────────────────────────────────
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b8100000-0000-4000-8000-000000000001' and month = '2003-09-01'),
  (select base_amount from pay81),
  'the old teacher keeps the payroll of the used lessons'
);

-- ─── «Ушёл» ─────────────────────────────────────────────────────────────────
select results_eq(
  $$ select remainder from public.enrollment_settlement('f8100000-0000-4000-8000-000000000005') $$,
  $$ values (2400) $$,
  'leaves: 3 200 − 3 × 266.67 = 2 400'
);
select throws_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000005', '2003-09-30', 2401, 'cash') $$,
  '23514', 'refund must be between 0 and the remainder', 'refund over the remainder refuses'
);
select throws_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000005', '2003-09-30', 2400) $$,
  '23514', 'payment method is required for a refund', 'refund needs a method'
);
select throws_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000005', '2003-09-03') $$,
  '23514', 'the enrollment has present or burned marks after 2003-09-03', '«был» after the last day refuses'
);
select throws_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000005', '2003-09-01') $$,
  '23514', 'end date is before the enrollment start', 'not before the start'
);
select results_eq(
  $$ select remainder, refunded from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000005', '2003-09-30', 2400, 'mbank') $$,
  $$ values (2400, 2400) $$,
  'leaves with a refund of 2 400'
);
select results_eq(
  $$ select status::text, end_date from public.enrollments where id = 'f8100000-0000-4000-8000-000000000005' $$,
  $$ values ('finished', '2003-09-30'::date) $$,
  'enrollment finished on the last day'
);
select results_eq(
  $$ select amount, kind::text, method::text, reason from public.payments
     where subscription_id = 'c8100000-0000-4000-8000-000000000005' and kind = 'refund' $$,
  $$ values (-2400, 'refund', 'mbank', 'ученик ушёл из группы') $$,
  'refund entry with the default reason'
);
select is(
  (select status::text from public.subscriptions where id = 'c8100000-0000-4000-8000-000000000005'),
  'refunded', 'subscription refunded'
);
select results_eq(
  $$ select remainder, refunded from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000006', '2003-09-30') $$,
  $$ values (2400, 0) $$,
  'leaves, money stays on the balance'
);
select is(
  (select count(*)::integer from public.payments where subscription_id = 'c8100000-0000-4000-8000-000000000006'),
  1, 'no refund written'
);
select is(
  (select count(*)::integer from public.attendance where student_id = 'e8100000-0000-4000-8000-000000000006'),
  3, '«заморожен» after the last day deleted, «был» kept'
);
select throws_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000006', '2003-09-30') $$,
  '23514', 'enrollment is finished', 'twice refuses'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b8100000-0000-4000-8000-000000000001' and month = '2003-09-01'),
  (select base_amount from pay81),
  '«ушёл» keeps the payroll'
);

-- ─── «Записан по ошибке» ────────────────────────────────────────────────────
select results_eq(
  $$ select teacher_name, lessons, amount from public.enrollment_payroll_impact('f8100000-0000-4000-8000-000000000007') $$,
  $$ values ('Teacher 81 A'::text, 3, 400) $$,
  'mistake: 3 lessons × 266.67 × 50 % = 400 to Teacher A'
);
select results_eq(
  $$ select marks_deleted, money, kept from public.delete_enrollment('f8100000-0000-4000-8000-000000000007') $$,
  $$ values (3, 0, false) $$,
  'mistake without payments: 3 marks deleted, nothing kept'
);
select is(
  (select count(*)::integer from public.enrollments where id = 'f8100000-0000-4000-8000-000000000007'),
  0, 'the enrollment is gone'
);
select is(
  (select count(*)::integer from public.subscriptions where id = 'c8100000-0000-4000-8000-000000000007'),
  0, 'its subscription is gone'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b8100000-0000-4000-8000-000000000001' and month = '2003-09-01'),
  (select base_amount - 400 from pay81),
  'the payroll dropped by exactly those lessons'
);

select throws_ok(
  $$ select * from public.delete_enrollment('f8100000-0000-4000-8000-000000000008') $$,
  '23514', 'the enrollment has payments — transfer them to the right group or refund',
  'with payments a money choice is required'
);
select throws_ok(
  $$ select * from public.delete_enrollment('f8100000-0000-4000-8000-000000000008', 'refund') $$,
  '23514', 'payment method is required for a refund', 'refund needs a method'
);
select results_eq(
  $$ select marks_deleted, money, kept
     from public.delete_enrollment('f8100000-0000-4000-8000-000000000008', 'transfer', 'd8100000-0000-4000-8000-000000000002', '2003-09-02') $$,
  $$ values (2, 3200, true) $$,
  'mistake with payments → right group of another type: 3 200 moved, record kept'
);
select results_eq(
  $$ select status::text, end_date from public.enrollments where id = 'f8100000-0000-4000-8000-000000000008' $$,
  $$ values ('finished', null::date) $$,
  'the void record is on no roster'
);
select results_eq(
  $$ select b.paid_som, e.start_date from public.v_student_balance b
     join public.subscriptions s on s.id = b.subscription_id join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = 'e8100000-0000-4000-8000-000000000008' and e.group_id = 'd8100000-0000-4000-8000-000000000002' $$,
  $$ values (3200, '2003-09-02'::date) $$,
  'the money is in the right group'
);
select is(
  (select coalesce(sum(amount), 0)::integer from public.payments where subscription_id = 'c8100000-0000-4000-8000-000000000008'),
  0, 'nothing left on the mistaken subscription'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b8100000-0000-4000-8000-000000000001' and month = '2003-09-01'),
  (select base_amount - 666 from pay81),
  'payroll dropped by its 2 lessons too (400 + 2 × 133.33, rounded once)'
);

select results_eq(
  $$ select marks_deleted, money, kept
     from public.delete_enrollment('f8100000-0000-4000-8000-000000000009', 'transfer', 'd8100000-0000-4000-8000-000000000005') $$,
  $$ values (1, 1000, false) $$,
  'same type: the enrollment moves whole'
);
select results_eq(
  $$ select group_id, start_date from public.enrollments where id = 'f8100000-0000-4000-8000-000000000009' $$,
  $$ values ('d8100000-0000-4000-8000-000000000005'::uuid, '2003-09-02'::date) $$,
  'moved to GRP2 with its subscription and payment'
);

select results_eq(
  $$ select marks_deleted, money, kept
     from public.delete_enrollment('f8100000-0000-4000-8000-000000000010', 'refund', null, null, 'cash') $$,
  $$ values (0, 3200, true) $$,
  'mistake refunded'
);
select results_eq(
  $$ select p.amount, p.reason, s.status::text from public.payments p join public.subscriptions s on s.id = p.subscription_id
     where s.id = 'c8100000-0000-4000-8000-000000000010' and p.kind = 'refund' $$,
  $$ values (-3200, 'записан по ошибке', 'refunded') $$,
  'refund entry, subscription refunded'
);

-- ─── Closed period ──────────────────────────────────────────────────────────
select throws_ok(
  $$ select * from public.delete_enrollment('f8100000-0000-4000-8000-000000000011', 'refund', null, null, 'cash') $$,
  '23514', 'the enrollment has marks in a closed period', 'closed period: no delete'
);
select lives_ok(
  $$ select * from public.withdraw_enrollment('f8100000-0000-4000-8000-000000000011', '2003-09-30') $$,
  'closed period before the last day: «ушёл» is fine'
);
select is(
  (select count(*)::integer from public.attendance where student_id = 'e8100000-0000-4000-8000-000000000011'),
  1, 'the closed mark stays'
);

-- ─── Journal ────────────────────────────────────────────────────────────────
reset role;
select throws_ok(
  $$ update public.payments set amount = 1 where kind = 'transfer' $$,
  '42501', null, 'transfer rows are immutable'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'enrollments' and reason = 'transfer_student'
          and entity_id = 'f8100000-0000-4000-8000-000000000001' and action = 'update'),
  'journal: the old enrollment finished by transfer_student'
);
select is(
  (select count(*)::integer from public.audit_log where entity = 'payments' and reason = 'transfer_student'
   and (after ->> 'kind') = 'transfer' and (after ->> 'subscription_id') like 'c8100000-%01'),
  1, 'journal: the transfer row of the old subscription'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'enrollments' and reason = 'withdraw_enrollment'
          and entity_id = 'f8100000-0000-4000-8000-000000000005'),
  'journal: «ушёл»'
);
select is(
  (select count(*)::integer from public.audit_log
   where entity = 'attendance' and action = 'delete' and reason = 'delete_enrollment' and kind = 'retro'
     and (before ->> 'student_id') = 'e8100000-0000-4000-8000-000000000007'),
  3, 'journal: three deleted «был» as retro edits'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'enrollments' and action = 'delete'
          and reason = 'delete_enrollment' and entity_id = 'f8100000-0000-4000-8000-000000000007'),
  'journal: the deleted enrollment'
);
select is(
  (select kind from public.audit_log where entity = 'payments' and reason = 'delete_enrollment'
   and (after ->> 'kind') = 'refund' limit 1),
  'payment', 'journal: the refund is a payment row'
);

-- ─── Seed payroll after ─────────────────────────────────────────────────────
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01'),
  38160, 'seed: Гульзат still 38 160'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  47546, 'seed: everyone still 47 546'
);

select * from finish();
rollback;
