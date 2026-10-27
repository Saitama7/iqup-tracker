-- #111 (К13) · продлёнка — пакет дней за сумму (0035): enroll_student / buy_subscription give a package
-- (12 days for 5 400 at an own price, 20 · 7 400 by default), the plan still decides the roster, a day
-- with 0 h by the plan never consumes (a plan changed backwards the old way), set_afterschool_plan from
-- a past date deletes the marks of the days that become 0 h (journal, preview with the payroll Δ), the
-- 13th day of 12 is «в долг», the teacher gets % × price_full / N a day, the month hour bill refuses.
-- Self-contained fixtures in March 2005, rolled back.
--
-- March 2005: 1 March is a Tuesday. S1 — ВТ/СР/ЧТ 3 ч, 12 days for 5 400 from 1 March; S2 — ПН/ПТ 3 ч,
-- 20 · 7 400 from 7 March. Teacher 45 %: S1 202,5 a day, S2 166,5 a day.
begin;
select plan(36);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1110000-0000-4000-8000-000000000001', 'admin111@test.local'),
  ('a1110000-0000-4000-8000-000000000002', 'teacher111@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b1110000-0000-4000-8000-000000000001', null, 'Teacher 111', '996000011101');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1110000-0000-4000-8000-000000000001', '996000011100', 'Admin 111', '{admin}'),
  ('a1110000-0000-4000-8000-000000000002', '996000011101', 'Teacher 111', '{teacher}');
update public.teachers set user_id = 'a1110000-0000-4000-8000-000000000002' where id = 'b1110000-0000-4000-8000-000000000001';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b1110000-0000-4000-8000-000000000001', 45, '1999-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from) values
  ('afterschool', 20, 7400, 8, 180, '1991-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d1110000-0000-4000-8000-000000000001', 'S111', (select id from public.subjects where name = 'Продлёнка'),
   3, 'afterschool', 'b1110000-0000-4000-8000-000000000001', '2005-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd1110000-0000-4000-8000-000000000001', d, '13:00', '2005-03-01' from generate_series(1, 5) d;
select public.generate_lessons('d1110000-0000-4000-8000-000000000001', '2005-03-31');

create function pg_temp.lesson(p_date date) returns uuid language sql as $$
  select id from public.lessons where group_id = 'd1110000-0000-4000-8000-000000000001' and lesson_date = p_date
$$;
create function pg_temp.enr(p_student uuid) returns uuid language sql as $$
  select id from public.enrollments where student_id = p_student and group_id = 'd1110000-0000-4000-8000-000000000001'
$$;
create function pg_temp.mark(p_student uuid, p_status text default 'present') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('student_id', p_student, 'status', p_status))
$$;

insert into public.students (id, full_name) values
  ('e1110000-0000-4000-8000-000000000001', 'Student 111 one'),
  ('e1110000-0000-4000-8000-000000000002', 'Student 111 two'),
  ('e1110000-0000-4000-8000-000000000003', 'Student 111 three');

-- ─── Admin: enrollment gives a package of days ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ select * from public.enroll_student('e1110000-0000-4000-8000-000000000001', 'd1110000-0000-4000-8000-000000000001',
       '2005-03-01', 0, 'none', array[0, 3, 3, 3, 0, 0, 0]::numeric[], p_lessons => 12, p_price => 5400) $$,
  'S1: ВТ/СР/ЧТ, 12 days for 5 400'
);
select results_eq(
  $$ select lessons_total, price_full, price_final, hours_total, period_month from public.subscriptions
     where enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001') $$,
  $$ values (12, 5400, 5400, null::numeric, null::date) $$,
  'S1: a package — 12 days, 5 400, no hours, no month'
);
select public.record_payment(
  (select id from public.subscriptions where enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001')),
  5400, 'cash');
select lives_ok(
  $$ select * from public.enroll_student('e1110000-0000-4000-8000-000000000002', 'd1110000-0000-4000-8000-000000000001',
       '2005-03-07', 0, 'none', array[3, 0, 0, 0, 3, 0, 0]::numeric[]) $$,
  'S2: ПН/ПТ, the default package'
);
select results_eq(
  $$ select lessons_total, price_full, hours_total from public.subscriptions
     where enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000002') $$,
  $$ values (20, 7400, null::numeric) $$,
  'S2: the tariff package — 20 days · 7 400'
);
select lives_ok(
  $$ select * from public.enroll_student('e1110000-0000-4000-8000-000000000003', 'd1110000-0000-4000-8000-000000000001',
       '2005-03-31', p_lessons => 8) $$,
  'S3 (from 31 March, after the days below): default plan, 8 days'
);
select results_eq(
  $$ select s.lessons_total, s.price_full, p.hours from public.subscriptions s
     join public.afterschool_plans p on p.enrollment_id = s.enrollment_id
     where s.enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000003') $$,
  $$ values (8, 2960, array[3, 3, 3, 3, 3, 0, 0]::numeric[]) $$,
  'S3: 8 of 20 · 7 400 → 2 960; the plan — group weekdays × 3 h'
);

-- ─── The month hour bill is off ─────────────────────────────────────────────
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e1110000-0000-4000-8000-000000000001'), '2005-04-01') $$,
  '23514', 'afterschool invoices are disabled (К13)',
  'issue_afterschool_invoice refuses'
);
select throws_ok(
  $$ select public.afterschool_bill_from(pg_temp.enr('e1110000-0000-4000-8000-000000000001'), '2005-04-01') $$,
  '23514', 'afterschool invoices are disabled (К13)',
  'afterschool_bill_from refuses'
);

