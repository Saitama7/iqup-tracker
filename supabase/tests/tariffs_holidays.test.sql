-- А9 «Тарифы и праздники» (issue #7): tariffs in effect and past holidays are frozen (0006),
-- a planned tariff version can be deleted, only admin writes, created_by is the signed-in user.
begin;
select plan(20);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 admin, a…2 teacher, a…3 accountant
insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-000000000001', 'admin7@test.local'),
  ('a7000000-0000-4000-8000-000000000002', 'teacher7@test.local'),
  ('a7000000-0000-4000-8000-000000000003', 'acc7@test.local');
insert into public.profiles (id, phone, full_name, roles) values
  ('a7000000-0000-4000-8000-000000000001', '996000000701', 'Admin', '{admin}'),
  ('a7000000-0000-4000-8000-000000000002', '996000000702', 'Teacher', '{teacher}'),
  ('a7000000-0000-4000-8000-000000000003', '996000000703', 'Accountant', '{accountant}');

-- Dates relative to today: the guard compares with bishkek_today().
create temp table d as
select public.bishkek_today() - 30 as past,
       public.bishkek_today() as today,
       public.bishkek_today() + 30 as future;
grant select on d to authenticated;

-- service role (no auth.uid()) may import a past tariff and a past holiday
select lives_ok(
  $$ insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'f7000000-0000-4000-8000-000000000001', 'pair', 12, 4000, 2, 60, past from d $$,
  'service role imports a tariff in the past'
);
select is(
  (select created_by from public.tariffs where id = 'f7000000-0000-4000-8000-000000000001'),
  null::uuid,
  'imported tariff has no author'
);
insert into public.holidays (day, name) select past, 'Прошедший' from d;
insert into public.holidays (day, name) select future, 'Будущий' from d;

-- the guard holds for everyone, service role too
select throws_ok(
  $$ update public.tariffs set package_price = 1 where id = 'f7000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a tariff in effect cannot be updated, even by the service role'
);
select throws_ok(
  $$ delete from public.holidays where day = (select past from d) $$,
  '23514', null, 'a past holiday cannot be deleted, even by the service role'
);

-- ─── Admin ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from, created_by)
     select 'f7000000-0000-4000-8000-000000000002', 'pair', 12, 4600, 2, 60, future,
            'a7000000-0000-4000-8000-000000000002' from d $$,
  'admin plans a tariff from a future date'
);
select is(
  (select created_by from public.tariffs where id = 'f7000000-0000-4000-8000-000000000002'),
  'a7000000-0000-4000-8000-000000000001'::uuid,
  'created_by is the signed-in admin, not the client-supplied value'
);
select throws_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'mini', 12, 3900, 4, 60, today from d $$,
  '23514', null, 'admin cannot add a tariff starting today'
);
select throws_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'mini', 12, 3900, 4, 60, past from d $$,
  '23514', null, 'admin cannot add a tariff in the past'
);
select throws_ok(
  $$ update public.tariffs set package_price = 4100 where id = 'f7000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'admin cannot change a tariff in effect'
);
select throws_ok(
  $$ delete from public.tariffs where id = 'f7000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'admin cannot delete a tariff in effect'
);
select throws_ok(
  $$ update public.tariffs set valid_from = (select today from d)
     where id = 'f7000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'a planned tariff cannot be moved into effect'
);
select lives_ok(
  $$ delete from public.tariffs where id = 'f7000000-0000-4000-8000-000000000002' $$,
  'admin deletes a planned tariff'
);
select is_empty(
  $$ select 1 from public.tariffs where id = 'f7000000-0000-4000-8000-000000000002' $$,
  'the planned tariff is gone'
);

select throws_ok(
  $$ insert into public.holidays (day, name) select past - 1, 'Задним числом' from d $$,
  '23514', null, 'admin cannot add a holiday in the past'
);
select lives_ok(
  $$ insert into public.holidays (day, name) select today, 'Сегодня' from d $$,
  'admin adds a holiday for today'
);
select lives_ok(
  $$ delete from public.holidays where day = (select future from d) $$,
  'admin deletes an upcoming holiday'
);

-- ─── Accountant and teacher: read only ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a7000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ insert into public.holidays (day, name) select future + 1, 'Бухгалтер' from d $$,
  '42501', null, 'accountant cannot add a holiday'
);

set local request.jwt.claims = '{"sub":"a7000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select isnt_empty($$ select 1 from public.tariffs $$, 'teacher reads tariffs');
select throws_ok(
  $$ insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
     select 'group', 12, 9999, 10, 60, future + 1 from d $$,
  '42501', null, 'teacher cannot plan a tariff'
);
delete from public.holidays where day = (select today from d);
select isnt_empty(
  $$ select 1 from public.holidays where day = (select today from d) $$,
  'teacher cannot delete a holiday'
);

select * from finish();
rollback;
