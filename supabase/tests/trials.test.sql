-- #46 · trials (0015): RLS (teacher sees and marks only own groups' trials, accountant reads),
-- trials_guard transitions, enroll_trial, and Ж2/Ж6 — a trial never writes attendance, never consumes
-- a lesson and never counts in v_payroll_preview. Self-contained fixtures, rolled back.
begin;
select plan(39);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 teacher A (group A), a…2 teacher B (group B), a…3 admin, a…4 accountant
insert into auth.users (id, email) values
  ('a4600000-0000-4000-8000-000000000001', 'teacher46a@test.local'),
  ('a4600000-0000-4000-8000-000000000002', 'teacher46b@test.local'),
  ('a4600000-0000-4000-8000-000000000003', 'admin46@test.local'),
  ('a4600000-0000-4000-8000-000000000004', 'acc46@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b4600000-0000-4000-8000-000000000001', 'Teacher A', '996000004601'),
  ('b4600000-0000-4000-8000-000000000002', 'Teacher B', '996000004602');
insert into public.profiles (id, phone, full_name, roles) values
  ('a4600000-0000-4000-8000-000000000001', '996000004601', 'Teacher A', '{teacher}'),
  ('a4600000-0000-4000-8000-000000000002', '996000004602', 'Teacher B', '{teacher}'),
  ('a4600000-0000-4000-8000-000000000003', '996000004603', 'Admin', '{admin}'),
  ('a4600000-0000-4000-8000-000000000004', '996000004604', 'Accountant', '{accountant}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b4600000-0000-4000-8000-000000000001', 45, '2000-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d4600000-0000-4000-8000-000000000001', 'Group 46A', (select id from public.subjects where name = 'Математика'), 8, 'group', 'b4600000-0000-4000-8000-000000000001', '2000-01-01', 'active'),
  ('d4600000-0000-4000-8000-000000000002', 'Group 46B', (select id from public.subjects where name = 'Химия'), 9, 'group', 'b4600000-0000-4000-8000-000000000002', '2000-01-01', 'forming');

-- S1 — enrolled in group A with a subscription
insert into public.students (id, full_name, grade, parent_phone) values
  ('e4600000-0000-4000-8000-000000000001', 'S1', 8, '996555000001'),
  ('e4600000-0000-4000-8000-000000000002', 'S2 existing', 7, '996555000002');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f4600000-0000-4000-8000-000000000001', 'e4600000-0000-4000-8000-000000000001', 'd4600000-0000-4000-8000-000000000001', '2000-01-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select '14600000-0000-4000-8000-000000000001', 'f4600000-0000-4000-8000-000000000001', t.id, 12, 3600, 3600, '2000-01-01'
from public.tariffs t where t.group_type = 'group' order by t.valid_from desc limit 1;

-- …01 group A today 00:00 (started), …02 group A tomorrow, …03 group A yesterday, …04 group B tomorrow,
-- …05 group A in a week
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min) values
  ('24600000-0000-4000-8000-000000000001', 'd4600000-0000-4000-8000-000000000001', public.bishkek_today(), '00:00', 60),
  ('24600000-0000-4000-8000-000000000002', 'd4600000-0000-4000-8000-000000000001', public.bishkek_today() + 1, '09:00', 60),
  ('24600000-0000-4000-8000-000000000003', 'd4600000-0000-4000-8000-000000000001', public.bishkek_today() - 1, '09:00', 60),
  ('24600000-0000-4000-8000-000000000004', 'd4600000-0000-4000-8000-000000000002', public.bishkek_today() + 1, '09:00', 60),
  ('24600000-0000-4000-8000-000000000005', 'd4600000-0000-4000-8000-000000000001', public.bishkek_today() + 7, '09:00', 60);

