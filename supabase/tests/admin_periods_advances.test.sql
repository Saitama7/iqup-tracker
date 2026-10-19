-- #94 · payroll_periods (close_ / reopen_payroll_period) and update_payroll_adjustment (0028):
-- access (close — admin / accountant, reopen and edit — admin), a reason, a direct write refused,
-- the journal; a closed month locks its lessons, refuses new lessons and advances; reopen unlocks.
-- Self-contained fixtures in March 2004 (Mondays 1, 8, 15, 22, 29), rolled back.
begin;
select plan(35);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9410000-0000-4000-8000-000000000001', 'teacher941@test.local'),
  ('a9410000-0000-4000-8000-000000000003', 'admin941@test.local'),
  ('a9410000-0000-4000-8000-000000000004', 'acc941@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9410000-0000-4000-8000-000000000001', 'Teacher 941', '996000094101');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9410000-0000-4000-8000-000000000001', '996000094101', 'Teacher 941', '{teacher}'),
  ('a9410000-0000-4000-8000-000000000003', '996000094103', 'Admin 941', '{admin}'),
  ('a9410000-0000-4000-8000-000000000004', '996000094104', 'Accountant 941', '{accountant}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b9410000-0000-4000-8000-000000000001', 40, '2004-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
values ('mini', 12, 3200, 6, 60, '2004-01-01');
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d9410000-0000-4000-8000-000000000001', 'Group 941', (select id from public.subjects where name = 'Математика'),
   8, 'mini', 'b9410000-0000-4000-8000-000000000001', '2004-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from) values
  ('d9410000-0000-4000-8000-000000000001', 1, '15:00', '2004-03-01');
select public.generate_lessons('d9410000-0000-4000-8000-000000000001', '2004-04-30');

create function pg_temp.lesson(p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = 'd9410000-0000-4000-8000-000000000001' and lesson_date = p_date;
$$;
grant execute on function pg_temp.lesson(date) to authenticated, anon;

-- ─── Advance fixture ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select public.issue_advance('b9410000-0000-4000-8000-000000000001', 1000, '2004-03-10', '2004-03-01', 'аванс');
create temp table adv as
select id from public.payroll_adjustments where teacher_id = 'b9410000-0000-4000-8000-000000000001';
reset role;
grant select on adv to authenticated, anon;
set local role authenticated;

-- ─── update_payroll_adjustment: access ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.update_payroll_adjustment((select id from adv), 1500, null, null, 'аванс', 'ошибка') $$,
  '42501', null, 'the accountant cannot edit an advance'
);
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.update_payroll_adjustment((select id from adv), 1500, null, null, 'аванс', 'ошибка') $$,
  '42501', null, 'the teacher cannot edit an advance'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.update_payroll_adjustment('00000000-0000-4000-8000-000000000000', 1500, null, null, null, 'x') $$,
  '42501', null, 'anon cannot edit an advance'
);
reset role;
select throws_ok(
  $$ update public.payroll_adjustments set amount = 1 where id = (select id from adv) $$,
  '42501', null, 'a direct update is refused by the guard (service role too)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
update public.payroll_adjustments set amount = 1 where id = (select id from adv);
select is(
  (select amount from public.payroll_adjustments where id = (select id from adv)), 1000,
  'a direct update of the admin changes nothing (no write policy)'
);

-- ─── update_payroll_adjustment: rules ───────────────────────────────────────
select throws_ok(
  $$ select public.update_payroll_adjustment((select id from adv), 1500, null, null, 'аванс', '  ') $$,
  '23514', 'reason is required', 'a reason is required'
);
select throws_ok(
  $$ select public.update_payroll_adjustment((select id from adv), 0, null, null, 'аванс', 'ошибка') $$,
  '23514', 'amount must be positive', 'the amount is positive'
);
select throws_like(
  $$ select public.update_payroll_adjustment((select id from adv), 1500, null, '2004-06-01', 'аванс', 'ошибка') $$,
  '%is not next to the issue date%', 'the month is that of the issue date or a neighbour'
);
select throws_ok(
  $$ select public.update_payroll_adjustment((select id from adv), 1500, public.bishkek_today() + 1,
       date_trunc('month', public.bishkek_today() + 1)::date, 'аванс', 'ошибка') $$,
  '23514', 'advance date is in the future', 'the issue date is not in the future'
);
select lives_ok(
  $$ select public.update_payroll_adjustment((select id from adv), 1500, '2004-03-12', '2004-04-01', 'аванс за апрель', 'ошиблись суммой') $$,
  'the admin edits amount, date, month and comment'
);
select results_eq(
  $$ select amount, issued_on, month, comment, created_by from public.payroll_adjustments where id = (select id from adv) $$,
  $$ values (1500, '2004-03-12'::date, '2004-04-01'::date, 'аванс за апрель'::text, 'a9410000-0000-4000-8000-000000000003'::uuid) $$,
  'the row is changed, the author stays'
);
select is(
  (select advances from public.v_payroll_preview
   where teacher_id = 'b9410000-0000-4000-8000-000000000001' and month = '2004-04-01'),
  1500, 'the payroll preview follows'
);
select results_eq(
  $$ select action, reason, (before ->> 'amount')::int, (after ->> 'amount')::int from public.audit_log
     where entity = 'payroll_adjustments' and entity_id = (select id from adv) and action = 'update' $$,
  $$ values ('update'::text, 'ошиблись суммой'::text, 1000, 1500) $$,
  'the journal has the edit with its reason'
);
select public.update_payroll_adjustment((select id from adv), 1000, '2004-03-12', '2004-03-01', 'аванс', 'назад в март');

-- ─── close_payroll_period ───────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.close_payroll_period('2004-03-01', null) $$,
  '42501', null, 'the teacher cannot close a period'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.close_payroll_period('2004-03-01', null) $$,
  '42501', null, 'anon cannot close a period'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ insert into public.payroll_periods (month) values ('2004-02-01') $$,
  '42501', null, 'a direct insert is refused'
);
select throws_ok(
  $$ select public.close_payroll_period(public.bishkek_today(), null) $$,
  '23514', null, 'the current month is not over — not closed'
);