-- ─── The plan decides the roster ────────────────────────────────────────────
select throws_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2005-03-04'), pg_temp.mark('e1110000-0000-4000-8000-000000000001')) $$,
  '23514', null,
  'Friday 4 March: S1 has 0 h — not on the roster'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2005-03-07'), pg_temp.mark('e1110000-0000-4000-8000-000000000002')) $$,
  'Monday 7 March: S2 only'
);

-- S1: 13 days ВТ/СР/ЧТ (1 … 29 March); S2: ПН/ПТ 11, 14, 18
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson(d), pg_temp.mark('e1110000-0000-4000-8000-000000000001'))
     from unnest(array['2005-03-01', '2005-03-02', '2005-03-03', '2005-03-08', '2005-03-09', '2005-03-10',
                       '2005-03-15', '2005-03-16', '2005-03-17', '2005-03-22', '2005-03-23', '2005-03-24',
                       '2005-03-29']::date[]) d $$,
  'S1: 13 days confirmed'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson(d), pg_temp.mark('e1110000-0000-4000-8000-000000000002'))
     from unnest(array['2005-03-11', '2005-03-14', '2005-03-18']::date[]) d $$,
  'S2: 3 more days confirmed'
);

-- ─── 12 days for 5 400: the 13th is «в долг» ────────────────────────────────
select is(
  (select count(distinct a.subscription_id)::integer from public.attendance a
   where a.student_id = 'e1110000-0000-4000-8000-000000000001'),
  1, 'S1: every day on the one package'
);
select results_eq(
  $$ select lessons_total, lessons_used, debt_lessons, debt_som from public.v_student_balance
     where enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001') $$,
  $$ values (12::numeric, 13::numeric, 1::numeric, 450) $$,
  'S1: paid 5 400, 13 of 12 — 1 day «в долг» = 450'
);
reset role;

-- ─── Teacher: % × price_full / N a day ──────────────────────────────────────
select is(
  public.lesson_pay_exact(pg_temp.lesson('2005-03-01')), 202.5,
  'S1 a day: 45 % × 5 400 / 12 = 202,5'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b1110000-0000-4000-8000-000000000001' and month = '2005-03-01'),
  3299, 'March: 13 × 202,5 + 4 × 166,5 = 3 298,5 → 3 299'
);

-- ─── A plan changed backwards: the 0 h days' marks go ───────────────────────
set local role authenticated;
select results_eq(
  $$ select marks, weekdays, payroll -> 0 ->> 'amount', payroll -> 0 ->> 'month', payroll -> 0 ->> 'marks'
     from public.afterschool_plan_preview(pg_temp.enr('e1110000-0000-4000-8000-000000000002'), '2005-03-07',
                                          array[0, 3, 0, 0, 0, 0, 0]::numeric[]) $$,
  $$ values (4, array[1, 5], '-666', '2005-03-01', '4') $$,
  'preview: 4 marks on ПН/ПТ go, the teacher −666 for March'
);
select throws_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e1110000-0000-4000-8000-000000000002'), '2005-03-07',
       array[0, 3, 0, 0, 0, 0, 0]::numeric[]) $$,
  '23514', 'reason is required for a date in the past',
  'a date in the past needs a reason'
);
select lives_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e1110000-0000-4000-8000-000000000002'), '2005-03-07',
       array[0, 3, 0, 0, 0, 0, 0]::numeric[], 'по договору только ВТ') $$,
  'S2: only ВТ from 7 March'
);
select is(
  (select count(*)::integer from public.attendance where student_id = 'e1110000-0000-4000-8000-000000000002'),
  0, 'S2: the ПН/ПТ marks are deleted'
);
select results_eq(
  $$ select action, reason, count(*)::integer from public.audit_log
     where entity = 'attendance' and before ->> 'student_id' = 'e1110000-0000-4000-8000-000000000002'
       and action = 'delete'
     group by action, reason $$,
  $$ values ('delete', 'по договору только ВТ', 4) $$,
  'journal: a delete row per mark with the reason of the change'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b1110000-0000-4000-8000-000000000001' and month = '2005-03-01'),
  2633, 'March after: 13 × 202,5 = 2 632,5 → 2 633 (the preview Δ −666)'
);

