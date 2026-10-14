-- Issue #73: lessons.teacher_id and the admin undo RPCs (0020) — remove / transfer an enrollment,
-- change a group's teacher from a date, delete a group; refusals, closed periods, journal, access.
-- Self-contained fixtures in September 2003 (no seed holidays), rolled back.
begin;
select plan(74);

-- ─── Seed payroll before anything (lessons.teacher_id backfill keeps the sums) ──
select results_eq(
  $$ select base_amount from public.v_payroll_preview
     where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01' $$,
  $$ values (38160) $$,
  'seed: Гульзат in September 2026 is still 38 160'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  47546, 'seed: everyone in September 2026 is still 47 546'
);
select is(
  (select count(*)::integer from public.lessons l join public.groups g on g.id = l.group_id
   where l.teacher_id is distinct from g.teacher_id),
  0, 'seed: every lesson is paid to its group''s teacher'
);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a7300000-0000-4000-8000-000000000001', 'admin73@test.local'),
  ('a7300000-0000-4000-8000-000000000002', 'teacher73a@test.local'),
  ('a7300000-0000-4000-8000-000000000003', 'teacher73b@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b7300000-0000-4000-8000-000000000001', null, 'Teacher 73 A', '996000007301'),
  ('b7300000-0000-4000-8000-000000000002', null, 'Teacher 73 B', '996000007302');
insert into public.profiles (id, phone, full_name, roles) values
  ('a7300000-0000-4000-8000-000000000001', '996000007300', 'Admin 73', '{admin}'),
  ('a7300000-0000-4000-8000-000000000002', '996000007301', 'Teacher 73 A', '{teacher}'),
  ('a7300000-0000-4000-8000-000000000003', '996000007302', 'Teacher 73 B', '{teacher}');
