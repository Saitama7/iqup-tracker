-- #82 · продлёнка по часам (0025): hours of a month by the student's plan (holidays, cancelled days),
-- the monthly invoice (hours × hour price, В5 discount), charging hours present / burned, freeze →
-- credit of the next invoice, teacher's pay by hours, plan change from a date (re-prices marks, not in
-- a closed period), roster without 0 h days, rights (RLS / RPC), default plan + prod backfill, seed
-- payroll sums unchanged. Self-contained fixtures in 2002, rolled back.
--
-- March 2002: Fridays 1, 8 (holiday), 15, 22, 29; Mondays 4, 11, 18, 25; Wednesdays 6, 13, 20, 27.
-- Plan ПН 2 / СР 1 / ПТ 2 → 2 × 4 + 1 × 4 + 2 × 4 = 20 h over 12 days; hour price 100 → 2 000 сом.
-- April 2002: Mondays 1, 8, 15, 22, 29; Wednesdays 3, 10, 17, 24; Fridays 5, 12, 19, 26 → 22 h.
begin;
select plan(48);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher A (the group), …2 teacher B, …3 admin
insert into auth.users (id, email) values
  ('a8200000-0000-4000-8000-000000000001', 'teacher82a@test.local'),
  ('a8200000-0000-4000-8000-000000000002', 'teacher82b@test.local'),
  ('a8200000-0000-4000-8000-000000000003', 'admin82@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b8200000-0000-4000-8000-000000000001', 'Teacher A', '996000008201'),
  ('b8200000-0000-4000-8000-000000000002', 'Teacher B', '996000008202');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8200000-0000-4000-8000-000000000001', '996000008201', 'Teacher A', '{teacher}'),
  ('a8200000-0000-4000-8000-000000000002', '996000008202', 'Teacher B', '{teacher}'),
  ('a8200000-0000-4000-8000-000000000003', '996000008203', 'Admin', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8200000-0000-4000-8000-000000000001', 45, '2002-01-01');

insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('f8200000-0000-4000-8000-000000000001', 'afterschool', 20, 7400, 8, 180, 2, '2002-01-01', 100),
  ('f8200000-0000-4000-8000-000000000002', 'group', 12, 3200, 10, 60, 2, '2002-01-01', null);

insert into public.holidays (day, name) values ('2002-03-08', '8 марта');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d8200000-0000-4000-8000-000000000001', 'Продлёнка 82', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8200000-0000-4000-8000-000000000001', '2002-03-01', 'active'),
  ('d8200000-0000-4000-8000-000000000002', 'Группа 82', (select id from public.subjects where name = 'Математика'), 8, 'group', 'b8200000-0000-4000-8000-000000000001', '2002-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8200000-0000-4000-8000-000000000001', d, '13:00', '2002-03-01' from generate_series(1, 5) d;

select public.generate_lessons('d8200000-0000-4000-8000-000000000001', '2002-05-31');

-- A — ПН 2 / СР 1 / ПТ 2; B — default plan; C — returning (15 %); D — a regular group
insert into public.students (id, full_name, is_returning) values
  ('e8200000-0000-4000-8000-000000000001', 'A', false),
  ('e8200000-0000-4000-8000-000000000002', 'B', false),
  ('e8200000-0000-4000-8000-000000000003', 'C', true),
  ('e8200000-0000-4000-8000-000000000004', 'D', false);

create function pg_temp.enr(p_student uuid)
returns uuid language sql as $$
  select id from public.enrollments
  where student_id = p_student and group_id = 'd8200000-0000-4000-8000-000000000001';
$$;
create function pg_temp.lesson(p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = 'd8200000-0000-4000-8000-000000000001' and lesson_date = p_date;
$$;
create function pg_temp.sub(p_student uuid, p_month date)
returns uuid language sql as $$
  select s.id from public.subscriptions s
  join public.enrollments e on e.id = s.enrollment_id
  where e.student_id = p_student and s.period_month = p_month;
$$;
grant execute on function pg_temp.enr(uuid), pg_temp.lesson(date), pg_temp.sub(uuid, date) to authenticated;

-- ─── Seed payroll sums (regular groups untouched) ───────────────────────────
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01'),
  38160,
  'seed: Гульзат, September — 38 160 as before'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  47546,
  'seed: all teachers, September — 47 546 as before'
);
select is(
  public.tariff_hour_price((select id from public.tariffs where group_type = 'afterschool' and valid_from = '2026-09-01')),
  123,
  'no hour_price → 7 400 / (20 × 3 h) = 123 сом/ч'
);
select is(public.afterschool_backfill_plans(), 0, 'backfill is idempotent: the seed already has its plans');

-- ─── Admin: enroll with a plan → the March invoice ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ select * from public.enroll_student('e8200000-0000-4000-8000-000000000001', 'd8200000-0000-4000-8000-000000000001',
       '2002-03-01', 0, 'none', array[2, 0, 1, 0, 2, 0, 0]::numeric[]) $$,
  'admin enrolls A in the after-school group with ПН 2 / СР 1 / ПТ 2'
);
select is(
  (select hours::text from public.afterschool_plans where enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000001')),
  '{2.0,0.0,1.0,0.0,2.0,0.0,0.0}',
  'the plan is stored from the start date'
);
select results_eq(
  $$ select weekday, hours, days from public.afterschool_month_quote(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-03-01') $$,
  $$ values (1, 2.0, 4), (3, 1.0, 4), (5, 2.0, 4) $$,
  'March: ПН 2 ч × 4 + СР 1 ч × 4 + ПТ 2 ч × 4 (8 March is a holiday)'
);
select results_eq(
  $$ select hours_total, period_month, credit_hours, lessons_total, price_full, price_final
     from public.subscriptions where id = pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-03-01') $$,
  $$ values (20.0::numeric, '2002-03-01'::date, 0.0::numeric, 12, 2000, 2000) $$,
  'the March invoice: 20 h over 12 days × 100 сом/ч = 2 000'
);
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-03-15') $$,
  '23505', null,
  'one invoice per month'
);
select throws_ok(
  $$ select * from public.enroll_student('e8200000-0000-4000-8000-000000000004', 'd8200000-0000-4000-8000-000000000002',
       '2002-03-01', 0, 'none', array[2, 0, 1, 0, 2, 0, 0]::numeric[]) $$,
  '23514', 'a plan is for after-school groups only',
  'a plan is refused for a regular group'
);
select lives_ok(
  $$ select * from public.enroll_student('e8200000-0000-4000-8000-000000000004', 'd8200000-0000-4000-8000-000000000002', '2002-03-01') $$,
  'a regular group: the old call (5 arguments) still works'
);
select results_eq(
  $$ select s.lessons_total, s.price_full, s.hours_total from public.subscriptions s
     join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = 'e8200000-0000-4000-8000-000000000004' $$,
  $$ values (12, 3200, null::numeric) $$,
  'a regular group still gets a 12-lesson package'
);
select throws_ok(
  $$ select * from public.enroll_student('e8200000-0000-4000-8000-000000000002', 'd8200000-0000-4000-8000-000000000001',
       '2002-03-01', 0, 'none', array[5, 0, 0, 0, 0, 0, 0]::numeric[]) $$,
  '23514', null,
  'more than 4 h a day is refused'
);
select lives_ok(
  $$ select * from public.enroll_student('e8200000-0000-4000-8000-000000000002', 'd8200000-0000-4000-8000-000000000001', '2002-03-01') $$,
  'no plan given → the default one'
);
select is(
  (select hours::text from public.afterschool_plans where enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000002')),
  '{3.0,3.0,3.0,3.0,3.0,0.0,0.0}',
  'default plan: group weekdays × tariff duration (3 h)'
);
select lives_ok(
  $$ select * from public.enroll_student('e8200000-0000-4000-8000-000000000003', 'd8200000-0000-4000-8000-000000000001',
       '2002-03-18', 15, 'returning', array[2, 0, 1, 0, 2, 0, 0]::numeric[]) $$,
  'returning C enrolls from 18 March with 15 %'
);
select results_eq(
  $$ select hours_total, price_full, price_final from public.subscriptions
     where id = pg_temp.sub('e8200000-0000-4000-8000-000000000003', '2002-03-01') $$,
  $$ values (10.0::numeric, 1000, 850) $$,
  'from 18 March: ПН 18, 25 (4 h) + СР 20, 27 (2 h) + ПТ 22, 29 (4 h) = 10 h → 1 000, −15 % = 850'
);

-- ─── Payment, marks, balance ────────────────────────────────────────────────
select lives_ok(
  $$ select public.record_payment(pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-03-01'), 2000, 'cash') $$,
  'admin records the March payment'
);

select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2002-03-04'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000001', 'status', 'present'),
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000002', 'status', 'present'))) $$,
  'Monday 4 March: A and B present'
);
select throws_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2002-03-05'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000001', 'status', 'present'),
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000002', 'status', 'present'))) $$,
  '23514', null,
  'Tuesday: A has 0 h — not on the roster'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2002-03-05'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000002', 'status', 'present'))) $$,
  'Tuesday: only B is marked'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2002-03-06'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000001', 'status', 'absent_frozen'),
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000002', 'status', 'present'))) $$,
  'Wednesday 6 March: A warned (freeze)'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2002-03-15'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000001', 'status', 'absent_burned'),
       jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000002', 'status', 'present'))) $$,
  'Friday 15 March: A did not come without warning'
);
select results_eq(
  $$ select l.lesson_date, a.status::text, a.hours, a.subscription_id = pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-03-01')
     from public.attendance a join public.lessons l on l.id = a.lesson_id
     where a.student_id = 'e8200000-0000-4000-8000-000000000001' order by l.lesson_date $$,
  $$ values ('2002-03-04'::date, 'present', 2.0, true), ('2002-03-06'::date, 'absent_frozen', 1.0, true),
            ('2002-03-15'::date, 'absent_burned', 2.0, true) $$,
  'marks carry the plan hours and go to the March invoice'
);
select results_eq(
  $$ select unit, lessons_total, paid_lessons, lessons_used, lessons_left, debt_lessons, debt_som
     from public.v_student_balance where subscription_id = pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-03-01') $$,
  $$ values ('hour', 20.0, 20.0, 4.0, 16.0, 0::numeric, 0) $$,
  'balance in hours: present 2 + burned 2 = 4 h used, the freeze is not'
);
select is(
  public.afterschool_credit_hours(pg_temp.enr('e8200000-0000-4000-8000-000000000001')),
  1.0,
  'the frozen hour is credit for the next invoice'
);

