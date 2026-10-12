-- #42 · subjects reference table (0013): everyone signed in reads, only admin writes;
-- groups.subject moved to subject_id by name; a group name is unique per subject among
-- groups that are not archived.
begin;
select plan(19);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 admin, a…2 teacher, a…3 accountant
insert into auth.users (id, email) values
  ('a4200000-0000-4000-8000-000000000001', 'admin42@test.local'),
  ('a4200000-0000-4000-8000-000000000002', 'teacher42@test.local'),
  ('a4200000-0000-4000-8000-000000000003', 'acc42@test.local');
insert into public.profiles (id, phone, full_name, roles) values
  ('a4200000-0000-4000-8000-000000000001', '996000004201', 'Admin', '{admin}'),
  ('a4200000-0000-4000-8000-000000000002', '996000004202', 'Teacher', '{teacher}'),
  ('a4200000-0000-4000-8000-000000000003', '996000004203', 'Accountant', '{accountant}');
insert into public.teachers (id, full_name) values ('b4200000-0000-4000-8000-000000000001', 'Teacher 42');

-- ─── Migration ──────────────────────────────────────────────────────────────
select results_eq(
  $$ select name from public.subjects where name in ('Математика', 'Химия', 'ОРТ', 'Продлёнка', 'Индивидуально') order by sort_order $$,
  $$ values ('Математика'), ('Химия'), ('ОРТ'), ('Продлёнка'), ('Индивидуально') $$,
  'subjects from the form and the seed are in the table'
);
select is(
  (select s.name from public.groups g join public.subjects s on s.id = g.subject_id
   where g.id = '00000000-0000-4000-b000-000000000001'),
  'Математика',
  'a seed group keeps its subject'
);
select hasnt_column('public', 'groups', 'subject', 'groups.subject text is gone');
select col_not_null('public', 'groups', 'subject_id', 'every group has a subject');

-- ─── Admin ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4200000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ insert into public.subjects (id, name, sort_order) values ('54200000-0000-4000-8000-000000000001', 'Физика', 60) $$,
  'admin adds a subject'
);
select throws_ok(
  $$ insert into public.subjects (name) values ('физика') $$,
  '23505', null, 'subject names are unique regardless of case'
);
select throws_ok(
  $$ insert into public.subjects (name) values (' Биология') $$,
  '23514', null, 'subject name is trimmed'
);
select lives_ok(
  $$ update public.subjects set name = 'Физика и астрономия' where id = '54200000-0000-4000-8000-000000000001' $$,
  'admin renames a subject'
);
select lives_ok(
  $$ update public.subjects set is_active = false where id = '54200000-0000-4000-8000-000000000001' $$,
  'admin hides a subject'
);

-- group name: unique per subject among groups that are not archived
select lives_ok(
  $$ select * from public.create_group(' 7 класс ', (select id from public.subjects where name = 'Химия'), 7, 'group',
       'b4200000-0000-4000-8000-000000000001', '{1}', '16:00', public.bishkek_today(), null, public.bishkek_today() + 7) $$,
  'admin creates «Химия · 7 класс»'
);
select throws_ok(
  $$ select * from public.create_group('7 КЛАСС', (select id from public.subjects where name = 'Химия'), 7, 'group',
       'b4200000-0000-4000-8000-000000000001', '{2}', '16:00', public.bishkek_today(), null, public.bishkek_today() + 7) $$,
  '23505', null, 'the same name in the same subject is refused'
);
select lives_ok(
  $$ select * from public.create_group('7 класс', (select id from public.subjects where name = 'Математика'), 7, 'group',
       'b4200000-0000-4000-8000-000000000001', '{2}', '16:00', public.bishkek_today(), null, public.bishkek_today() + 7) $$,
  'the same name in another subject is fine'
);
select lives_ok(
  $$ select * from public.create_group('7 класс А', (select id from public.subjects where name = 'Химия'), 7, 'group',
       'b4200000-0000-4000-8000-000000000001', '{3}', '16:00', public.bishkek_today(), null, public.bishkek_today() + 7) $$,
  'a lettered name is a new group'
);
select lives_ok(
  $$ select public.archive_group(id) from public.groups
     where name = '7 класс' and subject_id = (select id from public.subjects where name = 'Химия') $$,
  'admin archives «Химия · 7 класс»'
);
select lives_ok(
  $$ select * from public.create_group('7 класс', (select id from public.subjects where name = 'Химия'), 7, 'group',
       'b4200000-0000-4000-8000-000000000001', '{4}', '16:00', public.bishkek_today(), null, public.bishkek_today() + 7) $$,
  'an archived group frees its name'
);

-- ─── Accountant and teacher: read only ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ insert into public.subjects (name) values ('Бухгалтерия') $$,
  '42501', null, 'accountant cannot add a subject'
);

set local request.jwt.claims = '{"sub":"a4200000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select isnt_empty($$ select 1 from public.subjects where name = 'Математика' $$, 'teacher reads subjects');
select throws_ok(
  $$ insert into public.subjects (name) values ('Учительский') $$,
  '42501', null, 'teacher cannot add a subject'
);
update public.subjects set name = 'Алгебра' where name = 'Математика';
select is(
  (select count(*)::integer from public.subjects where name = 'Математика'),
  1,
  'teacher cannot rename a subject'
);

select * from finish();
rollback;
