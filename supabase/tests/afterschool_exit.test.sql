-- #82 × #81 (0025 over 0024): leaving an after-school group billed by hours. A transfer from or to it (and
-- «Записан по ошибке» moving the money there or out) refuses («Ушёл» with a refund + a new enrollment
-- instead); «Ушёл» settles by the hour price
-- (remainder = hour price × unused paid hours); «Записан по ошибке» shows the payroll drop by hours —
-- the same sum v_payroll_preview loses. Fixtures in February 2004, rolled back.
--
-- February 2004: Mondays 2, 9, 16, 23; Wednesdays 4, 11, 18, 25; Fridays 6, 13, 20, 27.
-- Plan ПН 2 / СР 1 / ПТ 2 → 8 + 4 + 8 = 20 h; hour price 100 → 2 000 сом. Teacher 50 %.
begin;
select plan(19);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values ('a8200000-0000-4000-8000-000000000081', 'admin82x@test.local');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8200000-0000-4000-8000-000000000081', '996000008281', 'Admin 82x', '{admin}');
insert into public.teachers (id, full_name, phone) values
  ('b8200000-0000-4000-8000-000000000081', 'Teacher 82x', '996000008282');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8200000-0000-4000-8000-000000000081', 50, '2004-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('afterschool', 20, 7400, 8, 180, 2, '2004-01-01', 100),
  ('group', 12, 3200, 10, 60, 2, '2004-01-01', null);

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d8200000-0000-4000-8000-000000000081', 'Продлёнка 82x', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8200000-0000-4000-8000-000000000081', '2004-02-02', 'active'),
  ('d8200000-0000-4000-8000-000000000082', 'Группа 82x', (select id from public.subjects where name = 'Математика'), 3, 'group', 'b8200000-0000-4000-8000-000000000081', '2004-02-02', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8200000-0000-4000-8000-000000000081', d, '13:00', '2004-02-02' from generate_series(1, 5) d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8200000-0000-4000-8000-000000000082', d, '09:00', '2004-02-02' from unnest(array[2, 4]) d;
select public.generate_lessons(g, '2004-03-31')
from unnest(array['d8200000-0000-4000-8000-000000000081', 'd8200000-0000-4000-8000-000000000082']::uuid[]) g;

-- W — «ушёл», M — «записан по ошибке», G — a regular group student
insert into public.students (id, full_name) values
  ('e8200000-0000-4000-8000-000000000081', 'W'),
  ('e8200000-0000-4000-8000-000000000082', 'M'),
  ('e8200000-0000-4000-8000-000000000083', 'G');

create function pg_temp.enr(p_student uuid)
returns uuid language sql as $$
  select id from public.enrollments where student_id = p_student;
$$;
create function pg_temp.lesson(p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = 'd8200000-0000-4000-8000-000000000081' and lesson_date = p_date;
$$;
grant execute on function pg_temp.enr(uuid), pg_temp.lesson(date) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a8200000-0000-4000-8000-000000000081","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select public.enroll_student(s, 'd8200000-0000-4000-8000-000000000081', '2004-02-02', 0, 'none',
                             array[2, 0, 1, 0, 2, 0, 0]::numeric[])
from unnest(array['e8200000-0000-4000-8000-000000000081', 'e8200000-0000-4000-8000-000000000082']::uuid[]) s;
select public.enroll_student('e8200000-0000-4000-8000-000000000083', 'd8200000-0000-4000-8000-000000000082', '2004-02-02');
select public.record_payment(s.id, 2000, 'cash')
from public.subscriptions s where s.enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000081');

-- Mon 2: W, M present (2 h) · Wed 4: W, M present (1 h) · Fri 6: W did not come (2 h burned), M warned
select public.confirm_lesson(pg_temp.lesson('2004-02-02'), jsonb_build_array(
  jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000081', 'status', 'present'),
  jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000082', 'status', 'present')));
select public.confirm_lesson(pg_temp.lesson('2004-02-04'), jsonb_build_array(
  jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000081', 'status', 'present'),
  jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000082', 'status', 'present')));
select public.confirm_lesson(pg_temp.lesson('2004-02-06'), jsonb_build_array(
  jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000081', 'status', 'absent_burned'),
  jsonb_build_object('student_id', 'e8200000-0000-4000-8000-000000000082', 'status', 'absent_frozen')));

select results_eq(
  $$ select s.hours_total, s.price_final from public.subscriptions s
     where s.enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000081') $$,
  $$ values (20.0::numeric, 2000) $$,
  'W: the February invoice is 20 h × 100 = 2 000'
);

-- ─── Transfer from / to an after-school group refuses ───────────────────────
select throws_ok(
  $$ select * from public.transfer_preview(pg_temp.enr('e8200000-0000-4000-8000-000000000081'),
       'd8200000-0000-4000-8000-000000000082', '2004-02-10') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'transfer_preview: from the after-school group refuses'
);
select throws_ok(
  $$ select * from public.transfer_student(pg_temp.enr('e8200000-0000-4000-8000-000000000081'),
       'd8200000-0000-4000-8000-000000000082', '2004-02-10') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'transfer_student: from the after-school group refuses'
);
select public.record_payment(s.id, 3200, 'cash')
from public.subscriptions s where s.enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000083');
select throws_ok(
  $$ select * from public.delete_enrollment(pg_temp.enr('e8200000-0000-4000-8000-000000000081'), 'transfer',
       'd8200000-0000-4000-8000-000000000082', '2004-02-10') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'delete_enrollment: money out of the after-school group refuses'
);
select throws_ok(
  $$ select * from public.delete_enrollment(pg_temp.enr('e8200000-0000-4000-8000-000000000083'), 'transfer',
       'd8200000-0000-4000-8000-000000000081', '2004-02-10') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'delete_enrollment: money into the after-school group refuses'
);
select throws_ok(
  $$ select * from public.transfer_preview(pg_temp.enr('e8200000-0000-4000-8000-000000000083'),
       'd8200000-0000-4000-8000-000000000081', '2004-02-10') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'transfer_preview: to the after-school group refuses'
);
select throws_ok(
  $$ select * from public.transfer_student(pg_temp.enr('e8200000-0000-4000-8000-000000000083'),
       'd8200000-0000-4000-8000-000000000081', '2004-02-10') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'transfer_student: to the after-school group refuses'
);
select is(
  (select count(*)::integer from public.enrollments
   where student_id in ('e8200000-0000-4000-8000-000000000081', 'e8200000-0000-4000-8000-000000000083')
     and status = 'active'),
  2, 'nothing moved: both enrollments still active'
);

-- ─── «Ушёл»: remainder = hour price × unused paid hours ─────────────────────
select results_eq(
  $$ select present_marks, burned_marks, paid_som, lessons_used, hours_used, used_som, remainder,
            lesson_price, unit
     from public.enrollment_settlement(pg_temp.enr('e8200000-0000-4000-8000-000000000081')) $$,
  $$ values (2, 1, 2000, 0::numeric, 5.0::numeric, 500, 1500, 100::numeric, 'hour') $$,
  'W: paid 2 000, 5 h × 100 = 500 used (hours apart from lessons), 1 500 left, price — of an hour'
);
select results_eq(
  $$ select remainder, refunded, left_to_center from public.withdraw_enrollment(
       pg_temp.enr('e8200000-0000-4000-8000-000000000081'), '2004-02-06', 1500, 'cash') $$,
  $$ values (1500, 1500, 0) $$,
  '«ушёл» 6 Feb: 1 500 = 100 сом/ч × (20 − 5) unused paid hours, refunded'
);
select results_eq(
  $$ select b.status::text, b.paid_som, b.lessons_used, b.debt_som, b.refund_suggested
     from public.v_student_balance b where b.enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000081') $$,
  $$ values ('exhausted', 500, 5.0::numeric, 0, 0) $$,
  'W: the invoice closed on 5 h — nothing owed, nothing more to refund'
);
select is(
  (select sum(p.amount)::integer from public.payments p
   join public.subscriptions s on s.id = p.subscription_id
   where s.enrollment_id = pg_temp.enr('e8200000-0000-4000-8000-000000000081') and p.kind = 'refund'),
  -1500, 'the refund row is −1 500'
);

-- ─── «Записан по ошибке»: payroll impact by hours = drop of v_payroll_preview ─
create temp table pay82x as
select base_amount from public.v_payroll_preview
where teacher_id = 'b8200000-0000-4000-8000-000000000081' and month = '2004-02-01';
create temp table impact82x as
select * from public.enrollment_payroll_impact(pg_temp.enr('e8200000-0000-4000-8000-000000000082'));

select is(
  (select base_amount from pay82x),
  400, 'before: W 5 h + M 3 h = 8 h × 100 × 50 % = 400'
);
select results_eq(
  $$ select teacher_id, lessons, amount, hour_marks, hours from impact82x $$,
  $$ values ('b8200000-0000-4000-8000-000000000081'::uuid, 2, 150, 2, 3.0::numeric) $$,
  'M: 2 marks, 3 h × 100 × 50 % = 150 — by hours, not 2 × 7 400 / 20 × 50 %'
);
select results_eq(
  $$ select marks_deleted, money, kept from public.delete_enrollment(pg_temp.enr('e8200000-0000-4000-8000-000000000082')) $$,
  $$ values (3, 0, false) $$,
  'M deleted: 3 marks (the freeze too), no money, nothing kept'
);
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = 'b8200000-0000-4000-8000-000000000081' and month = '2004-02-01'),
  (select base_amount - (select amount from impact82x) from pay82x),
  'v_payroll_preview dropped by exactly the shown impact (400 − 150 = 250)'
);
select is(
  (select count(*)::integer from public.enrollments where student_id = 'e8200000-0000-4000-8000-000000000082'),
  0, 'M: the enrollment is gone'
);

-- ─── Seed payroll unchanged ─────────────────────────────────────────────────
select is(
  (select base_amount from public.v_payroll_preview
   where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01'),
  38160, 'seed: Гульзат, September — 38 160'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  51146, 'seed: all teachers, September — 51 146'
);

select * from finish();
rollback;
