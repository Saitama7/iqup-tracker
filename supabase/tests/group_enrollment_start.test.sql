-- Issue #60: set_group_start / set_enrollment_start (0017) — earlier / later / refusals, journal.
-- Self-contained fixtures, rolled back.
begin;
select plan(38);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a6000000-0000-4000-8000-000000000001', 'admin60@test.local'),
  ('a6000000-0000-4000-8000-000000000002', 'teacher60@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b6000000-0000-4000-8000-000000000001', null, 'Teacher 60', '996000006001');
insert into public.profiles (id, phone, full_name, roles) values
  ('a6000000-0000-4000-8000-000000000001', '996000006000', 'Admin 60', '{admin}'),
  ('a6000000-0000-4000-8000-000000000002', '996000006001', 'Teacher 60', '{teacher}');
update public.teachers set user_id = 'a6000000-0000-4000-8000-000000000002'
where id = 'b6000000-0000-4000-8000-000000000001';

insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('mini', 12, 3200, 4, 60, 2, '1990-01-01');
-- a holiday on a lesson day (Thu 3 Sep 2026); the seed may already have it
insert into public.holidays (day, name) values ('2026-09-03', 'Test holiday') on conflict (day) do nothing;

-- All groups: mini, ВТ/ЧТ 09:00, teacher 60. G1 starts 15 Sep (moved earlier); G2 1 Sep (moved later);
-- G3 has a held lesson on 8 Sep; G4 an enrollment from 1 Sep; G5 archived; G6 ends 30 Sep;
-- G7 — enrollments.
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, end_date, status)
select g.id::uuid, g.name, (select id from public.subjects where name = 'Математика'), 11, 'mini',
       'b6000000-0000-4000-8000-000000000001', g.start_date::date, g.end_date::date, g.status::public.group_status
from (values
  ('d6000000-0000-4000-8000-000000000001', 'S60 G1', '2026-09-15', null, 'active'),
  ('d6000000-0000-4000-8000-000000000002', 'S60 G2', '2026-09-01', null, 'active'),
  ('d6000000-0000-4000-8000-000000000003', 'S60 G3', '2026-09-01', null, 'active'),
  ('d6000000-0000-4000-8000-000000000004', 'S60 G4', '2026-09-01', null, 'active'),
  ('d6000000-0000-4000-8000-000000000005', 'S60 G5', '2026-09-01', null, 'archived'),
  ('d6000000-0000-4000-8000-000000000006', 'S60 G6', '2026-09-01', '2026-09-30', 'active'),
  ('d6000000-0000-4000-8000-000000000007', 'S60 G7', '2026-09-01', null, 'active')
) as g(id, name, start_date, end_date, status);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, w, '09:00', g.start_date
from public.groups g cross join unnest(array[2, 4]) w
where g.name like 'S60 %';
-- a later schedule change of G1 keeps its own date
insert into public.schedule_rules (group_id, weekday, start_time, valid_from) values
  ('d6000000-0000-4000-8000-000000000001', 6, '10:00', '2026-09-26');

select public.generate_lessons(g.id, '2026-09-30') from public.groups g where g.name like 'S60 %';
update public.lessons set status = 'held'
where group_id = 'd6000000-0000-4000-8000-000000000003' and lesson_date = '2026-09-08';

insert into public.students (id, full_name) values
  ('e6000000-0000-4000-8000-000000000001', 'Student 60 A'),
  ('e6000000-0000-4000-8000-000000000002', 'Student 60 B'),
  ('e6000000-0000-4000-8000-000000000003', 'Student 60 C');
insert into public.enrollments (id, student_id, group_id, start_date, end_date, status) values
  ('f6000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000004', '2026-09-01', null, 'active'),
  ('f6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000007', '2026-09-15', null, 'active'),
  -- B: left after the first week, came back on 22 Sep
  ('f6000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000007', '2026-09-01', '2026-09-05', 'finished'),
  ('f6000000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000007', '2026-09-22', null, 'active'),
  -- C: has a mark on 17 Sep
  ('f6000000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-000000000007', '2026-09-15', null, 'active');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select s.id::uuid, s.enrollment_id::uuid, (select id from public.tariffs where group_type = 'mini' and valid_from = '1990-01-01'),
       12, 3200, 3200, s.started_at::date
