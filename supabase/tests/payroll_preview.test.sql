-- Issue #13: v_payroll_preview (0011) — the formula and RLS through security_invoker.
-- Issue #35 (0012): priced by the subscription of each mark (К6), discount ignored (К3),
-- a mark without a subscription pays 0 and is counted in no_subscription.
-- Self-contained fixtures in 2001 (no seed data there), rolled back.
begin;
select plan(23);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher A, …2 teacher B, …3 accountant, …4 admin
insert into auth.users (id, email) values
  ('ad000000-0000-4000-8000-000000000001', 'teacher13a@test.local'),
  ('ad000000-0000-4000-8000-000000000002', 'teacher13b@test.local'),
  ('ad000000-0000-4000-8000-000000000003', 'accountant13@test.local'),
  ('ad000000-0000-4000-8000-000000000004', 'admin13@test.local');

insert into public.teachers (id, full_name, phone) values
  ('bd000000-0000-4000-8000-000000000001', 'Teacher A', '996000001301'),
  ('bd000000-0000-4000-8000-000000000002', 'Teacher B', '996000001302');
insert into public.profiles (id, phone, full_name, roles) values
  ('ad000000-0000-4000-8000-000000000001', '996000001301', 'Teacher A', '{teacher}'),
  ('ad000000-0000-4000-8000-000000000002', '996000001302', 'Teacher B', '{teacher}'),
  ('ad000000-0000-4000-8000-000000000003', '996000001303', 'Accountant', '{accountant}'),
  ('ad000000-0000-4000-8000-000000000004', '996000001304', 'Admin', '{admin}');

-- A: 45 %, 50 % from 16 March; B: 50 %
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('bd000000-0000-4000-8000-000000000001', 45, '1999-01-01'),
  ('bd000000-0000-4000-8000-000000000001', 50, '2001-03-16'),
  ('bd000000-0000-4000-8000-000000000002', 50, '1999-01-01');

