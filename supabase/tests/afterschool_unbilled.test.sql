-- #82 review · после ревью ad8590b (И69, И70): the teacher's pay does not wait for the invoice, the
-- student's hours without an invoice are a debt, «Ушёл» bills them, credit only for paid hours, «Считать
-- с» only on the first invoice. Self-contained fixtures in October–November 2004, rolled back.
--
-- Hour price 123 (7 400 / 60 h), 45 %. 1 November 2004 is a Monday.
-- S1 (G1, T1) — 7 November days without an invoice, then «Ушёл» on 10 November;
-- S2 (G2, T2) — 2 November days without an invoice, the period is closed;
-- S3 (G3, T3) — ПН 3 ч: October 12 h unpaid, 6 h used, 6 h frozen.
begin;
select plan(35);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8690000-0000-4000-8000-000000000001', 'teacher869@test.local'),
  ('a8690000-0000-4000-8000-000000000009', 'admin869@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b8690000-0000-4000-8000-000000000001', 'Teacher 869-1', '996000008691'),
  ('b8690000-0000-4000-8000-000000000002', 'Teacher 869-2', '996000008692'),
  ('b8690000-0000-4000-8000-000000000003', 'Teacher 869-3', '996000008693');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8690000-0000-4000-8000-000000000001', '996000008691', 'Teacher 869-1', '{teacher}'),
  ('a8690000-0000-4000-8000-000000000009', '996000008699', 'Admin 869', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from)