-- ─── A day with 0 h never consumes (the old way of a plan changed backwards) ─
-- as before 0035: a plan version written with the marks kept, hours re-read to 0 for ВТ
reset role;
insert into public.afterschool_plans (enrollment_id, valid_from, hours)
values (pg_temp.enr('e1110000-0000-4000-8000-000000000001'), '2005-03-22', array[0, 0, 3, 3, 0, 0, 0]);
select public.afterschool_reprice(pg_temp.enr('e1110000-0000-4000-8000-000000000001'), '2005-03-22');
select results_eq(
  $$ select l.lesson_date, a.status::text, a.hours, a.consumes_credit from public.attendance a
     join public.lessons l on l.id = a.lesson_id
     where a.student_id = 'e1110000-0000-4000-8000-000000000001' and l.lesson_date in ('2005-03-22', '2005-03-29')
     order by l.lesson_date $$,
  $$ values ('2005-03-22'::date, 'present', 0::numeric, false), ('2005-03-29'::date, 'present', 0::numeric, false) $$,
  'ВТ 22 / 29 with 0 h: still «Был», consumes nothing'
);
select results_eq(
  $$ select lessons_used, lessons_left, debt_lessons from public.v_student_balance
     where enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001') $$,
  $$ values (11::numeric, 1::numeric, 0::numeric) $$,
  'S1: 11 of 12 used, 1 left, no debt'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b1110000-0000-4000-8000-000000000001' and month = '2005-03-01'),
  2228, 'March: 11 × 202,5 = 2 227,5 → 2 228 — the 0 h days are not paid'
);
select is(
  public.lesson_pay_exact(pg_temp.lesson('2005-03-22')), 0::numeric,
  'the 0 h day pays 0'
);
update public.attendance set status = 'absent_burned'
where student_id = 'e1110000-0000-4000-8000-000000000001' and lesson_id = pg_temp.lesson('2005-03-29');
select is(
  (select consumes_credit from public.attendance
   where student_id = 'e1110000-0000-4000-8000-000000000001' and lesson_id = pg_temp.lesson('2005-03-29')),
  false, '«Не был» on a 0 h day does not consume either'
);

-- ─── buy_subscription: the next package of days ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select * from public.buy_subscription(pg_temp.enr('e1110000-0000-4000-8000-000000000001'), 5400, 'cash',
       p_lessons => 12, p_price => 5400) $$,
  'S1: the next 12 days for 5 400'
);
select results_eq(
  $$ select lessons_total, price_full, hours_total from public.subscriptions
     where enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001') order by started_at desc limit 1 $$,
  $$ values (12, 5400, null::numeric) $$,
  'buy_subscription: a package, not a month bill'
);
select is(
  (select count(*)::integer from public.v_afterschool_unbilled), 0,
  'v_afterschool_unbilled is empty'
);

-- ─── Rights ─────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select * from public.afterschool_plan_preview(pg_temp.enr('e1110000-0000-4000-8000-000000000002'), '2005-03-07',
       array[3, 3, 0, 0, 0, 0, 0]::numeric[]) $$,
  '42501', null,
  'a teacher cannot preview a plan change'
);
select throws_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e1110000-0000-4000-8000-000000000002'), '2005-03-07',
       array[3, 3, 0, 0, 0, 0, 0]::numeric[], 'x') $$,
  '42501', null,
  'a teacher cannot change a plan'
);
select is(
  (select count(*)::integer from public.afterschool_plans p
   where p.enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001')),
  2, 'the group''s teacher reads the plans of own students'
);
select throws_ok(
  $$ insert into public.afterschool_plans (enrollment_id, valid_from, hours)
     values (pg_temp.enr('e1110000-0000-4000-8000-000000000001'), '2005-03-30', array[1, 0, 0, 0, 0, 0, 0]::numeric[]) $$,
  '42501', null,
  'no write policy: plans are written only through the RPCs'
);

-- another teacher sees nothing
reset role;
insert into auth.users (id, email) values ('a1110000-0000-4000-8000-000000000003', 'teacher111b@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b1110000-0000-4000-8000-000000000002', null, 'Teacher 111 b', '996000011102');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1110000-0000-4000-8000-000000000003', '996000011102', 'Teacher 111 b', '{teacher}');
update public.teachers set user_id = 'a1110000-0000-4000-8000-000000000003' where id = 'b1110000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  (select count(*)::integer from public.afterschool_plans p
   where p.enrollment_id = pg_temp.enr('e1110000-0000-4000-8000-000000000001')),
  0, 'another teacher does not see the plan'
);
reset role;
select is(
  (select count(*)::integer from public.audit_log where entity = 'afterschool_plans' and reason = 'по договору только ВТ'),
  1, 'the plan change is journaled with its reason (invariant 4)'
);

select * from finish();
rollback;
