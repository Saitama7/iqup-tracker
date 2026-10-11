-- profiles → teachers linking by phone (issue #3).
begin;
select plan(5);

insert into public.teachers (id, full_name, phone)
values ('b1000000-0000-4000-8000-000000000001', 'Pre-seeded Teacher', '996000000101');

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', '996000000101@iqup.local'),
  ('a1000000-0000-4000-8000-000000000002', '996000000102@iqup.local'),
  ('a1000000-0000-4000-8000-000000000003', '996000000103@iqup.local');

-- existing teachers row, matched by phone
insert into public.profiles (id, phone, full_name, roles)
values ('a1000000-0000-4000-8000-000000000001', '996000000101', 'Pre-seeded Teacher', '{teacher}');

select is(
  (select user_id from public.teachers where id = 'b1000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'profile is linked to the pre-seeded teacher by phone'
);
select is(
  (select count(*) from public.teachers where phone = '996000000101'),
  1::bigint,
  'no duplicate teacher row is created'
);

-- no teachers row yet → created from the profile
insert into public.profiles (id, phone, full_name, roles)
values ('a1000000-0000-4000-8000-000000000002', '996000000102', 'New Teacher', '{admin,teacher}');

select results_eq(
  $$ select full_name, phone from public.teachers where user_id = 'a1000000-0000-4000-8000-000000000002' $$,
  $$ values ('New Teacher'::text, '996000000102'::text) $$,
  'teacher row is created for a new teacher profile'
);

-- non-teacher → no teachers row
insert into public.profiles (id, phone, full_name, roles)
values ('a1000000-0000-4000-8000-000000000003', '996000000103', 'Accountant', '{accountant}');

select is_empty(
  $$ select 1 from public.teachers where user_id = 'a1000000-0000-4000-8000-000000000003' or phone = '996000000103' $$,
  'non-teacher profile creates no teacher row'
);

-- phone already linked to someone else → error
insert into auth.users (id, email) values ('a1000000-0000-4000-8000-000000000004', 'other@test.local');
update public.teachers set phone = '996000000104' where id = 'b1000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ insert into public.profiles (id, phone, full_name, roles)
     values ('a1000000-0000-4000-8000-000000000004', '996000000104', 'Impostor', '{teacher}') $$,
  '23505', null, 'cannot take over a teacher already linked to another user'
);

select * from finish();
rollback;
