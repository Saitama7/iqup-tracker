-- Issue #35 (0012), К6 / А9: if a group type already has subscriptions, an admin's new tariff starts
-- on the 1st of next month at the earliest; with no subscriptions of the type — from today.
-- Self-contained: the mini subscription is a fixture, pair subscriptions are cleared; rolled back.
begin;
select plan(9);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values ('a3500000-0000-4000-8000-000000000001', 'admin35@test.local');
insert into public.profiles (id, phone, full_name, roles) values
  ('a3500000-0000-4000-8000-000000000001', '996000003501', 'Admin', '{admin}');

create temp table d as
select public.bishkek_today() - 1 as yesterday,
       public.bishkek_today() as today,
       (date_trunc('month', public.bishkek_today()) + interval '1 month')::date as next_month;
grant select on d to authenticated;

-- pair: nobody has paid yet (whatever the seed holds)
set local session_replication_role = replica;
delete from public.attendance a using public.subscriptions s, public.tariffs t
where a.subscription_id = s.id and s.tariff_id = t.id and t.group_type = 'pair';
delete from public.subscriptions s using public.tariffs t
where s.tariff_id = t.id and t.group_type = 'pair';
set local session_replication_role = origin;

-- mini: one subscription bought
insert into public.teachers (id, full_name, phone) values
  ('b3500000-0000-4000-8000-000000000001', 'Teacher 35', '996000003502');
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
values ('f3500000-0000-4000-8000-000000000001', 'mini', 12, 3800, 4, 60, '1990-01-01');
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d3500000-0000-4000-8000-000000000001', 'Mini 35', (select id from public.subjects where name = 'Химия'), 9, 'mini', 'b3500000-0000-4000-8000-000000000001', '1990-01-01', 'active');
insert into public.students (id, full_name) values ('e3500000-0000-4000-8000-000000000001', 'S35');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('c3500000-0000-4000-8000-000000000001', 'e3500000-0000-4000-8000-000000000001', 'd3500000-0000-4000-8000-000000000001', '1990-01-01');
insert into public.subscriptions (enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('c3500000-0000-4000-8000-000000000001', 'f3500000-0000-4000-8000-000000000001', 12, 3800, 3800, '1990-01-01');

select ok(
  not has_function_privilege('authenticated', 'public.tariff_min_valid_from(public.group_type)', 'execute'),
  'tariff_min_valid_from is internal to the guard'
);

-- ─── Admin ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- no subscriptions of the type → from today
select lives_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'pair', 12, 4600, 2, 60, today from d $$,
  'pair without subscriptions: a new tariff may start today'
);
select throws_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'pair', 12, 4600, 2, 60, yesterday from d $$,
  '23514', null, 'pair without subscriptions: not in the past'
);

-- subscriptions bought → 1st of next month at the earliest
select throws_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'mini', 12, 4000, 4, 60, today from d $$,
  '23514', null, 'mini with subscriptions: not today'
);
select throws_like(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'mini', 12, 4000, 4, 60, next_month - 1 from d $$,
  '%has subscriptions — a new tariff starts on%',
  'mini with subscriptions: not the day before the 1st of next month'
);
select lives_ok(
  $$ insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'f3500000-0000-4000-8000-000000000002', 'mini', 12, 4000, 4, 60, next_month from d $$,
  'mini with subscriptions: from the 1st of next month'
);
select throws_ok(
  $$ update public.tariffs set valid_from = (select today from d)
     where id = 'f3500000-0000-4000-8000-000000000002' $$,
  '23514', null, 'a planned mini tariff cannot be moved before the 1st of next month'
);
select lives_ok(
  $$ update public.tariffs set valid_from = (select next_month + 14 from d)
     where id = 'f3500000-0000-4000-8000-000000000002' $$,
  'a planned mini tariff may be moved later'
);

-- ─── Service role (import #14) is not limited ───────────────────────────────
reset role;
set local request.jwt.claims = '';
select lives_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'mini', 12, 3700, 4, 60, today from d $$,
  'service role may still insert a tariff from today'
);

select * from finish();
rollback;