-- group 3200 / 12 = 266,67; after-school 7400 / 20 = 370; group 3600 / 12 = 300 from April
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('fd000000-0000-4000-8000-000000000001', 'group', 12, 3200, 10, 60, 2, '1999-01-01'),
  ('fd000000-0000-4000-8000-000000000002', 'group', 12, 3600, 10, 60, 2, '2001-04-01'),
  ('fd000000-0000-4000-8000-000000000003', 'afterschool', 20, 7400, 8, 180, 2, '1999-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('dd000000-0000-4000-8000-000000000001', 'Group A', (select id from public.subjects where name = 'Математика'), 8, 'group', 'bd000000-0000-4000-8000-000000000001', '2001-01-01', 'active'),
  ('dd000000-0000-4000-8000-000000000002', 'Group B', (select id from public.subjects where name = 'Продлёнка'), 3, 'afterschool', 'bd000000-0000-4000-8000-000000000002', '2001-01-01', 'active');

insert into public.students (id, full_name) values
  ('ed000000-0000-4000-8000-000000000001', 'S1'),
  ('ed000000-0000-4000-8000-000000000002', 'S2'),
  ('ed000000-0000-4000-8000-000000000003', 'S3'),
  ('ed000000-0000-4000-8000-000000000004', 'S4'),
  ('ed000000-0000-4000-8000-000000000005', 'S5');

-- S1–S3 in group A since January (3200; S2 with −10 %: pays 2 880, the teacher gets 3 200 — К3),
-- S5 joined in April at the new 3600; S4 in after-school B.
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('cd000000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-000000000001', '2001-01-01'),
  ('cd000000-0000-4000-8000-000000000002', 'ed000000-0000-4000-8000-000000000002', 'dd000000-0000-4000-8000-000000000001', '2001-01-01'),
  ('cd000000-0000-4000-8000-000000000003', 'ed000000-0000-4000-8000-000000000003', 'dd000000-0000-4000-8000-000000000001', '2001-01-01'),
  ('cd000000-0000-4000-8000-000000000004', 'ed000000-0000-4000-8000-000000000004', 'dd000000-0000-4000-8000-000000000002', '2001-01-01'),
  ('cd000000-0000-4000-8000-000000000005', 'ed000000-0000-4000-8000-000000000005', 'dd000000-0000-4000-8000-000000000001', '2001-04-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, discount_percent, discount_reason, price_final, started_at) values
  ('5d000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 12, 3200, 0, 'none', 3200, '2001-01-01'),
  ('5d000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000002', 'fd000000-0000-4000-8000-000000000001', 12, 3200, 10, 'returning', 2880, '2001-01-01'),
  ('5d000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000003', 'fd000000-0000-4000-8000-000000000001', 12, 3200, 0, 'none', 3200, '2001-01-01'),
  ('5d000000-0000-4000-8000-000000000004', 'cd000000-0000-4000-8000-000000000004', 'fd000000-0000-4000-8000-000000000003', 20, 7400, 0, 'none', 7400, '2001-01-01'),
  ('5d000000-0000-4000-8000-000000000005', 'cd000000-0000-4000-8000-000000000005', 'fd000000-0000-4000-8000-000000000002', 12, 3600, 0, 'none', 3600, '2001-04-01');

-- Lessons of group A: …11 held (45 %), …12 held (50 %, B substitutes), …13 planned, …14 cancelled,
-- …15 held in April (new tariff); group B: …21 held, 3 hours.
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min, status, substitute_teacher_id) values
  ('2d000000-0000-4000-8000-000000000011', 'dd000000-0000-4000-8000-000000000001', '2001-03-10', '09:00', 60, 'held', null),
  ('2d000000-0000-4000-8000-000000000012', 'dd000000-0000-4000-8000-000000000001', '2001-03-20', '09:00', 60, 'held', 'bd000000-0000-4000-8000-000000000002'),
  ('2d000000-0000-4000-8000-000000000013', 'dd000000-0000-4000-8000-000000000001', '2001-03-25', '09:00', 60, 'planned', null),
  ('2d000000-0000-4000-8000-000000000014', 'dd000000-0000-4000-8000-000000000001', '2001-03-27', '09:00', 60, 'planned', null),
  ('2d000000-0000-4000-8000-000000000015', 'dd000000-0000-4000-8000-000000000001', '2001-04-03', '09:00', 60, 'held', null),
  ('2d000000-0000-4000-8000-000000000021', 'dd000000-0000-4000-8000-000000000002', '2001-03-12', '08:00', 180, 'held', null);

insert into public.attendance (lesson_id, student_id, subscription_id, status) values
  -- 2 consumed (present + burned), the freeze does not count
  ('2d000000-0000-4000-8000-000000000011', 'ed000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000001', 'present'),
  ('2d000000-0000-4000-8000-000000000011', 'ed000000-0000-4000-8000-000000000002', '5d000000-0000-4000-8000-000000000002', 'absent_burned'),
  ('2d000000-0000-4000-8000-000000000011', 'ed000000-0000-4000-8000-000000000003', '5d000000-0000-4000-8000-000000000003', 'absent_frozen'),
  ('2d000000-0000-4000-8000-000000000012', 'ed000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000001', 'present'),
  ('2d000000-0000-4000-8000-000000000012', 'ed000000-0000-4000-8000-000000000002', '5d000000-0000-4000-8000-000000000002', 'present'),
  ('2d000000-0000-4000-8000-000000000012', 'ed000000-0000-4000-8000-000000000003', '5d000000-0000-4000-8000-000000000003', 'present'),
  -- April: S1 on the 3200 subscription, S5 on the 3600 one, S3 without a subscription (И5 breach)
  ('2d000000-0000-4000-8000-000000000015', 'ed000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000001', 'present'),
  ('2d000000-0000-4000-8000-000000000015', 'ed000000-0000-4000-8000-000000000005', '5d000000-0000-4000-8000-000000000005', 'present'),
  ('2d000000-0000-4000-8000-000000000015', 'ed000000-0000-4000-8000-000000000003', null, 'present'),
  ('2d000000-0000-4000-8000-000000000021', 'ed000000-0000-4000-8000-000000000004', '5d000000-0000-4000-8000-000000000004', 'present');

select public.cancel_lesson('2d000000-0000-4000-8000-000000000014', 'center');

create function pg_temp.row_of(p_teacher uuid, p_month date)
returns table (lessons_held integer, hours numeric, student_lessons integer, base_amount integer)
language sql as $$
  select v.lessons_held, v.hours, v.student_lessons, v.base_amount
  from public.v_payroll_preview v
  where v.teacher_id = p_teacher and v.month = p_month;
$$;
grant execute on function pg_temp.row_of(uuid, date) to authenticated;

-- ─── Formula (as postgres) ──────────────────────────────────────────────────
-- March, A: 2 × 266,67 × 45 % + 3 × 266,67 × 50 % = 240 + 400 = 640; planned / cancelled not counted.
-- S2's −10 % subscription is priced at its full 3200 (К3) — with price_final it would be 628.
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000001', '2001-03-01') $$,
  $$ values (2, 2.00::numeric, 5, 640) $$,
  'teacher A, March: held only, freeze not counted, percent by the lesson date'
);
-- April, A (50 %): S1's subscription bought at 3200 keeps its price after the 3600 tariff —
-- 133,33; S5 bought at 3600 — 150; S3 without a subscription counts, pays 0 → 283,33 → 283
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000001', '2001-04-01') $$,
  $$ values (1, 1.00::numeric, 3, 283) $$,
  'teacher A, April: each mark by its subscription price, not the tariff of the lesson date (К6)'
);
select is(
  (select no_subscription from public.v_payroll_preview
   where teacher_id = 'bd000000-0000-4000-8000-000000000001' and month = '2001-04-01'),
  1,
  'a consumed mark without a subscription is counted in no_subscription'
);
select is(
  (select no_subscription from public.v_payroll_preview
   where teacher_id = 'bd000000-0000-4000-8000-000000000001' and month = '2001-03-01'),
  0,
  'no_subscription is 0 when every mark has a subscription'
);

