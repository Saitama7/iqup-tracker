-- #82 review (0025): a mark goes to the invoice of its month (the freeze limit does not move to the
-- old one); unused hours of every kind are credit (freezes, a lesson cancelled after the invoice, a
-- plan cut); an invoice holds its credit hours (no false debt); a credit as big as the month leaves
-- 0,5 h billed; a month not invoiced yet keeps 2 freezes; the first invoice after an old 20-lesson
-- package bills only the days after it; a plan in the past needs a reason, its preview shows the
-- money; reschedule_group moves the plans to the new weekdays; an extra lesson on a 0 h day charges
-- its duration; the backfill follows the current schedule; a transfer of an after-school enrollment
-- still on old packages works; the hour helpers are not a way around RLS. Fixtures in 2002 / 2099,
-- rolled back.
--
-- October 2002: Tue 1 … Thu 31, 23 weekdays; November 2002: Fri 1 … Fri 29, 21 weekdays.
-- Hour price 100, default 3 h, freeze limit 2, teacher 45 %.
begin;
select plan(56);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8250000-0000-4000-8000-000000000001', 'teacher825a@test.local'),
  ('a8250000-0000-4000-8000-000000000002', 'teacher825b@test.local'),
  ('a8250000-0000-4000-8000-000000000003', 'admin825@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b8250000-0000-4000-8000-000000000001', 'Teacher 825A', '996000082501'),
  ('b8250000-0000-4000-8000-000000000002', 'Teacher 825B', '996000082502');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8250000-0000-4000-8000-000000000001', '996000082501', 'Teacher 825A', '{teacher}'),
  ('a8250000-0000-4000-8000-000000000002', '996000082502', 'Teacher 825B', '{teacher}'),
  ('a8250000-0000-4000-8000-000000000003', '996000082503', 'Admin 825', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8250000-0000-4000-8000-000000000001', 45, '2002-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('afterschool', 20, 2000, 8, 180, 2, '2002-01-01', 100),
  ('group', 12, 3200, 10, 60, 2, '2002-01-01', null);

-- G1 (A: hours from October), G2 (P, Q: old 20-lesson packages), G4 (backfill: MWF → TT),
-- G5 a regular group, G3 in 2099 (reschedule)
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d8250000-0000-4000-8000-000000000001', 'Продлёнка 825-1', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8250000-0000-4000-8000-000000000001', '2002-09-01', 'active'),
  ('d8250000-0000-4000-8000-000000000002', 'Продлёнка 825-2', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8250000-0000-4000-8000-000000000001', '2002-09-01', 'active'),
  ('d8250000-0000-4000-8000-000000000003', 'Продлёнка 825-3', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8250000-0000-4000-8000-000000000001', '2099-03-01', 'active'),
  ('d8250000-0000-4000-8000-000000000004', 'Продлёнка 825-4', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8250000-0000-4000-8000-000000000001', '2002-09-01', 'active'),
  ('d8250000-0000-4000-8000-000000000005', 'Группа 825', (select id from public.subjects where name = 'Математика'), 3, 'group', 'b8250000-0000-4000-8000-000000000001', '2002-09-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g, d, '13:00', '2002-09-01'
from unnest(array['d8250000-0000-4000-8000-000000000001', 'd8250000-0000-4000-8000-000000000002']::uuid[]) g,
     generate_series(1, 5) d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8250000-0000-4000-8000-000000000003', d, '13:00', '2099-03-01' from unnest(array[1, 3, 5]) d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from, valid_to)
select 'd8250000-0000-4000-8000-000000000004', d, '13:00', '2002-09-01', '2002-09-30' from unnest(array[1, 3, 5]) d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8250000-0000-4000-8000-000000000004', d, '13:00', '2002-10-01' from unnest(array[2, 4]) d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8250000-0000-4000-8000-000000000005', d, '09:00', '2002-09-01' from unnest(array[2, 4]) d;
select public.generate_lessons(g, '2002-12-31')
from unnest(array['d8250000-0000-4000-8000-000000000001', 'd8250000-0000-4000-8000-000000000002',
                  'd8250000-0000-4000-8000-000000000004', 'd8250000-0000-4000-8000-000000000005']::uuid[]) g;
select public.generate_lessons('d8250000-0000-4000-8000-000000000003', '2099-04-30');

insert into public.students (id, full_name) values
  ('e8250000-0000-4000-8000-000000000001', 'A'),
  ('e8250000-0000-4000-8000-000000000002', 'P'),
  ('e8250000-0000-4000-8000-000000000003', 'Q'),
  ('e8250000-0000-4000-8000-000000000004', 'R'),
  ('e8250000-0000-4000-8000-000000000005', 'E'),
  ('e8250000-0000-4000-8000-000000000006', 'S');

create function pg_temp.enr(p_student uuid)
returns uuid language sql as $$
  select id from public.enrollments where student_id = p_student order by start_date limit 1;
$$;
create function pg_temp.lesson(p_group uuid, p_date date)
returns uuid language sql as $$
  select id from public.lessons where group_id = p_group and lesson_date = p_date order by is_extra limit 1;
$$;
create function pg_temp.g1(p_date date)
returns uuid language sql as $$ select pg_temp.lesson('d8250000-0000-4000-8000-000000000001', p_date); $$;
create function pg_temp.sub(p_student uuid, p_month date)
returns uuid language sql as $$
  select s.id from public.subscriptions s
  join public.enrollments e on e.id = s.enrollment_id
  where e.student_id = p_student and s.period_month = p_month and s.status <> 'refunded';
$$;
create function pg_temp.mark_sub(p_lesson uuid, p_student uuid)
returns uuid language sql as $$
  select subscription_id from public.attendance where lesson_id = p_lesson and student_id = p_student;
$$;
grant execute on function pg_temp.enr(uuid), pg_temp.lesson(uuid, date), pg_temp.g1(date),
  pg_temp.sub(uuid, date), pg_temp.mark_sub(uuid, uuid) to authenticated;

-- Old packages (prod on 14.10): P and Q in G2 from 16 September, E in G4 — no plans yet
insert into public.enrollments (student_id, group_id, start_date) values
  ('e8250000-0000-4000-8000-000000000002', 'd8250000-0000-4000-8000-000000000002', '2002-09-16'),
  ('e8250000-0000-4000-8000-000000000003', 'd8250000-0000-4000-8000-000000000002', '2002-09-16'),
  ('e8250000-0000-4000-8000-000000000005', 'd8250000-0000-4000-8000-000000000004', '2002-09-02');
insert into public.subscriptions (enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select e.id, (select id from public.tariffs where group_type = 'afterschool' and valid_from = '2002-01-01'),
       20, 2000, 2000, '2002-09-16'
from public.enrollments e
where e.student_id in ('e8250000-0000-4000-8000-000000000002', 'e8250000-0000-4000-8000-000000000003');
insert into public.payments (subscription_id, amount, method)
select s.id, 2000, 'cash' from public.subscriptions s
join public.enrollments e on e.id = s.enrollment_id
where e.student_id in ('e8250000-0000-4000-8000-000000000002', 'e8250000-0000-4000-8000-000000000003');

select is(public.afterschool_backfill_plans(), 3, 'backfill: the three old enrollments get a plan');
select is(
  (select hours::text from public.afterschool_plans where enrollment_id = pg_temp.enr('e8250000-0000-4000-8000-000000000005')),
  '{0.0,3.0,0.0,3.0,0.0,0.0,0.0}',
  'backfill follows the group''s current schedule (ВТ/ЧТ), not the one on the enrollment start (ПН/СР/ПТ)'
);

-- P: 22 marks from 16 September — 20 on the package, 14 and 15 October «в долг»; Q: 18 marks
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, e.student_id, s.id, 'present'
from public.enrollments e
join public.subscriptions s on s.enrollment_id = e.id
join public.lessons l on l.group_id = e.group_id
where e.student_id = 'e8250000-0000-4000-8000-000000000002'
  and l.lesson_date between '2002-09-16' and '2002-10-15';
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, e.student_id, s.id, 'present'
from public.enrollments e
join public.subscriptions s on s.enrollment_id = e.id
join public.lessons l on l.group_id = e.group_id
where e.student_id = 'e8250000-0000-4000-8000-000000000003'
  and l.lesson_date between '2002-09-16' and '2002-10-09';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a8250000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- ─── First invoice after an old package ─────────────────────────────────────
select is(
  public.afterschool_bill_from(pg_temp.enr('e8250000-0000-4000-8000-000000000002'), '2002-10-01'),
  '2002-10-12'::date,
  'P: the package''s 20th lesson was on 11 October — October is billed from the 12th'
);
select is(
  public.afterschool_bill_from(pg_temp.enr('e8250000-0000-4000-8000-000000000003'), '2002-10-01'),
  '2002-10-14'::date,
  'Q: 2 lessons left (10, 11 October) — billed from the first lesson day after them, the 14th'
);
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8250000-0000-4000-8000-000000000002'), '2002-10-01') $$,
  'admin issues P''s October invoice'
);
select results_eq(
  $$ select started_at, hours_total, lessons_total, price_full from public.subscriptions
     where id = pg_temp.sub('e8250000-0000-4000-8000-000000000002', '2002-10-01') $$,
  $$ values ('2002-10-12'::date, 42.0::numeric, 14, 4200) $$,
  'P''s October: 14 lesson days from the 14th × 3 h = 42 h, not the whole month (69 h)'
);
select is(
  (select count(*)::integer from public.attendance a
   where a.student_id = 'e8250000-0000-4000-8000-000000000002'
     and a.subscription_id = pg_temp.sub('e8250000-0000-4000-8000-000000000002', '2002-10-01')),
  2,
  'the package''s debt marks (14, 15 October) move to the invoice'
);
select results_eq(
  $$ select debt_lessons, lessons_left from public.v_student_balance
     where enrollment_id = pg_temp.enr('e8250000-0000-4000-8000-000000000002') and unit = 'lesson' $$,
  $$ values (0::numeric, 0::numeric) $$,
  'the package owes nothing any more'
);
select is(
  pg_temp.mark_sub(pg_temp.lesson('d8250000-0000-4000-8000-000000000002', '2002-10-11'), 'e8250000-0000-4000-8000-000000000002'),
  (select s.id from public.subscriptions s where s.enrollment_id = pg_temp.enr('e8250000-0000-4000-8000-000000000002') and s.hours_total is null),
  'the days the package covered stay on it'
);
reset role;
select is(
  public.attendance_subscription(pg_temp.lesson('d8250000-0000-4000-8000-000000000002', '2002-10-21'), 'e8250000-0000-4000-8000-000000000002'),
  pg_temp.sub('e8250000-0000-4000-8000-000000000002', '2002-10-01'),
  'a later October day goes to the invoice'
);
select is(
  public.attendance_subscription(pg_temp.lesson('d8250000-0000-4000-8000-000000000002', '2002-11-04'), 'e8250000-0000-4000-8000-000000000002'),
  null,
  'November is not invoiced yet: no subscription (not the old package, not October)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8250000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- ─── Transfers: old packages move, hours do not ─────────────────────────────
select lives_ok(
  $$ select * from public.transfer_preview(pg_temp.enr('e8250000-0000-4000-8000-000000000003'), 'd8250000-0000-4000-8000-000000000005', '2002-10-15') $$,
  'Q (after-school, old packages only) can be transferred to a regular group as in 0024'
);
select throws_ok(
  $$ select * from public.transfer_preview(pg_temp.enr('e8250000-0000-4000-8000-000000000002'), 'd8250000-0000-4000-8000-000000000005', '2002-11-01') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'P has an hour invoice — no transfer'
);
select throws_ok(
  $$ select * from public.transfer_preview(pg_temp.enr('e8250000-0000-4000-8000-000000000003'), 'd8250000-0000-4000-8000-000000000001', '2002-10-15') $$,
  '23514', 'after-school by hours: no transfer — withdraw and enroll anew',
  'no transfer into an after-school group (it would bill by hours)'
);

-- ─── A: October invoice, two freezes, November invoice ──────────────────────
select lives_ok(
  $$ select * from public.enroll_student('e8250000-0000-4000-8000-000000000001', 'd8250000-0000-4000-8000-000000000001', '2002-10-01') $$,
  'A enrolls from 1 October (default plan ПН–ПТ 3 ч)'
);
-- every invoice of A is paid in full: unused paid hours are credit (И70)
select public.record_payment(pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-10-01'),
  (select price_final from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-10-01')), 'cash');
select results_eq(
  $$ select hours_total, price_full from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-10-01') $$,
  $$ values (69.0::numeric, 6900) $$,
  'A''s October: 23 days × 3 h = 69 h'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.g1(d), jsonb_build_array(jsonb_build_object(
       'student_id', 'e8250000-0000-4000-8000-000000000001', 'status', s)))
     from (values ('2002-10-01'::date, 'present'), ('2002-10-02', 'absent_frozen'), ('2002-10-03', 'absent_frozen')) v(d, s) $$,
  '1 October present, 2 and 3 October frozen (2/2 of October)'
);
select is(
  public.afterschool_credit_hours(pg_temp.enr('e8250000-0000-4000-8000-000000000001')),
  6.0,
  'credit: the two frozen days (the rest of October is still ahead)'
);
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8250000-0000-4000-8000-000000000001'), '2002-11-01') $$,
  'admin issues November'
);
select results_eq(
  $$ select hours_total, credit_hours, price_full from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-11-01') $$,
  $$ values (57.0::numeric, 6.0::numeric, 5700) $$,
  'November: 21 days × 3 h = 63 − 6 h credit = 57 h'
);
select results_eq(
  $$ select lessons_total, paid_lessons, debt_lessons from public.v_student_balance
     where subscription_id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-11-01') $$,
  $$ values (63.0, 6.0, 0::numeric) $$,
  'the November invoice holds 57 billed + 6 credit hours; the credit counts as paid'
);
select public.record_payment(pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-11-01'),
  (select price_final from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-11-01')), 'cash');
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.g1('2002-11-01'), jsonb_build_array(jsonb_build_object(
       'student_id', 'e8250000-0000-4000-8000-000000000001', 'status', 'absent_frozen'))) $$,
  '1 November «Заморозка»: October''s 2/2 does not count'
);
select is(
  pg_temp.mark_sub(pg_temp.g1('2002-11-01'), 'e8250000-0000-4000-8000-000000000001'),
  pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-11-01'),
  'the 1 November mark goes to the November invoice, not to October''s unused hours'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.g1('2002-11-04'), jsonb_build_array(jsonb_build_object(
       'student_id', 'e8250000-0000-4000-8000-000000000001', 'status', 'absent_frozen'))) $$,
  '4 November «Заморозка» (2/2 of November)'
);
select throws_ok(
  $$ select public.confirm_lesson(pg_temp.g1('2002-11-05'), jsonb_build_array(jsonb_build_object(
       'student_id', 'e8250000-0000-4000-8000-000000000001', 'status', 'absent_frozen'))) $$,
  '23514', null,
  'a third freeze in November is refused'
);

-- ─── Unused hours of every kind are credit ──────────────────────────────────
reset role;
update public.lessons set status = 'cancelled', cancel_reason = 'center' where id = pg_temp.g1('2002-10-31');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8250000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.afterschool_credit_hours(pg_temp.enr('e8250000-0000-4000-8000-000000000001')),
  9.0,
  'credit: 31 October cancelled after the invoice (3 h) + November''s two freezes (6 h); October''s freezes are taken'
);

-- a plan in the past: preview, reason
select results_eq(
  $$ select * from public.afterschool_plan_preview(pg_temp.enr('e8250000-0000-4000-8000-000000000001'), '2002-10-01',
       array[3, 1, 3, 3, 3, 0, 0]::numeric[]) $$,
  $$ values (1, -2.0, -90, -200) $$,
  'preview of ВТ 1 ч from 1 October: one mark −2 h, teacher −90 сом (45 % × 100 × 2), student −200 сом'
);
select throws_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e8250000-0000-4000-8000-000000000001'), '2002-11-18',
       array[3, 0, 0, 0, 0, 0, 0]::numeric[]) $$,
  '23514', 'reason is required for a date in the past',
  'a date in the past needs a reason'
);
select lives_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr('e8250000-0000-4000-8000-000000000001'), '2002-11-18',
       array[3, 0, 0, 0, 0, 0, 0]::numeric[], 'мама: с 18 ноября только понедельник') $$,
  'from 18 November only Mondays, with a reason'
);
select is(
  public.afterschool_credit_hours(pg_temp.enr('e8250000-0000-4000-8000-000000000001')),
  33.0,
  'credit: the plan cut frees 24 h of November (8 days × 3 h) → 3 + 6 + 24'
);
select is(
  (select reason from public.audit_log where entity = 'afterschool_plans' and action = 'insert'
   and after ->> 'valid_from' = '2002-11-18'),
  'мама: с 18 ноября только понедельник',
  'the reason is in the journal'
);

