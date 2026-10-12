-- #45 · А10 «Журнал изменений»: audit_log triggers on subjects / tariffs, v_audit_feed (kind, folded
-- marks of «Провести»), RLS — admin and accountant read, a teacher sees nothing, nobody writes.
begin;
select plan(24);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 admin, a…2 teacher (group G), a…3 accountant
insert into auth.users (id, email) values
  ('a4500000-0000-4000-8000-000000000001', 'admin45@test.local'),
  ('a4500000-0000-4000-8000-000000000002', 'teacher45@test.local'),
  ('a4500000-0000-4000-8000-000000000003', 'acc45@test.local');
-- the teacher row is linked to the profile by phone (0003)
insert into public.teachers (id, full_name, phone) values
  ('b4500000-0000-4000-8000-000000000001', 'Teacher 45', '996000004502');
insert into public.profiles (id, phone, full_name, roles) values
  ('a4500000-0000-4000-8000-000000000001', '996000004501', 'Admin 45', '{admin}'),
  ('a4500000-0000-4000-8000-000000000002', '996000004502', 'Teacher 45', '{teacher}'),
  ('a4500000-0000-4000-8000-000000000003', '996000004503', 'Accountant 45', '{accountant}');
insert into public.teacher_rates (id, teacher_id, percent, valid_from) values
  ('c4500000-0000-4000-8000-000000000001', 'b4500000-0000-4000-8000-000000000001', 45, '2000-01-01'),
  ('c4500000-0000-4000-8000-000000000002', 'b4500000-0000-4000-8000-000000000001', 50, '2999-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d4500000-0000-4000-8000-000000000001', 'G45', (select id from public.subjects where name = 'Математика'),
   8, 'group', 'b4500000-0000-4000-8000-000000000001', '2000-01-01', 'active');
insert into public.students (id, full_name) values
  ('e4500000-0000-4000-8000-000000000001', 'S1'),
  ('e4500000-0000-4000-8000-000000000002', 'S2');
insert into public.enrollments (student_id, group_id, start_date) values
  ('e4500000-0000-4000-8000-000000000001', 'd4500000-0000-4000-8000-000000000001', '2000-01-01'),
  ('e4500000-0000-4000-8000-000000000002', 'd4500000-0000-4000-8000-000000000001', '2000-01-01');
-- …1 yesterday (confirmed late), …2 today 00:00 (confirmed on its day)
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min) values
  ('f4500000-0000-4000-8000-000000000001', 'd4500000-0000-4000-8000-000000000001', public.bishkek_today() - 1, '09:00', 60),
  ('f4500000-0000-4000-8000-000000000002', 'd4500000-0000-4000-8000-000000000001', public.bishkek_today(), '00:00', 60);

-- ─── Triggers on subjects and tariffs ───────────────────────────────────────
insert into public.subjects (id, name) values ('54500000-0000-4000-8000-000000000001', 'Физика 45');
update public.subjects set name = 'Физика 45 (углубл.)' where id = '54500000-0000-4000-8000-000000000001';
select results_eq(
  $$ select action, before ->> 'name', after ->> 'name' from public.audit_log
     where entity = 'subjects' and entity_id = '54500000-0000-4000-8000-000000000001' order by action $$,
  $$ values ('insert', null, 'Физика 45'), ('update', 'Физика 45', 'Физика 45 (углубл.)') $$,
  'subjects: add and rename are in audit_log'
);
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
values ('74500000-0000-4000-8000-000000000001', 'group', 12, 9900, 10, 60, '2999-01-01');
select is(
  (select after ->> 'package_price' from public.audit_log
   where entity = 'tariffs' and entity_id = '74500000-0000-4000-8000-000000000001' and action = 'insert'),
  '9900',
  'tariffs: a new version is in audit_log'
);

-- ─── Teacher: confirms late and on time, sees no journal ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4500000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select lives_ok(
  $$ select public.confirm_lesson('f4500000-0000-4000-8000-000000000001', jsonb_build_array(
       jsonb_build_object('student_id', 'e4500000-0000-4000-8000-000000000001', 'status', 'present'),
       jsonb_build_object('student_id', 'e4500000-0000-4000-8000-000000000002', 'status', 'absent_frozen'))) $$,
  'teacher confirms yesterday''s lesson'
);
select lives_ok(
  $$ select public.confirm_lesson('f4500000-0000-4000-8000-000000000002', jsonb_build_array(
       jsonb_build_object('student_id', 'e4500000-0000-4000-8000-000000000001', 'status', 'present'),
       jsonb_build_object('student_id', 'e4500000-0000-4000-8000-000000000002', 'status', 'present'))) $$,
  'teacher confirms today''s lesson'
);
select is_empty($$ select 1 from public.audit_log $$, 'teacher reads nothing from audit_log');
select is_empty($$ select 1 from public.v_audit_feed $$, 'teacher reads nothing from v_audit_feed');
select throws_ok(
  $$ insert into public.audit_log (entity, entity_id, action) values ('lessons', gen_random_uuid(), 'insert') $$,
  '42501', null, 'teacher cannot write audit_log'
);