-- ─── Teacher's pay by hours ─────────────────────────────────────────────────
-- A: 4 h × 100 × 45 % = 180; B (default plan, 3 h × 20 weekdays = 60 h, 6 000): 4 days present
-- = 12 h × 100 × 45 % = 540
select results_eq(
  $$ select base_amount, student_hours, student_lessons from public.v_payroll_preview
     where teacher_id = 'b8200000-0000-4000-8000-000000000001' and month = '2002-03-01' $$,
  $$ values (720, 16.0, 6) $$,
  'pay = % × charged hours × hour price of the subscription: A 4 h + B 12 h → 720'
);

-- ─── Next month: the freeze is credited ─────────────────────────────────────
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-04-01') $$,
  'admin issues the April invoice'
);
select results_eq(
  $$ select hours_total, credit_hours, price_full from public.subscriptions
     where id = pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-04-01') $$,
  $$ values (21.0::numeric, 1.0::numeric, 2100) $$,
  'April: 22 planned − 1 frozen = 21 h → 2 100'
);
select is(
  public.afterschool_credit_hours(pg_temp.enr('e8200000-0000-4000-8000-000000000001')),
  0.0,
  'the credit is used once'
);
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-03-01') $$,
  '23505', null,
  'March is already invoiced'
);
select lives_ok(
  $$ select * from public.buy_subscription(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), 500, 'mbank') $$,
  '«Новый абонемент» in the after-school group = the next month''s invoice (May) with its payment'
);
select results_eq(
  $$ select s.period_month, s.hours_total, s.price_full, (select sum(amount) from public.payments p where p.subscription_id = s.id)::integer
     from public.subscriptions s where s.id = pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-05-01') $$,
  $$ values ('2002-05-01'::date, 23.0::numeric, 2300, 500) $$,
  'May: ПН 6, 13, 20, 27 (8 h) + СР 1, 8, 15, 22, 29 (5 h) + ПТ 3, 10, 17, 24, 31 (10 h) = 23 h, 500 paid'
);