-- ─── A month not invoiced yet: still 2 freezes ──────────────────────────────
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.g1(d), jsonb_build_array(jsonb_build_object(
       'student_id', 'e8250000-0000-4000-8000-000000000001', 'status', 'absent_frozen')))
     from unnest(array['2002-12-02', '2002-12-09']::date[]) d $$,
  'December (no invoice): two freezes'
);
select is(
  pg_temp.mark_sub(pg_temp.g1('2002-12-02'), 'e8250000-0000-4000-8000-000000000001'),
  null,
  'the December marks have no subscription yet'
);
select throws_ok(
  $$ select public.confirm_lesson(pg_temp.g1('2002-12-16'), jsonb_build_array(jsonb_build_object(
       'student_id', 'e8250000-0000-4000-8000-000000000001', 'status', 'absent_frozen'))) $$,
  '23514', 'freeze limit (2) exceeded for the month',
  'a third December freeze is refused before the invoice too'
);
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8250000-0000-4000-8000-000000000001'), '2002-12-01') $$,
  'December invoice: the credit (33 h) is bigger than the month (5 Mondays × 3 h)'
);
select public.record_payment(pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-12-01'),
  (select price_final from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-12-01')), 'cash');
select results_eq(
  $$ select hours_total, credit_hours, price_full from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-12-01') $$,
  $$ values (0.5::numeric, 14.5::numeric, 50) $$,
  'December: 0,5 h billed, 14,5 h of credit, the rest stays credit'
);
select is(
  (select count(*)::integer from public.attendance a
   where a.student_id = 'e8250000-0000-4000-8000-000000000001'
     and a.subscription_id = pg_temp.sub('e8250000-0000-4000-8000-000000000001', '2002-12-01')),
  2,
  'the December marks move to the December invoice'
);
select is(
  public.afterschool_credit_hours(pg_temp.enr('e8250000-0000-4000-8000-000000000001')),
  24.5,
  'what the December invoice did not take + its two freezes stay credit (33 − 14,5 + 6)'
);

-- ─── Rights: the hour helpers ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8250000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  public.afterschool_lesson_hours(pg_temp.g1('2002-10-07'), 'e8250000-0000-4000-8000-000000000001'),
  null,
  'another teacher does not learn a student''s hours (security invoker, RLS)'
);
select is(
  public.afterschool_day_hours('d8250000-0000-4000-8000-000000000001', 'e8250000-0000-4000-8000-000000000001', '2002-10-07'),
  null,
  'afterschool_day_hours too'
);
select throws_ok(
  $$ select public.afterschool_default_plan('d8250000-0000-4000-8000-000000000001', '2002-10-07') $$,
  '42501', null,
  'afterschool_default_plan is not callable by clients'
);
select throws_ok(
  $$ select * from public.afterschool_plan_preview(pg_temp.enr('e8250000-0000-4000-8000-000000000001'), '2002-10-01',
       array[3, 1, 3, 3, 3, 0, 0]::numeric[]) $$,
  '42501', null,
  'a teacher cannot preview a plan'
);
set local request.jwt.claims = '{"sub":"a8250000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  public.afterschool_lesson_hours(pg_temp.g1('2002-10-07'), 'e8250000-0000-4000-8000-000000000001'),
  3.0,
  'the group''s teacher sees the hours of own students'
);