-- ─── Admin books trials ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4600000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ insert into public.trials (id, full_name, grade, parent_phone, group_id, lesson_id, source)
     values ('74600000-0000-4000-8000-000000000001', 'Розаина Бекова', 8, '996995857758',
             'd4600000-0000-4000-8000-000000000002', '24600000-0000-4000-8000-000000000001', 'instagram') $$,
  'admin books a lead on today''s lesson'
);
select is(
  (select group_id from public.trials where id = '74600000-0000-4000-8000-000000000001'),
  'd4600000-0000-4000-8000-000000000001'::uuid,
  'group_id is the lesson''s group whatever the client sends'
);
select is(
  (select created_by from public.trials where id = '74600000-0000-4000-8000-000000000001'),
  'a4600000-0000-4000-8000-000000000003'::uuid,
  'created_by is the signed-in admin'
);
select lives_ok(
  $$ insert into public.trials (id, full_name, lesson_id, group_id)
     values ('74600000-0000-4000-8000-000000000002', 'Адема Кадырова', '24600000-0000-4000-8000-000000000002',
             'd4600000-0000-4000-8000-000000000001'),
            ('74600000-0000-4000-8000-000000000003', 'Бакай Осмонов', '24600000-0000-4000-8000-000000000001',
             'd4600000-0000-4000-8000-000000000001'),
            ('74600000-0000-4000-8000-000000000004', 'Чужой', '24600000-0000-4000-8000-000000000004',
             'd4600000-0000-4000-8000-000000000002') $$,
  'admin books several trials (a whole forming group too)'
);
select lives_ok(
  $$ insert into public.trials (id, student_id, full_name, lesson_id, group_id)
     values ('74600000-0000-4000-8000-000000000005', 'e4600000-0000-4000-8000-000000000002', 'x',
             '24600000-0000-4000-8000-000000000002', 'd4600000-0000-4000-8000-000000000001') $$,
  'an existing student may come to a trial in another group'
);
select is(
  (select full_name || ' ' || grade || ' ' || parent_phone from public.trials where id = '74600000-0000-4000-8000-000000000005'),
  'S2 existing 7 996555000002',
  'an existing student''s name, class and phone are copied from students'
);
select throws_ok(
  $$ insert into public.trials (student_id, full_name, lesson_id, group_id)
     values ('e4600000-0000-4000-8000-000000000001', 'S1', '24600000-0000-4000-8000-000000000002',
             'd4600000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a student already enrolled in the group cannot have a trial there'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id)
     values ('Прошлый', '24600000-0000-4000-8000-000000000003', 'd4600000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a trial is not booked on a past lesson'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id, status)
     values ('Сразу был', '24600000-0000-4000-8000-000000000002', 'd4600000-0000-4000-8000-000000000001', 'attended') $$,
  '23514', null, 'a trial starts as scheduled'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id)
     values (' адема кадырова ', '24600000-0000-4000-8000-000000000002', 'd4600000-0000-4000-8000-000000000001') $$,
  '23505', null, 'the same person is booked once per lesson'
);

-- ─── Teacher B: does not see group A ────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4600000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select results_eq(
  $$ select full_name from public.trials order by full_name $$,
  $$ values ('Чужой') $$,
  'teacher B sees only the trials of own groups'
);
update public.trials set status = 'no_show' where id = '74600000-0000-4000-8000-000000000001';
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id)
     values ('Свой', '24600000-0000-4000-8000-000000000004', 'd4600000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a teacher cannot book trials'
);

-- ─── Teacher A: marks own trials ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4600000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select is(
  (select status::text from public.trials where id = '74600000-0000-4000-8000-000000000001'),
  'scheduled',
  'teacher B''s update did not touch group A''s trial'
);
select is((select count(*)::integer from public.trials), 4, 'teacher A sees the 4 trials of group A');
select lives_ok(
  $$ update public.trials set status = 'attended' where id = '74600000-0000-4000-8000-000000000001' $$,
  'teacher marks «Был»'
);
select is(
  (select row(came, marked_by) from public.trials where id = '74600000-0000-4000-8000-000000000001'),
  row(true, 'a4600000-0000-4000-8000-000000000001'::uuid),
  'came and marked_by are set by the database'
);
select lives_ok(
  $$ update public.trials set status = 'no_show' where id = '74600000-0000-4000-8000-000000000003' $$,
  'teacher marks «Не пришёл»'
);
select throws_ok(
  $$ update public.trials set status = 'attended' where id = '74600000-0000-4000-8000-000000000002' $$,
  '23514', null, 'tomorrow''s trial cannot be marked yet'
);
select throws_ok(
  $$ update public.trials set status = 'closed' where id = '74600000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a teacher cannot close a trial'
);
select throws_ok(
  $$ update public.trials set note = 'x' where id = '74600000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a teacher changes nothing but the mark'
);

-- Ж2 / Ж6: the lesson is confirmed with S1 present; the trial changes nothing in attendance / payroll.
select lives_ok(
  $$ select public.confirm_lesson('24600000-0000-4000-8000-000000000001',
       '[{"student_id":"e4600000-0000-4000-8000-000000000001","status":"present"}]') $$,
  'teacher confirms the lesson with the enrolled student'
);