-- ─── Admin: corrects a mark, fixes a rate in effect and a planned one ───────
set local request.jwt.claims = '{"sub":"a4500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

update public.attendance set status = 'absent_burned'
where lesson_id = 'f4500000-0000-4000-8000-000000000001' and student_id = 'e4500000-0000-4000-8000-000000000001';
update public.teacher_rates set percent = 46 where id = 'c4500000-0000-4000-8000-000000000001';
update public.teacher_rates set percent = 51 where id = 'c4500000-0000-4000-8000-000000000002';

select is(
  (select kind from public.v_audit_feed
   where entity = 'lessons' and entity_id = 'f4500000-0000-4000-8000-000000000001' and action = 'update'),
  'late',
  'a lesson confirmed the next day is «late»'
);
select is(
  (select kind from public.v_audit_feed
   where entity = 'lessons' and entity_id = 'f4500000-0000-4000-8000-000000000002' and action = 'update'),
  'attendance',
  'a lesson confirmed on its day is «attendance»'
);
select is(
  (select actor_id from public.v_audit_feed
   where entity = 'lessons' and entity_id = 'f4500000-0000-4000-8000-000000000001' and action = 'update'),
  'a4500000-0000-4000-8000-000000000002'::uuid,
  'the late confirmation is the teacher''s'
);
select is(
  (select marks from public.v_audit_feed
   where entity = 'lessons' and entity_id = 'f4500000-0000-4000-8000-000000000001' and action = 'update'),
  '["absent_frozen", "present"]'::jsonb,
  'the marks of «Провести» are folded into the lesson row'
);
select is(
  (select count(*)::integer from public.v_audit_feed where entity = 'attendance' and reason = 'confirm_lesson'),
  0,
  'marks written by confirm_lesson are not separate feed rows'
);
select is(
  (select count(*)::integer from public.audit_log where entity = 'attendance' and reason = 'confirm_lesson'),
  4,
  '…but they stay in audit_log'
);
select results_eq(
  $$ select kind, actor_id, before ->> 'status', after ->> 'status' from public.v_audit_feed
     where entity = 'attendance' $$,
  $$ values ('retro', 'a4500000-0000-4000-8000-000000000001'::uuid, 'present', 'absent_burned') $$,
  'the admin''s mark correction is «retro», by the admin'
);
select is(
  (select kind from public.v_audit_feed
   where entity = 'teacher_rates' and entity_id = 'c4500000-0000-4000-8000-000000000001' and action = 'update'),
  'retro',
  'a rate fixed from a day already started is «retro» (И3)'
);
select is(
  (select kind from public.v_audit_feed
   where entity = 'teacher_rates' and entity_id = 'c4500000-0000-4000-8000-000000000002' and action = 'update'),
  'other',
  'a planned rate fixed is not «retro»'
);
select is(
  (select kind from public.v_audit_feed where entity = 'subjects' and action = 'update'
   and entity_id = '54500000-0000-4000-8000-000000000001'),
  'other',
  'subjects are «other»'
);
select isnt_empty($$ select 1 from public.audit_log $$, 'admin reads audit_log');
select throws_ok(
  $$ insert into public.audit_log (entity, entity_id, action) values ('lessons', gen_random_uuid(), 'insert') $$,
  '42501', null, 'admin cannot write audit_log'
);
select throws_ok(
  $$ delete from public.v_audit_feed $$,
  '42501', null, 'admin cannot delete from the journal'
);

-- ─── Accountant: reads, never writes ────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4500000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["accountant"]}}';

select is(
  (select count(*)::integer from public.v_audit_feed where kind = 'late'
   and entity_id = 'f4500000-0000-4000-8000-000000000001'),
  1,
  'accountant reads the feed'
);
-- RLS: no update / delete policy — every row is filtered out, nothing changes
update public.audit_log set reason = 'x';
select is_empty($$ select 1 from public.audit_log where reason = 'x' $$, 'accountant cannot change audit_log');
delete from public.audit_log;
select isnt_empty($$ select 1 from public.audit_log $$, 'accountant cannot delete audit_log rows');

-- ─── anon ───────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select 1 from public.v_audit_feed $$, '42501', null, 'anon cannot read the feed');

select * from finish();
rollback;
