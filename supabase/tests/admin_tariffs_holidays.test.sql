-- #94 · Tariffs (update_tariff_version / delete_tariff_version / plan_tariffs_from_today) and holidays
-- (save_holiday / delete_holidays / holiday_lessons), 0028: admin only, a reason for a version in effect
-- and a past day, direct writes refused, the journal; payroll does not move with a tariff edit (К6);
-- a holiday cancels the planned lessons of its day (held stay), its removal brings them back.
-- Dates are relative to today (the guards compare with bishkek_today()); rolled back.
begin;
select plan(41);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9430000-0000-4000-8000-000000000001', 'teacher943@test.local'),
  ('a9430000-0000-4000-8000-000000000003', 'admin943@test.local'),
  ('a9430000-0000-4000-8000-000000000004', 'acc943@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9430000-0000-4000-8000-000000000001', 'Teacher 943', '996000094301');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9430000-0000-4000-8000-000000000001', '996000094301', 'Teacher 943', '{teacher}'),
  ('a9430000-0000-4000-8000-000000000003', '996000094303', 'Admin 943', '{admin}'),
  ('a9430000-0000-4000-8000-000000000004', '996000094304', 'Accountant 943', '{accountant}');

create temp table d as
select public.bishkek_today() as today,
       (select max(t.valid_from) from public.tariffs t where t.valid_from <= public.bishkek_today()) as current_version,
       public.bishkek_today() - 10 as past_day,
       public.bishkek_today() - 11 as held_day,
       public.bishkek_today() + 10 as future_day,
       public.bishkek_today() + 12 as gone_day;
grant select on d to authenticated, anon;

-- holidays of the fixture days the seed may have — out of the way
delete from public.holidays h where h.day in (select past_day from d union select held_day from d
  union select future_day from d union select gone_day from d);
-- a holiday before the lessons are generated: no lesson on gone_day
insert into public.holidays (day, name) select gone_day, 'Был заранее' from d;

-- G — mini, every day 15:00, from 40 days ago
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select 'd9430000-0000-4000-8000-000000000001', 'Group 943', (select id from public.subjects where name = 'Математика'),
       8, 'mini', 'b9430000-0000-4000-8000-000000000001', today - 40, 'active' from d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd9430000-0000-4000-8000-000000000001', w, '15:00', today - 40 from d, generate_series(1, 7) w;
select public.generate_lessons('d9430000-0000-4000-8000-000000000001', (select today + 30 from d));
set session_replication_role = replica;
update public.lessons set status = 'held', confirmed_at = now()
where group_id = 'd9430000-0000-4000-8000-000000000001' and lesson_date = (select held_day from d);
set session_replication_role = origin;

create function pg_temp.status(p_day date)
returns text language sql as $$
  select status::text || coalesce(':' || cancel_reason::text, '') from public.lessons
  where group_id = 'd9430000-0000-4000-8000-000000000001' and lesson_date = p_day;
$$;
create function pg_temp.payroll()
returns bigint language sql security definer as $$ select coalesce(sum(base_amount), 0) from public.v_payroll_preview; $$;
create table pg_temp.seen (key text primary key, n bigint);
grant execute on function pg_temp.status(date), pg_temp.payroll() to authenticated, anon;
grant all on pg_temp.seen to authenticated;
insert into pg_temp.seen values ('payroll', pg_temp.payroll());
insert into pg_temp.seen
select 'subs', coalesce(sum(price_full), 0) from public.subscriptions;

-- ─── Tariffs: access ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.update_tariff_version((select current_version from d), '{"mini": 3900}', null, 'опечатка') $$,
  '42501', null, 'the teacher cannot edit a tariff version'
);
select throws_ok(
  $$ select public.plan_tariffs_from_today('[{"group_type":"group","lessons_in_package":12,"package_price":3300,"max_students":10,"lesson_duration_min":60}]') $$,
  '42501', null, 'the teacher cannot plan a tariff from today'
);
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.delete_tariff_version((select current_version from d), 'опечатка') $$,
  '42501', null, 'the accountant cannot delete a tariff version'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.update_tariff_version('2026-09-01', '{"mini": 3900}', null, 'x') $$,
  '42501', null, 'anon cannot edit a tariff version'
);

-- ─── Tariffs: admin ─────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ update public.tariffs set package_price = 3900 where group_type = 'mini' and valid_from = (select current_version from d) $$,
  '23514', null, 'a direct edit of a version in effect is still refused'
);
select throws_ok(
  $$ select public.update_tariff_version((select current_version from d), '{"mini": 3900}', null, '') $$,
  '23514', 'reason is required', 'a reason is required'
);
select throws_ok(
  $$ select public.update_tariff_version((select current_version from d), '{"mini": 0}', null, 'опечатка') $$,
  '23514', null, 'a price is a positive whole number'
);
select is(
  public.update_tariff_version((select current_version from d), '{"mini": 3900, "group": 3200}', null, 'опечатка в цене'),
  1, 'the admin fixes the mini price of the version in effect (group unchanged — not counted)'
);
select is(
  (select package_price from public.tariffs where group_type = 'mini' and valid_from = (select current_version from d)),
  3900, 'the price is changed'
);
select is(
  (select coalesce(sum(price_full), 0) from public.subscriptions),
  (select n from pg_temp.seen where key = 'subs'),
  'subscriptions keep their price (К6)'
);
select is(pg_temp.payroll(), (select n from pg_temp.seen where key = 'payroll'), 'the payroll does not move (К6)');
select results_eq(
  $$ select action, reason, (before ->> 'package_price')::int, (after ->> 'package_price')::int from public.audit_log
     where entity = 'tariffs' and reason = 'опечатка в цене' $$,
  $$ values ('update'::text, 'опечатка в цене'::text, 3800, 3900) $$,
  'the journal has the edit with its reason'
);
select throws_ok(
  $$ select public.delete_tariff_version((select current_version from d), 'опечатка') $$,
  '23503', null, 'a version with subscriptions is not deleted'
);

