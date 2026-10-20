-- #100 · groups.lesson_duration_min / set_group_duration (0029): the group's own length wins over the
-- tariff for new lessons (create_group, generate_lessons, generate_lessons_on, create_extra_lesson);
-- set_group_duration — admin only, planned lessons from a date, held / cancelled untouched, closed
-- period and after-school refused, the journal. Self-contained fixtures in 2004, rolled back.
--
-- March 2004: Saturdays 6, 13, 20, 27; Sundays 7, 14, 21, 28.
begin;
select plan(28);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'teacher100@test.local'),
  ('a1000000-0000-4000-8000-000000000003', 'admin100@test.local'),
  ('a1000000-0000-4000-8000-000000000004', 'acc100@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b1000000-0000-4000-8000-000000000001', 'Teacher 100', '996000010001');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1000000-0000-4000-8000-000000000001', '996000010001', 'Teacher 100', '{teacher}'),
  ('a1000000-0000-4000-8000-000000000003', '996000010003', 'Admin 100', '{admin}'),
  ('a1000000-0000-4000-8000-000000000004', '996000010004', 'Accountant 100', '{accountant}');
update public.teachers set user_id = 'a1000000-0000-4000-8000-000000000001'
where id = 'b1000000-0000-4000-8000-000000000001';

insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('mini', 12, 3200, 6, 60, 2, '2004-01-01', null),
  ('afterschool', 20, 7400, 8, 180, 2, '2004-01-01', 100);

create function pg_temp.lesson(p_group uuid, p_date date)
returns uuid language sql as $$
  select id from public.lessons where group_id = p_group and lesson_date = p_date and not is_extra;
$$;
create function pg_temp.minutes(p_group uuid, p_date date)
returns integer language sql as $$
  select duration_min from public.lessons where group_id = p_group and lesson_date = p_date and not is_extra;
$$;
create table pg_temp.g (key text primary key, id uuid);
grant execute on function pg_temp.lesson(uuid, date), pg_temp.minutes(uuid, date) to authenticated, anon;
grant all on pg_temp.g to authenticated, anon;

-- ─── create_group with its own length ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

insert into pg_temp.g
select 'weekend', group_id from public.create_group(
  'Выходные 100', (select id from public.subjects where name = 'Математика'), 8, 'mini',
  'b1000000-0000-4000-8000-000000000001', array[6, 7], '15:00', '2004-03-06', null, '2004-03-31', 90);
insert into pg_temp.g
select 'plain', group_id from public.create_group(
  'Будни 100', (select id from public.subjects where name = 'Математика'), 7, 'mini',
  'b1000000-0000-4000-8000-000000000001', array[1], '10:00', '2004-03-01', null, '2004-03-31');

select is(
  (select array_agg(distinct duration_min) from public.lessons
   where group_id = (select id from pg_temp.g where key = 'weekend')),
  array[90],
  'create_group(…, 90): every lesson of the group is 90 minutes'
);
select is(
  (select count(*)::integer from public.lessons
   where group_id = (select id from pg_temp.g where key = 'weekend')),
  8,
  'Saturdays and Sundays of March — 8 lessons'
);
select is(
  (select lesson_duration_min from public.groups where id = (select id from pg_temp.g where key = 'weekend')),
  90,
  'groups.lesson_duration_min is stored'
);
select is(
  (select array_agg(distinct duration_min) from public.lessons
   where group_id = (select id from pg_temp.g where key = 'plain')),
  array[60],
  'without a length the group follows the tariff (60)'
);
select is(
  (select lesson_duration_min from public.groups where id = (select id from pg_temp.g where key = 'plain')),
  null,
  'without a length groups.lesson_duration_min is null'
);
select throws_ok(
  $$ select * from public.create_group('Продлёнка 100', (select id from public.subjects where name = 'Математика'),
       3, 'afterschool', 'b1000000-0000-4000-8000-000000000001', array[1], '13:00', '2004-03-01', null,
       '2004-03-31', 90) $$,
  '23514', null, 'an after-school group gets no length of its own'
);
select throws_ok(
  $$ select * from public.create_group('Короткая 100', (select id from public.subjects where name = 'Математика'),
       9, 'mini', 'b1000000-0000-4000-8000-000000000001', array[1], '13:00', '2004-03-01', null,
       '2004-03-31', 10) $$,
  '23514', null, 'a length out of 15…600 is refused'
);

-- an extra lesson takes the group's length
select lives_ok(
  $$ select public.create_extra_lesson((select id from pg_temp.g where key = 'weekend'), '2004-03-10', '17:00') $$,
  'the admin adds an extra lesson'
);
select is(
  (select duration_min from public.lessons
   where group_id = (select id from pg_temp.g where key = 'weekend') and is_extra),
  90,
  'the extra lesson is 90 minutes too'
);

