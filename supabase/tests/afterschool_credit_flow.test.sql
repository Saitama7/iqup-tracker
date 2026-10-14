-- #82 review · после ревью e3d585d (И72, И73): credit hours that went on to a later invoice are spent
-- on the old one, paid on the new one — v_student_balance and subscription_settlement agree before and
-- after «Ушёл» and a back-dated payment; invoices go month by month. Fixtures in 2004, rolled back.
--
-- Hour price 123 (7 400 / 60 h), 45 %. Every student: ПН 3 ч. October 2004: Mondays 4, 11, 18, 25 →
-- 12 h = 1 476; November: 1, 8, 15, 22, 29 → 15 h; December: 6, 13, 20, 27 → 12 h.
-- S1 — October paid, 6 h used, 6 h frozen → November takes 6 h credit, «Ушёл» 16.11;
-- S2 — October paid after November → the credit goes to December;
-- S3 — October paid 1 000 → 8 h paid, 2 h credit;
-- S4 — November not invoiced: December waits.
begin;
select plan(24);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8720000-0000-4000-8000-000000000009', 'admin872@test.local');
insert into public.teachers (id, full_name, phone)
select ('b8720000-0000-4000-8000-00000000000' || n)::uuid, 'Teacher 872-' || n, '99600000872' || n
from generate_series(1, 4) n;
insert into public.profiles (id, phone, full_name, roles) values
  ('a8720000-0000-4000-8000-000000000009', '996000008729', 'Admin 872', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from)