-- ─── Accountant reads, writes nothing ───────────────────────────────────────
set local request.jwt.claims = '{"sub":"a4600000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';

select is((select count(*)::integer from public.trials where id::text like '7460%'), 5, 'accountant reads all trials');
update public.trials set status = 'closed' where id = '74600000-0000-4000-8000-000000000003';

reset role;

select is(
  (select status::text from public.trials where id = '74600000-0000-4000-8000-000000000003'),
  'no_show',
  'accountant cannot change a trial'
);
select is(
  (select count(*)::integer from public.attendance where lesson_id = '24600000-0000-4000-8000-000000000001'),
  1,
  'the trial wrote no attendance (only S1)'
);
select is(
  (select row(student_lessons, base_amount) from public.v_payroll_preview
   where teacher_id = 'b4600000-0000-4000-8000-000000000001'
     and month = date_trunc('month', public.bishkek_today())::date),
  row(1, 135),
  'payroll: one student-lesson (S1, 3600 / 12 × 45 %), the trials are not paid'
);
select is(
  (select lessons_used from public.v_subscription_balances
   where subscription_id = '14600000-0000-4000-8000-000000000001'),
  1,
  'only S1''s lesson is written off'
);
select is(
  (select count(*)::integer from public.enrollments where group_id = 'd4600000-0000-4000-8000-000000000001' and status = 'active'),
  1,
  'trials are not enrollments — group fill stays 1'
);

-- ─── Admin: decisions ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4600000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select throws_ok(
  $$ select * from public.enroll_trial('74600000-0000-4000-8000-000000000002', public.bishkek_today() + 7) $$,
  '23514', null, 'a trial that has not been attended cannot be enrolled'
);
select throws_ok(
  $$ select * from public.enroll_trial('74600000-0000-4000-8000-000000000001', public.bishkek_today()) $$,
  '23514', null, 'the subscription starts after the trial lesson (it stays free)'
);
select lives_ok(
  $$ select * from public.enroll_trial('74600000-0000-4000-8000-000000000001', public.bishkek_today() + 1) $$,
  '«Оплатил → зачислить»'
);
select results_eq(
  $$ select t.status::text, s.full_name, s.parent_phone, sub.price_full, sub.started_at
     from public.trials t
     join public.enrollments e on e.id = t.enrollment_id and e.student_id = t.student_id
     join public.students s on s.id = t.student_id
     join public.subscriptions sub on sub.enrollment_id = e.id
     where t.id = '74600000-0000-4000-8000-000000000001' $$,
  $$ values ('enrolled', 'Розаина Бекова', '996995857758',
             (select package_price from public.tariffs where group_type = 'group' and valid_from <= public.bishkek_today() + 1 order by valid_from desc limit 1),
             public.bishkek_today() + 1) $$,
  'the lead became a student with an enrollment and a subscription from the next day'
);
select throws_ok(
  $$ update public.trials set status = 'closed' where id = '74600000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an enrolled trial is final'
);
select throws_ok(
  $$ update public.trials set status = 'scheduled' where id = '74600000-0000-4000-8000-000000000003' $$,
  '23514', null, '«Записать заново» needs another lesson'
);
select lives_ok(
  $$ update public.trials set status = 'scheduled', lesson_id = '24600000-0000-4000-8000-000000000005'
     where id = '74600000-0000-4000-8000-000000000003' $$,
  '«Записать заново» on next week''s lesson'
);
select is(
  (select row(status::text, came, marked_at) from public.trials where id = '74600000-0000-4000-8000-000000000003'),
  row('scheduled'::text, null::boolean, null::timestamptz),
  'rebooked trial waits for a new mark'
);
select lives_ok(
  $$ update public.trials set status = 'closed' where id = '74600000-0000-4000-8000-000000000003' $$,
  '«Закрыть»'
);

-- a schedule change does not delete a lesson someone is booked on
select lives_ok(
  $$ select * from public.reschedule_group('d4600000-0000-4000-8000-000000000001', public.bishkek_today(),
       array[(extract(isodow from public.bishkek_today() + 3)::integer)], '18:00', public.bishkek_today() + 3) $$,
  'admin reschedules group A'
);
select ok(
  exists (select 1 from public.lessons where id = '24600000-0000-4000-8000-000000000002'),
  'tomorrow''s lesson with Адема''s trial stays'
);

reset role;

select ok(
  (select count(*) from public.audit_log where entity = 'trials') >= 9,
  'every trial change is in audit_log'
);

select * from finish();
rollback;