-- ─── reschedule_group: ПН/СР/ПТ → ПН/ЧТ from 16 March 2099 ─────────────────
set local request.jwt.claims = '{"sub":"a8250000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select * from public.enroll_student('e8250000-0000-4000-8000-000000000004', 'd8250000-0000-4000-8000-000000000003',
       '2099-03-02', 0, 'none', array[2, 0, 1, 0, 3, 0, 0]::numeric[]) $$,
  'R enrolls with ПН 2 / СР 1 / ПТ 3'
);
select lives_ok(
  $$ select * from public.reschedule_group('d8250000-0000-4000-8000-000000000003', '2099-03-16', array[1, 4], '13:00', '2099-04-30') $$,
  'the group moves to ПН/ЧТ from 16 March'
);
select is(
  (select hours::text from public.afterschool_plans
   where enrollment_id = pg_temp.enr('e8250000-0000-4000-8000-000000000004') and valid_from = '2099-03-16'),
  '{2.0,0.0,0.0,3.0,0.0,0.0,0.0}',
  'R''s plan from that date: Monday kept (2 h), Wednesday and Friday dropped, Thursday — the default 3 h'
);
select is(
  (select hours::text from public.afterschool_plans
   where enrollment_id = pg_temp.enr('e8250000-0000-4000-8000-000000000004') and valid_from = '2099-03-02'),
  '{2.0,0.0,1.0,0.0,3.0,0.0,0.0}',
  'the plan before the change stays'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('d8250000-0000-4000-8000-000000000003', '2099-03-19'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8250000-0000-4000-8000-000000000004', 'status', 'present'))) $$,
  'Thursday 19 March: R is on the roster'
);
select results_eq(
  $$ select a.hours, a.subscription_id = pg_temp.sub('e8250000-0000-4000-8000-000000000004', '2099-03-01')
     from public.attendance a where a.lesson_id = pg_temp.lesson('d8250000-0000-4000-8000-000000000003', '2099-03-19') $$,
  $$ values (3.0, true) $$,
  'charged 3 h on the March invoice'
);
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr('e8250000-0000-4000-8000-000000000004'), '2099-04-01') $$,
  'the April invoice has hours (no «no planned hours»)'
);
select is(
  (select hours_total + credit_hours from public.subscriptions where id = pg_temp.sub('e8250000-0000-4000-8000-000000000004', '2099-04-01')),
  23.0,
  'April by the new plan: ПН 6, 13, 20, 27 × 2 h + ЧТ 2, 9, 16, 23, 30 × 3 h = 23 h'
);
select lives_ok(
  $$ select * from public.enroll_student('e8250000-0000-4000-8000-000000000006', 'd8250000-0000-4000-8000-000000000003', '2099-04-01') $$,
  'S enrolls after the change'
);
select is(
  (select hours::text from public.afterschool_plans where enrollment_id = pg_temp.enr('e8250000-0000-4000-8000-000000000006')),
  '{3.0,0.0,0.0,3.0,0.0,0.0,0.0}',
  'the default plan follows the new weekdays'
);

-- ─── An extra lesson on a 0 h day ───────────────────────────────────────────
select lives_ok(
  $$ select public.create_extra_lesson('d8250000-0000-4000-8000-000000000003', '2099-03-24', '15:00') $$,
  'an extra lesson on Tuesday 24 March (R has 0 h on Tuesdays)'
);
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('d8250000-0000-4000-8000-000000000003', '2099-03-24'), jsonb_build_array(
       jsonb_build_object('student_id', 'e8250000-0000-4000-8000-000000000004', 'status', 'present'))) $$,
  'R is on its roster'
);
select is(
  (select a.hours from public.attendance a where a.lesson_id = pg_temp.lesson('d8250000-0000-4000-8000-000000000003', '2099-03-24')),
  3.0,
  'charged the lesson''s duration (3 h), not 0'
);

select * from finish();
rollback;