-- held 13.03, cancelled 14.03 (as postgres)
reset role;
set session_replication_role = replica;
update public.lessons set status = 'held', confirmed_at = now()
where id = pg_temp.lesson((select id from pg_temp.g where key = 'weekend'), '2004-03-20');
update public.lessons set status = 'cancelled', cancel_reason = 'center'
where id = pg_temp.lesson((select id from pg_temp.g where key = 'weekend'), '2004-03-21');
-- after-school group (direct, as the seed would)
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d1000000-0000-4000-8000-000000000009', 'Продлёнка 100', (select id from public.subjects where name = 'Математика'),
   3, 'afterschool', 'b1000000-0000-4000-8000-000000000001', '2004-03-01', 'active');
set session_replication_role = origin;

-- ─── Access ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.set_group_duration((select id from pg_temp.g where key = 'weekend'), 60, '2004-03-20') $$,
  '42501', null, 'the teacher cannot change the length'
);
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.set_group_duration((select id from pg_temp.g where key = 'weekend'), 60, '2004-03-20') $$,
  '42501', null, 'the accountant cannot change the length'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.set_group_duration((select id from pg_temp.g where key = 'weekend'), 60, '2004-03-20') $$,
  '42501', null, 'anon cannot change the length'
);
reset role;

-- ─── set_group_duration: 60 from 20.03 ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.set_group_duration((select id from pg_temp.g where key = 'weekend'), 60, '2004-03-20'),
  2,
  'two planned lessons from 20.03 change (27.03, 28.03)'
);
reset role;

select is(
  array[pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-27'),
        pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-28')],
  array[60, 60],
  'planned lessons from the date are 60 minutes'
);
select is(
  array[pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-06'),
        pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-14')],
  array[90, 90],
  'lessons before the date keep 90 minutes'
);
select is(
  pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-20'),
  90,
  'the held lesson keeps its length'
);
select is(
  pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-21'),
  90,
  'the cancelled lesson keeps its length'
);
select is(
  (select lesson_duration_min from public.groups where id = (select id from pg_temp.g where key = 'weekend')),
  60,
  'the group remembers 60'
);
select ok(
  exists (select 1 from public.audit_log
          where entity = 'groups' and action = 'update'
            and entity_id = (select id from pg_temp.g where key = 'weekend')
            and (before ->> 'lesson_duration_min')::int = 90
            and (after ->> 'lesson_duration_min')::int = 60
            and reason = 'set_group_duration:2004-03-20:90:60'),
  'the journal has the group row: 90 → 60 from 20.03'
);
select is(
  (select count(*)::integer from public.audit_log
   where entity = 'lessons' and reason = 'set_group_duration:2004-03-20:90:60'),
  2,
  'and a lessons row per changed lesson'
);

-- new lessons follow the new length; back to the tariff
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select public.generate_lessons((select id from pg_temp.g where key = 'weekend'), '2004-04-04');
select is(
  pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-04-03'),
  60,
  'a lesson generated later takes the group''s length'
);
select is(
  public.set_group_duration((select id from pg_temp.g where key = 'plain'), 45, '2004-03-15'),
  3,
  'the weekday group: 45 minutes from 15.03 (15, 22, 29)'
);
select public.set_group_duration((select id from pg_temp.g where key = 'plain'), null, '2004-03-22');
reset role;
select is(
  array[pg_temp.minutes((select id from pg_temp.g where key = 'plain'), '2004-03-15'),
        pg_temp.minutes((select id from pg_temp.g where key = 'plain'), '2004-03-22'),
        pg_temp.minutes((select id from pg_temp.g where key = 'plain'), '2004-03-29')],
  array[45, 60, 60],
  'null — back to the tariff from 22.03'
);

-- generate_lessons_on (a holiday removed) uses the group's length
delete from public.lessons where id = pg_temp.lesson((select id from pg_temp.g where key = 'weekend'), '2004-03-28');
select ok(public.generate_lessons_on('2004-03-28') >= 1, 'generate_lessons_on brings the lesson back');
select is(
  pg_temp.minutes((select id from pg_temp.g where key = 'weekend'), '2004-03-28'),
  60,
  'with the group''s length'
);

-- ─── Refusals ───────────────────────────────────────────────────────────────
set session_replication_role = replica;
insert into public.payroll_periods (month) values ('2004-03-01');
set session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.set_group_duration((select id from pg_temp.g where key = 'weekend'), 120, '2004-03-27') $$,
  '23514', null, 'a closed period is refused'
);
select throws_ok(
  $$ select public.set_group_duration('d1000000-0000-4000-8000-000000000009', 120, '2004-04-01') $$,
  '23514', null, 'an after-school group is refused'
);
select throws_ok(
  $$ select public.set_group_duration((select id from pg_temp.g where key = 'weekend'), 700, '2004-04-01') $$,
  '23514', null, 'a length out of 15…600 is refused'
);
reset role;

select * from finish();
rollback;