-- ─── Plan change from a date ────────────────────────────────────────────────
select lives_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-03-04', array[3, 0, 1, 0, 2, 0, 0]::numeric[], 'внесено задним числом') $$,
  'admin changes the plan from 4 March: Monday 3 h'
);
select is(
  (select a.hours from public.attendance a where a.lesson_id = pg_temp.lesson('2002-03-04')
   and a.student_id = 'e8200000-0000-4000-8000-000000000001'),
  3.0,
  'the mark from that date is re-priced by the new plan'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b8200000-0000-4000-8000-000000000001' and month = '2002-03-01'),
  765,
  'pay follows: A 5 h + B 12 h → 765'
);
select results_eq(
  $$ select hours_total, price_full from public.subscriptions
     where id = pg_temp.sub('e8200000-0000-4000-8000-000000000001', '2002-03-01') $$,
  $$ values (20.0::numeric, 2000) $$,
  'issued invoices stay as they are'
);
select lives_ok(
  $$ update public.attendance set hours = 4 where lesson_id = pg_temp.lesson('2002-03-15')
       and student_id = 'e8200000-0000-4000-8000-000000000001' $$,
  'an update that tries to set hours'
);
select is(
  (select a.hours from public.attendance a where a.lesson_id = pg_temp.lesson('2002-03-15')
   and a.student_id = 'e8200000-0000-4000-8000-000000000001'),
  2.0,
  'hours always come from the plan'
);
select throws_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-02-01', array[3, 0, 1, 0, 2, 0, 0]::numeric[]) $$,
  '23514', 'date is outside the enrollment',
  'not before the enrollment'
);