-- К6: a tariff added later (service role import, even dated back) does not reprice held lessons
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from)
values ('group', 12, 9999, 10, 60, 2, '2001-03-01');
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000001', '2001-03-01') $$,
  $$ values (2, 2.00::numeric, 5, 640) $$,
  'К6: a new tariff after the purchase does not change the accrual'
);
-- March, B: after-school 370 × 50 % = 185, 3 hours; B's substitution in group A is not B's pay
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000002', '2001-03-01') $$,
  $$ values (1, 3.00::numeric, 1, 185) $$,
  'teacher B, March: after-school hours, substitution goes to the group teacher'
);
select is(
  (select count(*)::integer from public.v_payroll_preview
   where teacher_id in ('bd000000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002')),
  3,
  'one row per teacher and month with held lessons'
);

-- rounding once per month, not per lesson: 3 lessons × 1 student at 158,33 (mini 3800 / 12 × 50 %)
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from)
values ('fd000000-0000-4000-8000-000000000004', 'mini', 12, 3800, 4, 60, 2, '1999-01-01');
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('dd000000-0000-4000-8000-000000000003', 'Mini B', (select id from public.subjects where name = 'Химия'), 9, 'mini', 'bd000000-0000-4000-8000-000000000002', '2001-01-01', 'active');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('cd000000-0000-4000-8000-000000000006', 'ed000000-0000-4000-8000-000000000004', 'dd000000-0000-4000-8000-000000000003', '2001-01-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('5d000000-0000-4000-8000-000000000006', 'cd000000-0000-4000-8000-000000000006', 'fd000000-0000-4000-8000-000000000004', 12, 3800, 3800, '2001-01-01');
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min, status) values
  ('2d000000-0000-4000-8000-000000000031', 'dd000000-0000-4000-8000-000000000003', '2001-05-02', '10:00', 60, 'held'),
  ('2d000000-0000-4000-8000-000000000032', 'dd000000-0000-4000-8000-000000000003', '2001-05-03', '10:00', 60, 'held'),
  ('2d000000-0000-4000-8000-000000000033', 'dd000000-0000-4000-8000-000000000003', '2001-05-04', '10:00', 60, 'held');
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, 'ed000000-0000-4000-8000-000000000004', '5d000000-0000-4000-8000-000000000006', 'present'
from public.lessons l where l.group_id = 'dd000000-0000-4000-8000-000000000003';
select is(
  (select base_amount from pg_temp.row_of('bd000000-0000-4000-8000-000000000002', '2001-05-01')),
  475,
  '158,33 × 3 = 475 — rounded once in the total (per lesson would be 474)'
);

