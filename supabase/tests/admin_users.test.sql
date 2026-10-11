-- А8 «Учителя и доступ» (issue #6): role change links teachers, admin adds and fixes rates (0005),
-- last sign-in for staff.
begin;
select plan(17);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 teacher A, a…2 teacher B, a…3 admin, a…4 accountant
insert into auth.users (id, email, last_sign_in_at) values
  ('a6000000-0000-4000-8000-000000000001', 'ta@test.local', '2026-10-01 10:00+06'),
  ('a6000000-0000-4000-8000-000000000002', 'tb@test.local', null),
  ('a6000000-0000-4000-8000-000000000003', 'admin@test.local', null),
  ('a6000000-0000-4000-8000-000000000004', 'acc@test.local', null);

insert into public.profiles (id, phone, full_name, roles) values
  ('a6000000-0000-4000-8000-000000000001', '996000000601', 'Teacher A', '{teacher}'),
  ('a6000000-0000-4000-8000-000000000002', '996000000602', 'Teacher B', '{teacher}'),
  ('a6000000-0000-4000-8000-000000000003', '996000000603', 'Admin', '{admin}'),
  ('a6000000-0000-4000-8000-000000000004', '996000000604', 'Accountant', '{accountant}');

insert into public.teacher_rates (id, teacher_id, percent, valid_from)
select 'f6000000-0000-4000-8000-000000000001', t.id, 45, '2026-09-01'
from public.teachers t where t.user_id = 'a6000000-0000-4000-8000-000000000001';
insert into public.teacher_rates (teacher_id, percent, valid_from)
select t.id, 45, '2026-09-01'
from public.teachers t where t.user_id = 'a6000000-0000-4000-8000-000000000002';

-- ─── Role change → teachers row ─────────────────────────────────────────────
update public.profiles set roles = '{admin,teacher}' where id = 'a6000000-0000-4000-8000-000000000003';
select results_eq(
  $$ select full_name, phone from public.teachers where user_id = 'a6000000-0000-4000-8000-000000000003' $$,
  $$ values ('Admin'::text, '996000000603'::text) $$,
  'adding the teacher role to an existing admin creates their teachers row'
);

-- a pre-seeded teacher without a login is linked by phone, not duplicated
insert into public.teachers (id, full_name, phone)
values ('b6000000-0000-4000-8000-000000000004', 'Accountant (teaches)', '996000000604');
update public.profiles set roles = '{accountant,teacher}' where id = 'a6000000-0000-4000-8000-000000000004';
select is(
  (select user_id from public.teachers where id = 'b6000000-0000-4000-8000-000000000004'),
  'a6000000-0000-4000-8000-000000000004'::uuid,
  'adding the teacher role links the pre-seeded teacher by phone'
);
select is(
  (select count(*) from public.teachers where phone = '996000000604'),
  1::bigint,
  'no duplicate teacher row on role change'
);

-- removing and re-adding the role keeps the same row
update public.profiles set roles = '{admin}' where id = 'a6000000-0000-4000-8000-000000000003';
update public.profiles set roles = '{admin,teacher}' where id = 'a6000000-0000-4000-8000-000000000003';
select is(
  (select count(*) from public.teachers where user_id = 'a6000000-0000-4000-8000-000000000003'),
  1::bigint,
  'removing and re-adding teacher keeps one teachers row'
);

-- ─── Admin: new rate from a date, fix of an existing one (0005) ─────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ insert into public.teacher_rates (teacher_id, percent, valid_from)
     select t.id, 50, '2026-11-01' from public.teachers t
     where t.user_id = 'a6000000-0000-4000-8000-000000000001' $$,
  'admin adds a new rate row'
);

select lives_ok(
  $$ update public.teacher_rates set percent = 47 where id = 'f6000000-0000-4000-8000-000000000001' $$,
  'admin fixes a mistyped percent in place'
);

select results_eq(
  $$ select percent, valid_from from public.teacher_rates r
     join public.teachers t on t.id = r.teacher_id
     where t.user_id = 'a6000000-0000-4000-8000-000000000001'
     order by valid_from $$,
  $$ values (47.00::numeric(5, 2), '2026-09-01'::date), (50.00::numeric(5, 2), '2026-11-01'::date) $$,
  'fix changes the row, new rate adds one'
);

select is(
  (select count(*) from public.audit_log
   where entity = 'teacher_rates' and entity_id = 'f6000000-0000-4000-8000-000000000001'
     and action = 'update'),
  1::bigint,
  'the fix is recorded in audit_log'
);

select throws_ok(
  $$ insert into public.teacher_rates (teacher_id, percent, valid_from)
     select t.id, 47, '2026-09-01' from public.teachers t
     where t.user_id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23505', null, 'a second rate with the same valid_from is rejected'
);

select is(
  (select count(*) from public.user_last_sign_in()),
  (select count(*) from public.profiles),
  'admin sees last sign-in of every profile'
);
select is(
  (select last_sign_in_at from public.user_last_sign_in() where user_id = 'a6000000-0000-4000-8000-000000000001'),
  '2026-10-01 10:00+06'::timestamptz,
  'last sign-in comes from auth.users'
);

-- ─── Accountant: reads, never writes rates ─────────────────────────────────
set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ insert into public.teacher_rates (teacher_id, percent, valid_from)
     select t.id, 60, '2026-12-01' from public.teachers t
     where t.user_id = 'a6000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'accountant cannot add a rate'
);
update public.teacher_rates set percent = 99 where id = 'f6000000-0000-4000-8000-000000000001';
select is(
  (select percent from public.teacher_rates where id = 'f6000000-0000-4000-8000-000000000001'),
  47.00::numeric(5, 2),
  'accountant cannot fix a rate'
);

-- ─── Teacher: no foreign data ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is_empty($$ select 1 from public.user_last_sign_in() $$, 'teacher gets no sign-in activity');
select is_empty(
  $$ select 1 from public.teacher_rates r join public.teachers t on t.id = r.teacher_id
     where t.user_id <> 'a6000000-0000-4000-8000-000000000002' $$,
  'teacher does not see other teachers'' rates'
);
select throws_ok(
  $$ insert into public.teacher_rates (teacher_id, percent, valid_from)
     select t.id, 90, '2026-12-01' from public.teachers t
     where t.user_id = 'a6000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'teacher cannot raise own rate'
);
update public.teacher_rates r set percent = 90
from public.teachers t
where t.id = r.teacher_id and t.user_id = 'a6000000-0000-4000-8000-000000000002';
select is(
  (select max(r.percent) from public.teacher_rates r join public.teachers t on t.id = r.teacher_id
   where t.user_id = 'a6000000-0000-4000-8000-000000000002'),
  45.00::numeric(5, 2),
  'teacher cannot fix own rate'
);

select * from finish();
rollback;