select ('b8720000-0000-4000-8000-00000000000' || n)::uuid, 45, '2004-01-01' from generate_series(1, 4) n;
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('afterschool', 20, 7400, 8, 180, 2, '2004-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select ('d8720000-0000-4000-8000-00000000000' || n)::uuid, 'Продлёнка 872-' || n,
       (select id from public.subjects where name = 'Математика'), 3, 'afterschool',
       ('b8720000-0000-4000-8000-00000000000' || n)::uuid, '2004-10-01', 'active'
from generate_series(1, 4) n;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select ('d8720000-0000-4000-8000-00000000000' || n)::uuid, d, '13:00', '2004-10-01'
from generate_series(1, 4) n, generate_series(1, 5) d;
select public.generate_lessons(('d8720000-0000-4000-8000-00000000000' || n)::uuid, '2004-12-31')
from generate_series(1, 4) n;
insert into public.students (id, full_name)
select ('e8720000-0000-4000-8000-00000000000' || n)::uuid, 'S' || n from generate_series(1, 4) n;

create function pg_temp.enr(p_n integer)
returns uuid language sql as $$
  select id from public.enrollments
  where student_id = ('e8720000-0000-4000-8000-00000000000' || p_n)::uuid;
$$;
create function pg_temp.mark(p_n integer, p_dates date[], p_status text)
returns void language sql as $$
  select public.confirm_lesson(l.id, jsonb_build_array(jsonb_build_object(
    'student_id', ('e8720000-0000-4000-8000-00000000000' || p_n)::uuid, 'status', p_status)))
  from unnest(p_dates) d
  join public.lessons l
    on l.group_id = ('d8720000-0000-4000-8000-00000000000' || p_n)::uuid and l.lesson_date = d;
$$;
create function pg_temp.sub(p_n integer, p_month date)
returns uuid language sql as $$
  select s.id from public.subscriptions s
  where s.enrollment_id = pg_temp.enr(p_n) and s.period_month = p_month and s.status <> 'refunded';
$$;
-- «debt − refund in v_student_balance | −Σ subscription_settlement | −enrollment_settlement»: one number
create function pg_temp.agree(p_n integer)
returns text language sql as $$
  select concat_ws(' | ',
    (select coalesce(sum(debt_som - refund_suggested), 0)::integer from public.v_student_balance
     where enrollment_id = pg_temp.enr(p_n)),
    (select -coalesce(sum(remainder), 0)::integer from public.subscription_settlement(pg_temp.enr(p_n))),
    (select -remainder from public.enrollment_settlement(pg_temp.enr(p_n))));
$$;
-- «debt refund» of one invoice
create function pg_temp.bal(p_n integer, p_month date)
returns text language sql as $$
  select debt_som || ' ' || refund_suggested from public.v_student_balance
  where subscription_id = pg_temp.sub(p_n, p_month);
$$;
grant execute on function pg_temp.enr(integer), pg_temp.mark(integer, date[], text),
  pg_temp.sub(integer, date), pg_temp.bal(integer, date) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a8720000-0000-4000-8000-000000000009","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select public.enroll_student(('e8720000-0000-4000-8000-00000000000' || n)::uuid,
                             ('d8720000-0000-4000-8000-00000000000' || n)::uuid, '2004-10-01',
                             0, 'none', array[3, 0, 0, 0, 0, 0, 0]::numeric[])
from generate_series(1, 4) n;
select pg_temp.mark(n, array['2004-10-04', '2004-10-11']::date[], 'present') from generate_series(1, 3) n;
select pg_temp.mark(n, array['2004-10-18', '2004-10-25']::date[], 'absent_frozen') from generate_series(1, 3) n;

-- ─── Blocker C: «Ушёл» with an invoice holding credit ───────────────────────
select public.record_payment(pg_temp.sub(1, '2004-10-01'), 1476, 'cash');
select public.issue_afterschool_invoice(pg_temp.enr(1), '2004-11-01');
select results_eq(
  $$ select hours_total, credit_hours, price_final from public.subscriptions where id = pg_temp.sub(1, '2004-11-01') $$,
  $$ values (9.0::numeric, 6.0::numeric, 1107) $$,
  'S1 November: 15 h − 6 h credit = 9 h × 123 = 1 107'
);
reset role;
select results_eq(
  $$ select subscription_id, credit_out from public.afterschool_credit_flow(pg_temp.enr(1)) order by credit_out desc $$,
  $$ values (pg_temp.sub(1, '2004-10-01'), 6.0::numeric), (pg_temp.sub(1, '2004-11-01'), 0::numeric) $$,
  'the 6 credit hours went out of October'
);
set local role authenticated;
select is(pg_temp.bal(1, '2004-10-01'), '0 0', 'October: the hours that went on are spent — no refund');
select pg_temp.mark(1, array['2004-11-01', '2004-11-08', '2004-11-15']::date[], 'present');
select is(pg_temp.bal(1, '2004-11-01'), '369 0', 'November: 9 h used − 6 h credit = 3 h × 123 = 369 owed');
reset role;
select is(pg_temp.agree(1), '369 | 369 | 369', 'balance = settlement = enrollment_settlement: 369 owed');
set local role authenticated;
select results_eq(
  $$ select * from public.withdraw_enrollment(pg_temp.enr(1), '2004-11-16') $$,
  $$ values (-369, 0, 0) $$,
  '«Ушёл» 16.11: remainder −369'
);
select is(
  (select count(*)::integer from public.payments p
   join public.subscriptions s on s.id = p.subscription_id
   where s.enrollment_id = pg_temp.enr(1) and p.kind = 'transfer'),
  0, 'no money moved for the credit hours'
);
select is(
  (select sum(debt_som)::integer from public.v_student_balance where enrollment_id = pg_temp.enr(1)),
  369, 'the debtors list still has the 369'
);
reset role;
select is(pg_temp.agree(1), '369 | 369 | 369', 'after «Ушёл»: balance = settlement');
set local role authenticated;

-- ─── Blocker C: October paid after November → the credit goes to December ───
select public.issue_afterschool_invoice(pg_temp.enr(2), '2004-11-01');
select public.record_payment(pg_temp.sub(2, '2004-10-01'), 1476, 'cash');
select is(pg_temp.bal(2, '2004-10-01'), '0 738', 'October paid late: 6 h unused, 738 its surplus');
reset role;
select is(pg_temp.agree(2), '-738 | -738 | -738', 'balance = settlement before December: 738 paid, unused');
set local role authenticated;
select public.issue_afterschool_invoice(pg_temp.enr(2), '2004-12-01');
select is(
  (select credit_hours from public.subscriptions where id = pg_temp.sub(2, '2004-12-01')),
  6.0::numeric, 'December takes the 6 h credit'
);
select is(pg_temp.bal(2, '2004-10-01'), '0 0', 'October: no refund any more — the credit went on');
select is(pg_temp.bal(2, '2004-12-01'), '0 738', 'December holds the 6 paid hours: 738, once');
reset role;
select is(pg_temp.agree(2), '-738 | -738 | -738', 'balance = settlement after December — the 738 counted once');
set local role authenticated;

-- ─── Blocker C: partial payment ─────────────────────────────────────────────
select public.record_payment(pg_temp.sub(3, '2004-10-01'), 1000, 'cash');
select public.issue_afterschool_invoice(pg_temp.enr(3), '2004-11-01');
select is(
  (select credit_hours from public.subscriptions where id = pg_temp.sub(3, '2004-11-01')),
  2.0::numeric, '1 000 paid → 8 h, 6 used → 2 h credit'
);
select is(pg_temp.bal(3, '2004-10-01'), '0 16', 'October: 1 000 − 8 h × 123 = 16 left');
select pg_temp.mark(3, array['2004-11-01', '2004-11-08']::date[], 'present');
reset role;
select is(pg_temp.agree(3), '476 | 476 | 476', 'November 6 h − 2 h credit = 492 owed − 16 = 476');
set local role authenticated;
select results_eq(
  $$ select * from public.withdraw_enrollment(pg_temp.enr(3), '2004-11-09') $$,
  $$ values (-476, 0, 0) $$,
  '«Ушёл» 9.11: remainder −476'
);
reset role;
select is(pg_temp.agree(3), '476 | 476 | 476', 'after «Ушёл»: the 16 moved, the credit kept');
set local role authenticated;

-- ─── Blocker D: invoices go month by month ──────────────────────────────────
select pg_temp.mark(4, array['2004-11-01', '2004-11-08']::date[], 'present');
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(4), '2004-12-01') $$,
  '23514', 'month 2004-11 is not invoiced yet',
  'December refuses while November has marks without an invoice'
);
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(4), '2004-11-01') $$,
  'November can be invoiced'
);
select is(
  (select count(*)::integer from public.attendance a where a.subscription_id = pg_temp.sub(4, '2004-11-01')),
  2, 'the November marks are on it'
);
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr(4), '2005-01-01') $$,
  '23514', 'month 2004-12 is not invoiced yet',
  'January refuses while December (planned hours, no marks yet) has no invoice'
);

select * from finish();
rollback;