-- a version from yesterday nobody bought on: deleted (the earlier one takes over)
reset role;
set local request.jwt.claims = '{}';
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
select 'pair', 12, 4500, 2, 60, today - 1 from d;
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
values ('pair', 12, 1000, 2, 60, '2000-01-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.delete_tariff_version((select today - 1 from d), 'ошибочная версия'), 1,
  'a version in effect without subscriptions is deleted'
);
select throws_like(
  $$ select public.delete_tariff_version('2000-01-01', 'старая') $$,
  '%no earlier version%', 'the first version of a type is not deleted'
);

-- «Применить с сегодняшнего дня»
select throws_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'group', 12, 3300, 10, 60, today from d $$,
  '23514', null, 'a plain insert from today is refused when the type has subscriptions (К6 default)'
);
select is(
  public.plan_tariffs_from_today('[{"group_type":"group","lessons_in_package":12,"package_price":3300,"max_students":10,"lesson_duration_min":60,"freeze_limit":2}]'),
  1, 'plan_tariffs_from_today starts a version today'
);
select results_eq(
  $$ select package_price, created_by from public.tariffs where group_type = 'group' and valid_from = (select today from d) $$,
  $$ values (3300, 'a9430000-0000-4000-8000-000000000003'::uuid) $$,
  'the version from today, by the admin'
);
select is(pg_temp.payroll(), (select n from pg_temp.seen where key = 'payroll'), 'the payroll still does not move');

-- ─── Holidays: access ───────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.save_holiday((select past_day from d), 'Х', 'забыли') $$,
  '42501', null, 'the teacher cannot add a holiday'
);
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.delete_holidays(array[(select gone_day from d)], 'ошибка') $$,
  '42501', null, 'the accountant cannot delete a holiday'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.save_holiday('2030-01-01', 'Х') $$,
  '42501', null, 'anon cannot add a holiday'
);

-- ─── Holidays: admin ────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9430000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ delete from public.holidays where day = (select gone_day from d) $$,
  '42501', null, 'a direct delete is refused'
);
select throws_ok(
  $$ select public.save_holiday((select past_day from d), 'Нооруз') $$,
  '23514', 'reason is required', 'a past day needs a reason'
);
select ok(
  public.save_holiday((select past_day from d), 'Нооруз', 'забыли внести') >= 1,
  'a past holiday is added with a reason, planned lessons of the day are cancelled'
);
select is(pg_temp.status((select past_day from d)), 'cancelled:holiday', 'the planned lesson is cancelled for the holiday');
select lives_ok(
  $$ select public.save_holiday((select held_day from d), 'Нооруз', 'два дня') $$,
  'a holiday on a day with a held lesson'
);
select is(pg_temp.status((select held_day from d)), 'held', 'the held lesson stays held');
select results_eq(
  $$ select action, reason, kind from public.audit_log where entity = 'holidays' and after ->> 'day' = (select past_day from d)::text $$,
  $$ values ('insert'::text, 'забыли внести'::text, 'retro'::text) $$,
  'the journal: a past holiday with its reason — «Правки задним числом»'
);
select lives_ok(
  $$ select public.save_holiday((select past_day from d), 'Нооруз мейрамы', 'название') $$,
  'a past holiday is renamed with a reason'
);
select is((select name from public.holidays where day = (select past_day from d)), 'Нооруз мейрамы', 'renamed');
select results_eq(
  $$ select planned, restored, held from public.holiday_lessons((select past_day from d)) $$,
  $$ select 0, (select count(*)::integer from public.lessons l where l.lesson_date = (select past_day from d)
       and l.status = 'cancelled' and l.cancel_reason = 'holiday'), 0 $$,
  'holiday_lessons: what its removal brings back'
);
select throws_ok(
  $$ select public.delete_holidays(array[(select past_day from d)]) $$,
  '23514', 'reason is required', 'a past holiday is removed only with a reason'
);
select ok(
  public.delete_holidays(array[(select past_day from d), (select held_day from d)], 'ошиблись днём') >= 1,
  'past holidays are removed with a reason'
);
select is(pg_temp.status((select past_day from d)), 'planned', 'the lesson is planned again');
select is(
  (select reason from public.audit_log where entity = 'holidays' and action = 'delete'
   and before ->> 'day' = (select past_day from d)::text),
  'ошиблись днём', 'the journal has the removal with its reason'
);
select ok(public.save_holiday((select future_day from d), 'Будущий') >= 1, 'a future holiday needs no reason');
select is(pg_temp.status((select future_day from d)), 'cancelled:holiday', 'its planned lesson is cancelled');
select is(public.delete_holidays(array[(select gone_day from d)]), 1, 'removing a holiday generates its lesson');
select is(pg_temp.status((select gone_day from d)), 'planned', 'the lesson of the former holiday is there');

-- the wall: a closed month
select public.close_payroll_period('2004-01-01', null);
select throws_like(
  $$ select public.save_holiday('2004-01-15', 'Х', 'причина') $$,
  '%is closed%', 'no holiday in a closed period'
);

select * from finish();
rollback;