select t, 45, '2004-01-01' from unnest(array[
  'b8690000-0000-4000-8000-000000000001', 'b8690000-0000-4000-8000-000000000002',
  'b8690000-0000-4000-8000-000000000003']::uuid[]) t;
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('afterschool', 20, 7400, 8, 180, 2, '2004-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select ('d8690000-0000-4000-8000-00000000000' || n)::uuid, 'Продлёнка 869-' || n,
       (select id from public.subjects where name = 'Математика'), 3, 'afterschool',
       ('b8690000-0000-4000-8000-00000000000' || n)::uuid, '2004-10-01', 'active'
from generate_series(1, 3) n;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select ('d8690000-0000-4000-8000-00000000000' || n)::uuid, d, '13:00', '2004-10-01'
from generate_series(1, 3) n, generate_series(1, 5) d;
select public.generate_lessons(('d8690000-0000-4000-8000-00000000000' || n)::uuid, '2004-12-31')
from generate_series(1, 3) n;

insert into public.students (id, full_name) values
  ('e8690000-0000-4000-8000-000000000001', 'S1'),
  ('e8690000-0000-4000-8000-000000000002', 'S2'),
  ('e8690000-0000-4000-8000-000000000003', 'S3');

create function pg_temp.enr(p_n integer)
returns uuid language sql as $$
  select id from public.enrollments
  where student_id = ('e8690000-0000-4000-8000-00000000000' || p_n)::uuid;
$$;
create function pg_temp.lesson(p_n integer, p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = ('d8690000-0000-4000-8000-00000000000' || p_n)::uuid and lesson_date = p_date;
$$;
create function pg_temp.mark(p_n integer, p_dates date[], p_status text)
returns void language sql as $$
  select public.confirm_lesson(pg_temp.lesson(p_n, d), jsonb_build_array(jsonb_build_object(
    'student_id', ('e8690000-0000-4000-8000-00000000000' || p_n)::uuid, 'status', p_status)))
  from unnest(p_dates) d;
$$;
create function pg_temp.pay(p_n integer)
returns text language sql as $$
  select concat_ws(' ', base_amount, no_subscription, student_hours) from public.v_payroll_preview
  where teacher_id = ('b8690000-0000-4000-8000-00000000000' || p_n)::uuid and month = '2004-11-01';
$$;
create function pg_temp.sub(p_n integer, p_month date)
returns uuid language sql as $$
  select s.id from public.subscriptions s
  where s.enrollment_id = pg_temp.enr(p_n) and s.period_month = p_month and s.status <> 'refunded';
$$;
grant execute on function pg_temp.enr(integer), pg_temp.lesson(integer, date),
  pg_temp.mark(integer, date[], text), pg_temp.pay(integer), pg_temp.sub(integer, date) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a8690000-0000-4000-8000-000000000009","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select public.enroll_student(('e8690000-0000-4000-8000-00000000000' || n)::uuid,
                             ('d8690000-0000-4000-8000-00000000000' || n)::uuid, '2004-10-01')
from generate_series(1, 2) n;
select public.enroll_student('e8690000-0000-4000-8000-000000000003', 'd8690000-0000-4000-8000-000000000003',
                             '2004-10-01', 0, 'none', array[3, 0, 0, 0, 0, 0, 0]::numeric[]);

select is(public.afterschool_hour_price_on('2004-11-01'), 123, 'hour price 7 400 / (20 × 3 h) = 123');

-- ─── Blocker A: November without an invoice ─────────────────────────────────
select pg_temp.mark(1, array['2004-11-01', '2004-11-02', '2004-11-03', '2004-11-04', '2004-11-05',
                             '2004-11-08', '2004-11-09']::date[], 'present');
select is(
  (select count(*)::integer from public.attendance a
   where a.student_id = 'e8690000-0000-4000-8000-000000000001' and a.subscription_id is null),
  7, 'S1: 7 November marks, no invoice'
);
select is(pg_temp.pay(1), '1162 0 21.0',
  'teacher paid without the invoice: 21 h × 123 × 45 % = 1 162, nothing «без абонемента»');
select results_eq(
  $$ select month, marks, hours, amount, active from public.v_afterschool_unbilled
     where enrollment_id = pg_temp.enr(1) $$,
  $$ values ('2004-11-01'::date, 7, 21.0::numeric, 2583, true) $$,
  'v_afterschool_unbilled: November 21 h = 2 583, the enrollment is on'
);
select results_eq(
  $$ select subscription_id, unit, debt_lessons, debt_som, is_current, unbilled, period_month
     from public.v_student_balance where enrollment_id = pg_temp.enr(1) and unbilled $$,
  $$ values (null::uuid, 'hour', 21.0::numeric, 2583, false, true, '2004-11-01'::date) $$,
  'v_student_balance: «долг 21 ч · 2 583 сом» for the month not invoiced'
);
select results_eq(
  $$ select amount, hour_marks, hours from public.enrollment_payroll_impact(pg_temp.enr(1)) $$,
  $$ values (1162, 7, 21.0::numeric) $$,
  'enrollment_payroll_impact: the same 1 162 for 7 days (21 h)'
);
select results_eq(
  $$ select * from public.afterschool_plan_preview(pg_temp.enr(1), '2004-11-01',
       array[2, 3, 3, 3, 3, 0, 0]::numeric[]) $$,
  $$ values (2, -2.0, -111, -246) $$,
  'afterschool_plan_preview: Mondays 1 and 8 November 3 → 2 h — teacher −111 (2 × 123 × 45 %), student −246'
);
select results_eq(
  $$ select paid_som, lessons_used, hours_used, remainder from public.enrollment_settlement(pg_temp.enr(1)) $$,
  $$ values (0, 0::numeric, 21.0::numeric, -2583) $$,
  'enrollment_settlement: the unbilled hours are in the remainder'
);
reset role;
select is(
  (select sum(x.remainder)::integer from public.subscription_settlement(pg_temp.enr(1)) x
   where x.subscription_id is null),
  -2583, 'subscription_settlement: the unbilled month is a row of its own'
);
set local role authenticated;

-- teacher's RLS: own students only
set local request.jwt.claims = '{"sub":"a8690000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  (select array_agg(distinct student_id) from public.v_afterschool_unbilled),
  array['e8690000-0000-4000-8000-000000000001']::uuid[],
  'teacher T1 sees only own student''s unbilled hours'
);
set local request.jwt.claims = '{"sub":"a8690000-0000-4000-8000-000000000009","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- «Ушёл» on 10 November: the debt is in the remainder, an invoice of the charged hours
select results_eq(
  $$ select * from public.withdraw_enrollment(pg_temp.enr(1), '2004-11-10') $$,
  $$ values (-2583, 0, 0) $$,
  '«Ушёл» 10.11: remainder −2 583 (21 h × 123), nothing refunded'
);
select results_eq(
  $$ select hours_total, lessons_total, price_full, price_final, credit_hours, started_at, status
     from public.subscriptions where id = pg_temp.sub(1, '2004-11-01') $$,
  $$ values (21.0::numeric, 7, 2583, 2583, 0.0::numeric, '2004-11-01'::date, 'exhausted'::public.subscription_status) $$,
  'November gets an invoice of exactly the 21 h charged'
);
select is(
  (select count(*)::integer from public.attendance a where a.subscription_id = pg_temp.sub(1, '2004-11-01')),
  7, 'the 7 marks moved to it'
);
select is(
  (select count(*)::integer from public.v_afterschool_unbilled where enrollment_id = pg_temp.enr(1)),
  0, 'nothing is left unbilled'
);
select is(
  (select sum(debt_som)::integer from public.v_student_balance where enrollment_id = pg_temp.enr(1)),
  2583, 'the student owes 2 583 — not lost'
);
select is(pg_temp.pay(1), '1162 0 21.0', 'the teacher''s pay did not move');
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(1), '2004-12-01') $$,
  '23514', 'enrollment is finished',
  'a finished enrollment takes no invoices — nothing needed'
);