select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_payroll_preview'::regclass),
  'v_payroll_preview is security_invoker'
);
select ok(
  not has_table_privilege('anon', 'public.v_payroll_preview', 'select'),
  'anon cannot read v_payroll_preview'
);

-- ─── Teacher A: only her own rows ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select is(
  (select count(*)::integer from public.v_payroll_preview),
  2,
  'teacher A sees two rows (March, April)'
);
select is(
  (select count(*)::integer from public.v_payroll_preview where teacher_id <> 'bd000000-0000-4000-8000-000000000001'),
  0,
  'teacher A does not see other teachers (seed included)'
);
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000001', '2001-03-01') $$,
  $$ values (2, 2.00::numeric, 5, 640) $$,
  'teacher A gets the same numbers under RLS'
);

-- ─── Teacher B ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select is(
  (select count(*)::integer from public.v_payroll_preview where teacher_id = 'bd000000-0000-4000-8000-000000000001'),
  0,
  'teacher B does not see A, not even the lesson B substituted'
);
select is(
  (select count(*)::integer from public.v_payroll_preview),
  2,
  'teacher B sees her own rows (March, May)'
);

-- ─── Accountant: everyone ───────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"ad000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["accountant"]}}';

select is(
  (select count(*)::integer from public.v_payroll_preview
   where teacher_id in ('bd000000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002')),
  4,
  'accountant sees every teacher'
);
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000002', '2001-03-01') $$,
  $$ values (1, 3.00::numeric, 1, 185) $$,
  'accountant gets the same numbers'
);

-- ─── Admin: everyone, read-only (И2) ───────────────────────────────────────
set local request.jwt.claims = '{"sub":"ad000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select is(
  (select count(*)::integer from public.v_payroll_preview
   where teacher_id in ('bd000000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002')),
  4,
  'admin sees every teacher (И2)'
);
select results_eq(
  $$ select * from pg_temp.row_of('bd000000-0000-4000-8000-000000000001', '2001-03-01') $$,
  $$ values (2, 2.00::numeric, 5, 640) $$,
  'admin gets the same numbers as the accountant'
);
select throws_ok(
  $$ delete from public.v_payroll_preview $$,
  null,
  null,
  'admin cannot change v_payroll_preview — read-only'
);

-- ─── Seed: Гульзат, September 2026 = 38 160 (Б1 / Б2) ───────────────────────
select results_eq(
  $$ select student_lessons, base_amount, no_subscription from public.v_payroll_preview
     where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01' $$,
  $$ values (318, 38160, 0) $$,
  'seed: Гульзат in September — 318 student-lessons, 38 160 сом, every mark has a subscription'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  53171,
  'seed: everyone in September — 53 171 сом'
);

-- ─── Nobody signed in ───────────────────────────────────────────────────────
set local request.jwt.claims = '';
set local role anon;
select throws_ok(
  $$ select 1 from public.v_payroll_preview $$,
  '42501',
  null,
  'anon gets permission denied'
);

select * from finish();
rollback;