set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select is(
  public.close_payroll_period('2004-03-15', 'сверено'), 5,
  'the accountant closes March 2004 (any day of it) — its 5 lessons are locked'
);
select is(
  (select count(*)::integer from public.lessons
   where group_id = 'd9410000-0000-4000-8000-000000000001' and is_locked),
  5, 'only the March lessons are locked'
);
select results_eq(
  $$ select month, comment, closed_by from public.payroll_periods where month = '2004-03-01' $$,
  $$ values ('2004-03-01'::date, 'сверено'::text, 'a9410000-0000-4000-8000-000000000004'::uuid) $$,
  'the period row: month, comment, who closed'
);
select is(
  (select count(*)::integer from public.audit_log a
   where a.entity = 'payroll_periods' and a.action = 'insert' and a.after ->> 'month' = '2004-03-01'),
  1, 'the journal has the closing'
);
select is_empty(
  $$ select 1 from public.audit_log a
     where a.entity = 'lessons' and a.action = 'update'
       and a.entity_id in (select id from public.lessons where group_id = 'd9410000-0000-4000-8000-000000000001') $$,
  'locking the lessons writes no lesson rows to the journal'
);
select throws_like(
  $$ select public.close_payroll_period('2004-03-01', null) $$,
  '%already closed%', 'a closed month is not closed again'
);

-- the wall: nothing new in March, advances refused, lessons locked
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_like(
  $$ select public.create_extra_lesson('d9410000-0000-4000-8000-000000000001', '2004-03-17', '16:00') $$,
  '%is closed%', 'no lesson is added to a closed month'
);
select throws_like(
  $$ select public.issue_advance('b9410000-0000-4000-8000-000000000001', 500, '2004-03-20', '2004-03-01') $$,
  '%is closed%', 'no advance in a closed month'
);
select throws_like(
  $$ select public.update_payroll_adjustment((select id from adv), 900, null, null, 'аванс', 'ошибка') $$,
  '%is closed%', 'an advance of a closed month is not edited'
);
select throws_like(
  $$ select public.update_lesson(pg_temp.lesson('2004-04-05'), '2004-03-31', '15:00', 60,
       'b9410000-0000-4000-8000-000000000001', null, 'перенос') $$,
  '%is closed%', 'a lesson does not move into a closed month'
);
delete from public.payroll_periods where month = '2004-03-01';
select isnt_empty(
  $$ select 1 from public.payroll_periods where month = '2004-03-01' $$,
  'a direct delete of the admin removes nothing (no write policy)'
);

-- ─── reopen_payroll_period ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.reopen_payroll_period('2004-03-01', 'ошибка') $$,
  '42501', null, 'the accountant cannot reopen a period'
);
set local request.jwt.claims = '{"sub":"a9410000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.reopen_payroll_period('2004-03-01', '') $$,
  '23514', 'reason is required', 'a reason is required to reopen'
);
select throws_ok(
  $$ select public.reopen_payroll_period('2004-02-01', 'ошибка') $$,
  'P0002', null, 'a month that is not closed is not reopened'
);
select is(
  public.reopen_payroll_period('2004-03-01', 'забыли отметить занятие'), 5,
  'the admin reopens March — 5 lessons unlocked'
);
select is(
  (select count(*)::integer from public.lessons
   where group_id = 'd9410000-0000-4000-8000-000000000001' and is_locked),
  0, 'no lesson stays locked'
);
select results_eq(
  $$ select action, reason from public.audit_log
     where entity = 'payroll_periods' and before ->> 'month' = '2004-03-01' $$,
  $$ values ('delete'::text, 'забыли отметить занятие'::text) $$,
  'the journal has the reopening with its reason'
);
select lives_ok(
  $$ select public.issue_advance('b9410000-0000-4000-8000-000000000001', 500, '2004-03-20', '2004-03-01') $$,
  'an advance in the reopened month again'
);

select * from finish();
rollback;