reset role;
update public.lessons set is_locked = true where id = pg_temp.lesson('2002-03-15');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-03-11', array[1, 0, 1, 0, 1, 0, 0]::numeric[], 'задним числом') $$,
  '23514', 'marks from this date are in a closed period',
  'invariant 2: no plan change over a closed period'
);

-- ─── Rights ─────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8200000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  (select count(*)::integer from public.afterschool_plans p
   where p.enrollment_id in (pg_temp.enr('e8200000-0000-4000-8000-000000000001'), pg_temp.enr('e8200000-0000-4000-8000-000000000002'))),
  3,
  'the group''s teacher reads the plans of own students (A has two versions)'
);
select throws_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-04-01', array[1, 0, 1, 0, 1, 0, 0]::numeric[]) $$,
  '42501', null,
  'a teacher cannot change a plan'
);
select throws_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-06-01') $$,
  '42501', null,
  'a teacher cannot issue an invoice'
);
select throws_ok(
  $$ insert into public.afterschool_plans (enrollment_id, valid_from, hours)
     values (pg_temp.enr('e8200000-0000-4000-8000-000000000001'), '2002-04-15', array[1, 0, 0, 0, 0, 0, 0]::numeric[]) $$,
  '42501', null,
  'no write policy: plans are written only through the RPCs'
);

set local request.jwt.claims = '{"sub":"a8200000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  (select count(*)::integer from public.afterschool_plans p
   where p.enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000001')),
  0,
  'another teacher does not see the plan'
);

reset role;
select ok(
  (select count(*) > 0 from public.audit_log where entity = 'afterschool_plans'),
  'plans are in the journal (invariant 4)'
);
select is(
  (select count(*)::integer from public.audit_log where entity = 'afterschool_plans' and reason = 'внесено задним числом'),
  1,
  'the plan change is journaled with its reason'
);

select * from finish();
rollback;