update public.teachers set user_id = 'a7300000-0000-4000-8000-000000000002' where id = 'b7300000-0000-4000-8000-000000000001';
update public.teachers set user_id = 'a7300000-0000-4000-8000-000000000003' where id = 'b7300000-0000-4000-8000-000000000002';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b7300000-0000-4000-8000-000000000001', 50, '1999-01-01'),
  ('b7300000-0000-4000-8000-000000000002', 40, '1999-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('mini', 12, 3600, 4, 60, 2, '1990-01-01'),
  ('pair', 12, 4800, 2, 60, 2, '1990-01-01');

-- Groups, ВТ/ЧТ 09:00 from Tue 2 Sep 2003, teacher A:
-- 1 source (mini) · 2 target (mini) · 3 pair · 4 archived mini · 5 empty · 6 closed lesson · 7 teacher change · 8 change from start
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select g.id::uuid, g.name, (select id from public.subjects where name = 'Математика'), 9, g.type::public.group_type,
       'b7300000-0000-4000-8000-000000000001', '2003-09-02', g.status::public.group_status
from (values
  ('d7300000-0000-4000-8000-000000000001', 'S73 G1', 'mini', 'active'),
  ('d7300000-0000-4000-8000-000000000002', 'S73 G2', 'mini', 'active'),
  ('d7300000-0000-4000-8000-000000000003', 'S73 G3', 'pair', 'active'),
  ('d7300000-0000-4000-8000-000000000004', 'S73 G4', 'mini', 'archived'),
  ('d7300000-0000-4000-8000-000000000005', 'S73 G5', 'mini', 'active'),
  ('d7300000-0000-4000-8000-000000000006', 'S73 G6', 'mini', 'active'),
  ('d7300000-0000-4000-8000-000000000007', 'S73 G7', 'mini', 'active'),
  ('d7300000-0000-4000-8000-000000000008', 'S73 G8', 'mini', 'active')
) as g(id, name, type, status);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, w, '09:00', g.start_date
from public.groups g cross join unnest(array[2, 4]) w
where g.name like 'S73 %';
select public.generate_lessons(g.id, '2003-09-30') from public.groups g where g.name like 'S73 %' and g.status <> 'archived';

create temp table l73 as
select l.id, g.name as grp, l.lesson_date from public.lessons l join public.groups g on g.id = l.group_id
where g.name like 'S73 %';
grant all on l73 to authenticated;

insert into public.students (id, full_name) values
  ('e7300000-0000-4000-8000-000000000001', 'Student 73 frozen'),
  ('e7300000-0000-4000-8000-000000000002', 'Student 73 paid'),
  ('e7300000-0000-4000-8000-000000000003', 'Student 73 present'),
  ('e7300000-0000-4000-8000-000000000005', 'Student 73 locked'),
  ('e7300000-0000-4000-8000-000000000006', 'Student 73 both'),
  ('e7300000-0000-4000-8000-000000000007', 'Student 73 G7');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f7300000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', 'd7300000-0000-4000-8000-000000000001', '2003-09-02'),
  ('f7300000-0000-4000-8000-000000000002', 'e7300000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000001', '2003-09-02'),
  ('f7300000-0000-4000-8000-000000000003', 'e7300000-0000-4000-8000-000000000003', 'd7300000-0000-4000-8000-000000000001', '2003-09-02'),
  ('f7300000-0000-4000-8000-000000000005', 'e7300000-0000-4000-8000-000000000005', 'd7300000-0000-4000-8000-000000000006', '2003-09-02'),
  ('f7300000-0000-4000-8000-000000000006', 'e7300000-0000-4000-8000-000000000006', 'd7300000-0000-4000-8000-000000000001', '2003-09-02'),
  ('f7300000-0000-4000-8000-000000000016', 'e7300000-0000-4000-8000-000000000006', 'd7300000-0000-4000-8000-000000000002', '2003-09-02'),
  ('f7300000-0000-4000-8000-000000000007', 'e7300000-0000-4000-8000-000000000007', 'd7300000-0000-4000-8000-000000000007', '2003-09-02');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('c73000000000400080000000000000' || right(e.id::text, 2))::uuid, e.id,
       (select id from public.tariffs where group_type = 'mini' and valid_from = '1990-01-01'),
       12, 3600, 3600, e.start_date
from public.enrollments e where e.id::text like 'f7300000-%';
insert into public.payments (subscription_id, amount, method, paid_at) values
  ('c7300000-0000-4000-8000-000000000002', 3600, 'cash', '2003-09-02 10:00+06');

-- held lessons and marks: G1 9 Sep (frozen 1, frozen 2, present 3, frozen 6), G6 9 Sep (frozen, closed),
-- G7 2, 4, 16 Sep present
update public.lessons set status = 'held'
where id in (select id from l73 where (grp in ('S73 G1', 'S73 G6') and lesson_date = '2003-09-09')
                                   or (grp = 'S73 G7' and lesson_date in ('2003-09-02', '2003-09-04', '2003-09-16')));
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, m.student_id::uuid, m.sub::uuid, m.status::public.attendance_status
from (values
  ('S73 G1', '2003-09-09', 'e7300000-0000-4000-8000-000000000001', 'c7300000-0000-4000-8000-000000000001', 'absent_frozen'),
  ('S73 G1', '2003-09-09', 'e7300000-0000-4000-8000-000000000002', 'c7300000-0000-4000-8000-000000000002', 'absent_frozen'),
  ('S73 G1', '2003-09-09', 'e7300000-0000-4000-8000-000000000003', 'c7300000-0000-4000-8000-000000000003', 'present'),
  ('S73 G1', '2003-09-09', 'e7300000-0000-4000-8000-000000000006', 'c7300000-0000-4000-8000-000000000006', 'absent_frozen'),
  ('S73 G6', '2003-09-09', 'e7300000-0000-4000-8000-000000000005', 'c7300000-0000-4000-8000-000000000005', 'absent_frozen'),
  ('S73 G7', '2003-09-02', 'e7300000-0000-4000-8000-000000000007', 'c7300000-0000-4000-8000-000000000007', 'present'),
  ('S73 G7', '2003-09-04', 'e7300000-0000-4000-8000-000000000007', 'c7300000-0000-4000-8000-000000000007', 'present'),
  ('S73 G7', '2003-09-16', 'e7300000-0000-4000-8000-000000000007', 'c7300000-0000-4000-8000-000000000007', 'present')
) as m(grp, day, student_id, sub, status)
join l73 l on l.grp = m.grp and l.lesson_date = m.day::date;
update public.lessons set is_locked = true where id in (select id from l73 where grp = 'S73 G6' and lesson_date = '2003-09-09');

-- a lead came to a trial in G1 on 4 Sep
insert into public.trials (id, full_name, parent_phone, group_id, lesson_id, status) values
  ('77300000-0000-4000-8000-000000000001', 'Lead 73', '996000007399', 'd7300000-0000-4000-8000-000000000001',
   (select id from l73 where grp = 'S73 G1' and lesson_date = '2003-09-04'), 'attended');

-- ─── lessons.teacher_id ─────────────────────────────────────────────────────
select is(
  (select count(*)::integer from public.lessons l join l73 on l73.id = l.id
   where l.teacher_id = 'b7300000-0000-4000-8000-000000000001'),
  (select count(*)::integer from l73),
  'generated lessons get the group''s teacher'
);

-- ─── Access: teacher and anon are refused ───────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7300000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok($$ select public.enrollment_undo_info('f7300000-0000-4000-8000-000000000001') $$, '42501', null, 'teacher: enrollment_undo_info refused');
select throws_ok($$ select public.remove_enrollment('f7300000-0000-4000-8000-000000000001') $$, '42501', null, 'teacher: remove_enrollment refused');
select throws_ok($$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000001', 'd7300000-0000-4000-8000-000000000002') $$, '42501', null, 'teacher: transfer_enrollment refused');
select throws_ok($$ select public.change_group_teacher_preview('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002') $$, '42501', null, 'teacher: change_group_teacher_preview refused');
select throws_ok($$ select public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002') $$, '42501', null, 'teacher: change_group_teacher refused');
select throws_ok($$ select public.group_delete_blockers('d7300000-0000-4000-8000-000000000005') $$, '42501', null, 'teacher: group_delete_blockers refused');
select throws_ok($$ select public.delete_group('d7300000-0000-4000-8000-000000000005') $$, '42501', null, 'teacher: delete_group refused');
select throws_ok(
  $$ update public.lessons set teacher_id = 'b7300000-0000-4000-8000-000000000002' where id = (select id from l73 where grp = 'S73 G7' and lesson_date = '2003-09-30') $$,
  '42501', null, 'teacher cannot hand a lesson to someone else'
);

reset role;
set local role anon;
set local request.jwt.claims = '';
select throws_ok($$ select public.enrollment_undo_info('f7300000-0000-4000-8000-000000000001') $$, '42501', null, 'anon: enrollment_undo_info refused');
select throws_ok($$ select public.remove_enrollment('f7300000-0000-4000-8000-000000000001') $$, '42501', null, 'anon: remove_enrollment refused');
select throws_ok($$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000001', 'd7300000-0000-4000-8000-000000000002') $$, '42501', null, 'anon: transfer_enrollment refused');
select throws_ok($$ select public.change_group_teacher_preview('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002') $$, '42501', null, 'anon: change_group_teacher_preview refused');
select throws_ok($$ select public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002') $$, '42501', null, 'anon: change_group_teacher refused');
select throws_ok($$ select public.group_delete_blockers('d7300000-0000-4000-8000-000000000005') $$, '42501', null, 'anon: group_delete_blockers refused');
select throws_ok($$ select public.delete_group('d7300000-0000-4000-8000-000000000005') $$, '42501', null, 'anon: delete_group refused');

-- ─── remove_enrollment ──────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7300000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select results_eq(
  $$ select present_marks, burned_marks, frozen_marks, locked_marks, subscriptions, payments, paid_total, trial_id
     from public.enrollment_undo_info('f7300000-0000-4000-8000-000000000001') $$,
  $$ values (0, 0, 1, 0, 1, 0, 0, null::uuid) $$,
  'info: one frozen mark, one subscription, no payments'
);
select results_eq(
  $$ select present_marks, payments, paid_total from public.enrollment_undo_info('f7300000-0000-4000-8000-000000000003') $$,
  $$ values (1, 0, 0) $$,
  'info: a «был» mark is counted'
);
select throws_like(
  $$ select public.remove_enrollment('f7300000-0000-4000-8000-000000000003') $$,
  '%present or burned marks%', '«был» → refused'
);
select throws_like(
  $$ select public.remove_enrollment('f7300000-0000-4000-8000-000000000002') $$,
  '%has payments%', 'payments → refused (transfer instead)'
);
select throws_like(
  $$ select public.remove_enrollment('f7300000-0000-4000-8000-000000000005') $$,
  '%closed period%', 'a mark in a closed period → refused'
);
select throws_ok(
  $$ select public.remove_enrollment('f7300000-0000-4000-8000-0000000000ff') $$,
  '23503', null, 'unknown enrollment → refused'
);

select results_eq(
  $$ select marks_deleted, subscriptions_deleted from public.remove_enrollment('f7300000-0000-4000-8000-000000000001') $$,
  $$ values (1, 1) $$,
  'removed: the frozen mark and the subscription'
);
select is(
  (select count(*)::integer from public.enrollments where id = 'f7300000-0000-4000-8000-000000000001')
  + (select count(*)::integer from public.subscriptions where id = 'c7300000-0000-4000-8000-000000000001')
  + (select count(*)::integer from public.attendance where student_id = 'e7300000-0000-4000-8000-000000000001'),
  0, 'enrollment, subscription and marks are gone'
);
select is(
  (select array_agg(entity order by entity) from public.audit_log
   where reason = 'remove_enrollment' and action = 'delete'
     and entity_id in ('f7300000-0000-4000-8000-000000000001', 'c7300000-0000-4000-8000-000000000001')
      or (reason = 'remove_enrollment' and entity = 'attendance')),
  array['attendance', 'enrollments', 'subscriptions'],
  'journal: the three deletions with reason remove_enrollment'
);

-- an enrollment made from a trial: the trial returns to «был на пробном»
create temp table t73 on commit drop as
select * from public.enroll_trial('77300000-0000-4000-8000-000000000001', '2003-09-11');
select is(
  (select trial_id from public.enrollment_undo_info((select enrollment_id from t73))),
  '77300000-0000-4000-8000-000000000001'::uuid, 'info: the trial behind the enrollment'
);
select lives_ok(
  $$ select public.remove_enrollment((select enrollment_id from t73)) $$,
  'an enrollment made from a trial can be removed'
);
select results_eq(
  $$ select status::text, enrollment_id from public.trials where id = '77300000-0000-4000-8000-000000000001' $$,
  $$ values ('attended', null::uuid) $$,
  'the trial is «был на пробном» again'
);
select is(
  current_setting('iqup.undo_enrollment', true), '', 'the undo flag is not left set'
);

-- ─── transfer_enrollment ────────────────────────────────────────────────────
select throws_like(
  $$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000003') $$,
  '%another type%', 'another group type → refused (refund first)'
);
select throws_like(
  $$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000004') $$,
  '%archived%', 'archived group → refused'
);
select throws_like(
  $$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000001') $$,
  '%already in this group%', 'same group → refused'
);
select throws_like(
  $$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000002', '2003-08-01') $$,
  '%outside the group dates%', 'before the group start → refused'
);
select throws_like(
  $$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000003', 'd7300000-0000-4000-8000-000000000002') $$,
  '%present or burned marks%', '«был» → refused'
);
select throws_ok(
  $$ select public.transfer_enrollment('f7300000-0000-4000-8000-000000000006', 'd7300000-0000-4000-8000-000000000002') $$,
  '23505', null, 'already enrolled in the target group → refused'
);
select is(
  public.transfer_enrollment('f7300000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000002', '2003-09-04'),
  '2003-09-04'::date, 'transferred with a payment, from 4 Sep'
);
select results_eq(
  $$ select e.group_id, e.start_date, s.started_at, (select count(*)::integer from public.payments p where p.subscription_id = s.id)
     from public.enrollments e join public.subscriptions s on s.enrollment_id = e.id
     where e.id = 'f7300000-0000-4000-8000-000000000002' $$,
  $$ values ('d7300000-0000-4000-8000-000000000002'::uuid, '2003-09-04'::date, '2003-09-04'::date, 1) $$,
  'the enrollment, its subscription and payment move together'
);
select is(
  (select count(*)::integer from public.attendance where student_id = 'e7300000-0000-4000-8000-000000000002'),
  0, 'the frozen mark of the old group is removed'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'enrollments' and action = 'update'
          and entity_id = 'f7300000-0000-4000-8000-000000000002' and reason = 'transfer_enrollment'),
  'journal: the transfer'
);

-- ─── change_group_teacher ───────────────────────────────────────────────────
-- G7 lessons: 2, 4, 9, 11, 16, 18, 23, 25, 30 Sep; held 2, 4, 16
select results_eq(
  $$ select lessons_total, lessons_held, lessons_locked
     from public.change_group_teacher_preview('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002', '2003-09-15') $$,
  $$ values (5, 1, 0) $$,
  'preview: 5 lessons from 15 Sep, one of them held'
);
select throws_ok(
  $$ select public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-0000000000ff', '2003-09-15') $$,
  '23503', null, 'unknown teacher → refused'
);
select results_eq(
  $$ select lessons_moved, lessons_held
     from public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002', '2003-09-15') $$,
  $$ values (5, 1) $$,
  'changed from 15 Sep: 5 lessons moved, one held'
);
select is(
  (select teacher_id from public.groups where id = 'd7300000-0000-4000-8000-000000000007'),
  'b7300000-0000-4000-8000-000000000002'::uuid, 'the group''s teacher is B'
);
select results_eq(
  $$ select lesson_date, teacher_id from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000007'
     and lesson_date in ('2003-09-11', '2003-09-16') order by lesson_date $$,
  $$ values ('2003-09-11'::date, 'b7300000-0000-4000-8000-000000000001'::uuid),
            ('2003-09-16'::date, 'b7300000-0000-4000-8000-000000000002'::uuid) $$,
  'lessons before the date keep teacher A'
);
-- 3600 / 12 = 300 per student-lesson: A 50 % × 3 (G7 2, 4 Sep + G1 9 Sep) = 450, B 40 % × 1 = 120
select results_eq(
  $$ select teacher_id, student_lessons, base_amount from public.v_payroll_preview
     where month = '2003-09-01' and teacher_id in ('b7300000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002')
     order by teacher_id $$,
  $$ values ('b7300000-0000-4000-8000-000000000001'::uuid, 3, 450), ('b7300000-0000-4000-8000-000000000002'::uuid, 1, 120) $$,
  'payroll: A keeps the lessons before 15 Sep, B gets the held one after'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'groups' and action = 'update'
          and entity_id = 'd7300000-0000-4000-8000-000000000007' and reason = 'change_group_teacher:2003-09-15'
          and before ->> 'teacher_id' = 'b7300000-0000-4000-8000-000000000001'
          and after ->> 'teacher_id' = 'b7300000-0000-4000-8000-000000000002'),
  'journal: the group''s teacher A → B from 15 Sep'
);
select is(
  (select count(*)::integer from public.audit_log where entity = 'lessons' and reason = 'change_group_teacher:2003-09-15'),
  5, 'journal: one row per moved lesson'
);
select lives_ok(
  $$ select public.generate_lessons('d7300000-0000-4000-8000-000000000007', '2003-10-07') $$,
  'later lessons are generated'
);
select is(
  (select teacher_id from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000007' and lesson_date = '2003-10-02'),
  'b7300000-0000-4000-8000-000000000002'::uuid, 'a lesson generated after the change goes to B'
);

-- closed period: 23 Sep closed → moving back from 15 Sep is refused, from 24 Sep is fine
reset role;
update public.lessons set is_locked = true
where group_id = 'd7300000-0000-4000-8000-000000000007' and lesson_date = '2003-09-23';
set local role authenticated;
select results_eq(
  $$ select lessons_locked from public.change_group_teacher_preview('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000001', '2003-09-15') $$,
  $$ values (1) $$,
  'preview: a closed lesson is reported'
);
select throws_like(
  $$ select public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000001', '2003-09-15') $$,
  '%closed period%', 'a closed lesson after the date → refused'
);
select is(
  (select teacher_id from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000007' and lesson_date = '2003-09-23'),
  'b7300000-0000-4000-8000-000000000002'::uuid, 'the closed lesson keeps its teacher'
);
select results_eq(
  $$ select lessons_moved from public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000001', '2003-09-24') $$,
  $$ values (4) $$,
  'after the closed lesson: 25, 30 Sep, 2, 7 Oct move back to A'
);
-- default date = group start
select results_eq(
  $$ select lessons_moved from public.change_group_teacher('d7300000-0000-4000-8000-000000000008', 'b7300000-0000-4000-8000-000000000002') $$,
  $$ values (9) $$,
  'no date → every lesson from the group start'
);
-- back to B from 24 Sep for the access checks below
select lives_ok(
  $$ select public.change_group_teacher('d7300000-0000-4000-8000-000000000007', 'b7300000-0000-4000-8000-000000000002', '2003-09-24') $$,
  'G7 is B''s again from 24 Sep'
);

-- ─── Teacher access by lessons.teacher_id ───────────────────────────────────
set local request.jwt.claims = '{"sub":"a7300000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select set_eq(
  $$ select lesson_date from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000007' $$,
  $$ values ('2003-09-02'::date), ('2003-09-04'::date), ('2003-09-09'::date), ('2003-09-11'::date) $$,
  'old teacher A sees only the lessons before the change'
);
select ok(
  exists (select 1 from public.groups where id = 'd7300000-0000-4000-8000-000000000007'),
  'A still sees the group of those lessons'
);
select is(
  (select count(*)::integer from public.enrollments where group_id = 'd7300000-0000-4000-8000-000000000007'),
  1, 'A still sees the roster of those lessons'
);
select is(
  (select count(*)::integer from public.v_payroll_preview where month = '2003-09-01'),
  1, 'A sees only their own payroll row'
);
select throws_ok(
  $$ select public.confirm_lesson((select id from l73 where grp = 'S73 G7' and lesson_date = '2003-09-18'), '[]'::jsonb) $$,
  '42501', null, 'A cannot confirm B''s lesson'
);
select throws_ok(
  $$ select public.create_extra_lesson('d7300000-0000-4000-8000-000000000007', public.bishkek_today() + 1, '19:00') $$,
  '42501', null, 'A no longer adds extra lessons to the group'
);

set local request.jwt.claims = '{"sub":"a7300000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is(
  (select count(*)::integer from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000007' and lesson_date < '2003-09-15'),
  0, 'new teacher B does not see A''s lessons'
);
select is(
  (select count(*)::integer from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000007' and lesson_date >= '2003-09-15'),
  7, 'B sees the lessons from the change on (to 7 Oct)'
);

-- ─── delete_group ───────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a7300000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.group_delete_blockers('d7300000-0000-4000-8000-000000000001'),
  array['marks', 'enrollments', 'trials'], 'G1: marks, enrollments, trials'
);
select is(
  public.group_delete_blockers('d7300000-0000-4000-8000-000000000002'),
  array['enrollments', 'payments'], 'G2: enrollments, payments'
);
select is(
  public.group_delete_blockers('d7300000-0000-4000-8000-000000000006'),
  array['marks', 'enrollments', 'locked'], 'G6: marks, enrollments, a closed lesson'
);
select throws_like(
  $$ select public.delete_group('d7300000-0000-4000-8000-000000000001') $$,
  '%cannot be deleted: marks, enrollments, trials%', 'a group with marks → refused'
);
select is(public.group_delete_blockers('d7300000-0000-4000-8000-000000000005'), '{}'::text[], 'G5 is empty');
select is(public.delete_group('d7300000-0000-4000-8000-000000000005'), 9, 'G5 deleted with its 9 lessons');
select is(
  (select count(*)::integer from public.groups where id = 'd7300000-0000-4000-8000-000000000005')
  + (select count(*)::integer from public.schedule_rules where group_id = 'd7300000-0000-4000-8000-000000000005')
  + (select count(*)::integer from public.lessons where group_id = 'd7300000-0000-4000-8000-000000000005'),
  0, 'group, schedule and lessons are gone'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'groups' and action = 'delete'
          and entity_id = 'd7300000-0000-4000-8000-000000000005' and reason = 'delete_group'
          and before ->> 'name' = 'S73 G5'),
  'journal: the group deletion'
);

select * from finish();
rollback;