-- ─── Blocker A: the period is closed before the invoice ─────────────────────
select pg_temp.mark(2, array['2004-11-01', '2004-11-02']::date[], 'present');
reset role;
update public.lessons set is_locked = true
where group_id = 'd8690000-0000-4000-8000-000000000002' and lesson_date between '2004-11-01' and '2004-11-30';
set local role authenticated;
select is(pg_temp.pay(2), '332 0 6.0', 'closed November: the teacher is paid 6 h × 123 × 45 % = 332');
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(2), '2004-11-01') $$,
  '23514', 'marks from this date are in a closed period',
  'the November invoice cannot take closed marks'
);
select is(
  (select debt_som from public.v_student_balance where enrollment_id = pg_temp.enr(2) and unbilled),
  738, 'the student''s debt is still visible: 6 h × 123'
);
select results_eq(
  $$ select * from public.withdraw_enrollment(pg_temp.enr(2), '2004-11-30') $$,
  $$ values (-738, 0, 0) $$,
  '«Ушёл»: the closed month''s debt is in the remainder'
);
select results_eq(
  $$ select hours, amount, active from public.v_afterschool_unbilled where enrollment_id = pg_temp.enr(2) $$,
  $$ values (6.0::numeric, 738, false) $$,
  'a closed month cannot move: it stays an unbilled debt of a finished enrollment'
);

-- ─── Blocker B: credit only for paid hours ──────────────────────────────────
select results_eq(
  $$ select hours_total, price_final from public.subscriptions where id = pg_temp.sub(3, '2004-10-01') $$,
  $$ values (12.0::numeric, 1476) $$,
  'S3 October: 4 Mondays × 3 h = 12 h × 123 = 1 476, unpaid'
);
select pg_temp.mark(3, array['2004-10-04', '2004-10-11']::date[], 'present');
select pg_temp.mark(3, array['2004-10-18', '2004-10-25']::date[], 'absent_frozen');
select is(public.afterschool_credit_hours(pg_temp.enr(3)), 0::numeric,
  '6 h used, 6 h frozen, nothing paid → no credit');
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(3), '2004-11-01') $$,
  'November invoice'
);
select results_eq(
  $$ select hours_total, credit_hours, price_final from public.subscriptions where id = pg_temp.sub(3, '2004-11-01') $$,
  $$ values (15.0::numeric, 0.0::numeric, 1845) $$,
  'November: 5 Mondays × 3 h = 15 h, no credit off it'
);
select pg_temp.mark(3, array['2004-11-01', '2004-11-08', '2004-11-15', '2004-11-22', '2004-11-29']::date[], 'present');
select is(
  (select sum(debt_som)::integer from public.v_student_balance where enrollment_id = pg_temp.enr(3)),
  2583, 'debt: October 6 h + November 15 h = 21 h × 123 = 2 583'
);
select is(
  (select remainder from public.enrollment_settlement(pg_temp.enr(3))),
  -2583, 'enrollment_settlement agrees: −2 583'
);
reset role;
select is(
  (select sum(x.remainder)::integer from public.subscription_settlement(pg_temp.enr(3)) x),
  -(select sum(debt_som)::integer from public.v_student_balance where enrollment_id = pg_temp.enr(3)),
  'balance ↔ settlement on every invoice'
);
set local role authenticated;
select public.record_payment(pg_temp.sub(3, '2004-10-01'), 738, 'cash');
select is(public.afterschool_credit_hours(pg_temp.enr(3)), 0::numeric,
  'October paid 738 (6 h) — the used hours; the frozen ones are still unpaid → no credit');
select public.record_payment(pg_temp.sub(3, '2004-10-01'), 738, 'cash');
select is(public.afterschool_credit_hours(pg_temp.enr(3)), 6.0::numeric,
  'October paid in full → its 6 frozen hours are credit for the next invoice');
reset role;
select is(
  (select sum(x.remainder)::integer from public.subscription_settlement(pg_temp.enr(3)) x),
  -(select sum(debt_som)::integer from public.v_student_balance where enrollment_id = pg_temp.enr(3))
  + (select sum(refund_suggested)::integer from public.v_student_balance where enrollment_id = pg_temp.enr(3)),
  'settlement = refund − debt after the payments'
);
set local role authenticated;

-- ─── «Считать с» only for the first invoice ─────────────────────────────────
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(3), '2004-12-01', 0, 'none', '2004-12-13') $$,
  '23514', 'billing date is only for the first invoice',
  'December from 13.12 refuses: a later invoice is billed from the 1st'
);
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(3), '2004-12-01') $$,
  'December from the 1st'
);
select is(
  (select started_at from public.subscriptions where id = pg_temp.sub(3, '2004-12-01')),
  '2004-12-01'::date, 'December starts on the 1st'
);

select * from finish();
rollback;