from (values
  ('c6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', '2026-09-15'),
  ('c6000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-000000000001', '2026-09-29'),
  ('c6000000-0000-4000-8000-000000000005', 'f6000000-0000-4000-8000-000000000005', '2026-09-15')
) as s(id, enrollment_id, started_at);
update public.lessons set status = 'held'
where group_id = 'd6000000-0000-4000-8000-000000000007' and lesson_date = '2026-09-17';
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, 'e6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000005', 'present'
from public.lessons l
where l.group_id = 'd6000000-0000-4000-8000-000000000007' and l.lesson_date = '2026-09-17';

create temp table lessons_before as
select id, lesson_date, planned_start from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000001';
grant all on lessons_before to authenticated;

-- ─── Teacher: no access ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select throws_ok(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000001', '2026-09-01') $$,
  '42501', null, 'teacher cannot move a group start'
);
select throws_ok(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000001', '2026-09-01') $$,
  '42501', null, 'teacher cannot move an enrollment start'
);

reset role;
set local role anon;
select throws_ok(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000001', '2026-09-01') $$,
  '42501', null, 'anon cannot call set_group_start'
);

-- ─── set_group_start: earlier ───────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- ВТ/ЧТ 1–14 Sep: 1, 3 (holiday), 8, 10 → 3 lessons
select results_eq(
  $$ select lessons_created, lessons_deleted from public.set_group_start('d6000000-0000-4000-8000-000000000001', '2026-09-01') $$,
  $$ values (3, 0) $$,
  'moving the start back to 1 Sep generates the lessons of 1–14 Sep'
);
select is(
  (select start_date from public.groups where id = 'd6000000-0000-4000-8000-000000000001'),
  '2026-09-01'::date, 'groups.start_date is the new date'
);
select set_eq(
  $$ select lesson_date from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000001' and lesson_date < '2026-09-15' $$,
  $$ values ('2026-09-01'::date), ('2026-09-08'::date), ('2026-09-10'::date) $$,
  'September lessons appear, the holiday is skipped'
);
select ok(
  (select bool_and(duration_min = 60) from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000001'),
  'duration comes from the tariff'
);
select set_eq(
  $$ select id from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000001' and lesson_date >= '2026-09-15' $$,
  $$ select id from lessons_before $$,
  'lessons from the old start stay as they were (no duplicates)'
);
select set_eq(
  $$ select weekday, valid_from from public.schedule_rules where group_id = 'd6000000-0000-4000-8000-000000000001' $$,
  $$ values (2, '2026-09-01'::date), (4, '2026-09-01'::date), (6, '2026-09-26'::date) $$,
  'rules that started with the group follow it, a later change keeps its date'
);
select is(
  (select count(*)::int from public.audit_log
   where entity = 'groups' and entity_id = 'd6000000-0000-4000-8000-000000000001' and action = 'update'
     and before ->> 'start_date' = '2026-09-15' and after ->> 'start_date' = '2026-09-01'
     and actor_id = 'a6000000-0000-4000-8000-000000000001'),
  1, 'the move is in the journal'
);
select results_eq(
  $$ select lessons_created, lessons_deleted from public.set_group_start('d6000000-0000-4000-8000-000000000001', '2026-09-01') $$,
  $$ values (0, 0) $$,
  'the same date again changes nothing'
);
select is(
  (select count(*)::int from public.audit_log where entity = 'groups' and entity_id = 'd6000000-0000-4000-8000-000000000001'),
  1, 'nothing changed — no second journal row'
);
select throws_ok(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000001', '1985-01-01') $$,
  '23514', null, 'no tariff on the new start date → refused'
);
select is(
  (select start_date from public.groups where id = 'd6000000-0000-4000-8000-000000000001'),
  '2026-09-01'::date, 'a refused move leaves the start as it was'
);

-- ─── set_group_start: later ─────────────────────────────────────────────────
select results_eq(
  $$ select lessons_created, lessons_deleted from public.set_group_start('d6000000-0000-4000-8000-000000000002', '2026-09-15') $$,
  $$ values (0, 3) $$,
  'moving the start later removes the planned lessons before it'
);
select is_empty(
  $$ select 1 from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000002' and lesson_date < '2026-09-15' $$,
  'no lessons before the new start'
);
select is(
  (select count(*)::int from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000002'),
  5, 'lessons from the new start stay (15, 17, 22, 24, 29 Sep)'
);
select set_eq(
  $$ select valid_from from public.schedule_rules where group_id = 'd6000000-0000-4000-8000-000000000002' $$,
  $$ values ('2026-09-15'::date) $$,
  'rules start with the group'
);
select throws_like(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000003', '2026-09-15') $$,
  '%held or cancelled lessons%', 'a held lesson before the new start → refused'
);
select is(
  (select count(*)::int from public.lessons where group_id = 'd6000000-0000-4000-8000-000000000003' and lesson_date < '2026-09-15'),
  3, 'a refused move removes nothing'
);
update public.lessons set status = 'cancelled', cancel_reason = 'center'
where group_id = 'd6000000-0000-4000-8000-000000000002' and lesson_date = '2026-09-15';
select throws_like(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000002', '2026-09-20') $$,
  '%held or cancelled lessons%', 'a cancelled lesson before the new start → refused'
);
select throws_like(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000004', '2026-09-15') $$,
  '%enrollments before%', 'an enrollment before the new start → refused'
);
select throws_ok(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000005', '2026-08-25') $$,
  '23514', null, 'archived group → refused'
);
select throws_ok(
  $$ select * from public.set_group_start('d6000000-0000-4000-8000-000000000006', '2026-10-05') $$,
  '23514', null, 'start after the group end → refused'
);
select is(
  (select end_date from public.groups where id = 'd6000000-0000-4000-8000-000000000006'),
  '2026-09-30'::date, 'end_date is not touched'
);

-- ─── set_enrollment_start ───────────────────────────────────────────────────
select lives_ok(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000001', '2026-09-01') $$,
  'enrollment moves back within the group dates'
);
select is(
  (select start_date from public.enrollments where id = 'f6000000-0000-4000-8000-000000000001'),
  '2026-09-01'::date, 'enrollments.start_date is the new date'
);
select is(
  (select started_at from public.subscriptions where id = 'c6000000-0000-4000-8000-000000000001'),
  '2026-09-01'::date, 'the subscription that started with the enrollment follows it'
);
select is(
  (select started_at from public.subscriptions where id = 'c6000000-0000-4000-8000-000000000002'),
  '2026-09-29'::date, 'a later subscription keeps its date'
);
select is(
  (select count(*)::int from public.audit_log
   where entity = 'enrollments' and entity_id = 'f6000000-0000-4000-8000-000000000001' and action = 'update'
     and before ->> 'start_date' = '2026-09-15' and after ->> 'start_date' = '2026-09-01'),
  1, 'the move is in the journal'
);
select lives_ok(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000001', '2026-09-08') $$,
  'enrollment moves later when there are no marks before the date'
);
select is(
  (select started_at from public.subscriptions where id = 'c6000000-0000-4000-8000-000000000001'),
  '2026-09-08'::date, 'the subscription follows it later as well'
);
select throws_like(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000001', '2026-08-25') $$,
  '%outside the group dates%', 'before the group start → refused'
);
select throws_like(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000002', '2026-09-10') $$,
  '%after the enrollment end%', 'after the enrollment end → refused'
);
select throws_ok(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000003', '2026-09-03') $$,
  '23505', null, 'overlapping another enrollment of the student in the group → refused'
);
select lives_ok(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000003', '2026-09-06') $$,
  'right after the previous enrollment ended is fine'
);
select throws_like(
  $$ select public.set_enrollment_start('f6000000-0000-4000-8000-000000000005', '2026-09-20') $$,
  '%attendance before the new date%', 'a mark before the new date → refused'
);
select is(
  (select start_date from public.enrollments where id = 'f6000000-0000-4000-8000-000000000005'),
  '2026-09-15'::date, 'a refused move leaves the enrollment as it was'
);

select * from finish();
rollback;
