-- #54 · trials booked after the fact (0018): the admin books a lead on today's / a past not cancelled
-- lesson right away as attended / no_show, a teacher cannot; the journal files it as 'retro'; Ж2/Ж6 —
-- still no attendance / payroll. enroll_trial reuses an existing student with the same name and phone
-- (person_name_key) and keeps the lead's «привёл» / class on them.
-- Self-contained fixtures, rolled back.
begin;
select plan(33);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 teacher of the group, a…2 admin
insert into auth.users (id, email) values
  ('a5400000-0000-4000-8000-000000000001', 'teacher54@test.local'),
  ('a5400000-0000-4000-8000-000000000002', 'admin54@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b5400000-0000-4000-8000-000000000001', 'Teacher 54', '996000005401');
insert into public.profiles (id, phone, full_name, roles) values
  ('a5400000-0000-4000-8000-000000000001', '996000005401', 'Teacher 54', '{teacher}'),
  ('a5400000-0000-4000-8000-000000000002', '996000005402', 'Admin 54', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b5400000-0000-4000-8000-000000000001', 45, '2000-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d5400000-0000-4000-8000-000000000001', 'Group 54', (select id from public.subjects where name = 'Математика'), 8, 'group', 'b5400000-0000-4000-8000-000000000001', '2000-01-01', 'active'),
  ('d5400000-0000-4000-8000-000000000002', 'Group 54 old', (select id from public.subjects where name = 'Математика'), 8, 'group', 'b5400000-0000-4000-8000-000000000001', '2000-01-01', 'active');

-- …01 a former student (no enrollment left in the system, marked «бывший»), …02 enrolled in the group,
-- …03 a former student already «привёл» by …02 (the sibling of …01 comes later as a lead)
insert into public.students (id, full_name, grade, parent_phone, is_returning) values
  ('e5400000-0000-4000-8000-000000000001', 'Нурай Жумабаева', 8, '996555005401', true),
  ('e5400000-0000-4000-8000-000000000002', 'S enrolled', 8, '996555005402', false);
insert into public.students (id, full_name, grade, parent_phone, is_returning, referred_by_student_id) values
  ('e5400000-0000-4000-8000-000000000003', 'Алёна Ким', 7, '996555005430', true, 'e5400000-0000-4000-8000-000000000002');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f5400000-0000-4000-8000-000000000002', 'e5400000-0000-4000-8000-000000000002', 'd5400000-0000-4000-8000-000000000001', '2000-01-01');
insert into public.subscriptions (enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select 'f5400000-0000-4000-8000-000000000002', t.id, 12, 3600, 3600, '2000-01-01'
from public.tariffs t where t.group_type = 'group' order by t.valid_from desc limit 1;

-- …01 yesterday (planned, not confirmed yet), …02 three days ago (cancelled), …03 tomorrow,
-- …04 today, …05 in a week
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min) values
  ('25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', public.bishkek_today() - 1, '09:00', 60),
  ('25400000-0000-4000-8000-000000000002', 'd5400000-0000-4000-8000-000000000001', public.bishkek_today() - 3, '09:00', 60),
  ('25400000-0000-4000-8000-000000000003', 'd5400000-0000-4000-8000-000000000001', public.bishkek_today() + 1, '09:00', 60),
  ('25400000-0000-4000-8000-000000000004', 'd5400000-0000-4000-8000-000000000001', public.bishkek_today(), '00:00', 60),
  ('25400000-0000-4000-8000-000000000005', 'd5400000-0000-4000-8000-000000000001', public.bishkek_today() + 7, '09:00', 60);
update public.lessons set status = 'cancelled', cancel_reason = 'center'
where id = '25400000-0000-4000-8000-000000000002';
-- …06 yesterday in a group archived since
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min) values
  ('25400000-0000-4000-8000-000000000006', 'd5400000-0000-4000-8000-000000000002', public.bishkek_today() - 1, '09:00', 60);
update public.groups set status = 'archived' where id = 'd5400000-0000-4000-8000-000000000002';

-- ─── person_name_key: what «the same name» means (= nameKey in model.ts) ───
select results_eq(
  $$ select public.person_name_key(n) from (values
       ('  Нурай   Жумабаева '), (E'Нурай\u00a0Жумабаева'), (E'НУРАЙ\t \u00a0жумабаева'), ('АЛЁНА Ким')
     ) v(n) $$,
  $$ values ('нурай жумабаева'), ('нурай жумабаева'), ('нурай жумабаева'), ('алена ким') $$,
  'whitespace runs (NBSP, tabs) → one space, trimmed, lower case, ё = е'
);

-- ─── Teacher cannot book, not even after the fact ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select throws_ok(
  $$ insert into public.trials (full_name, parent_phone, lesson_id, group_id, status)
     values ('Учитель записал', '996555005499', '25400000-0000-4000-8000-000000000001',
             'd5400000-0000-4000-8000-000000000001', 'attended') $$,
  '42501', null, 'a teacher cannot book a trial after the fact'
);
select throws_ok(
  $$ insert into public.trials (full_name, parent_phone, lesson_id, group_id)
     values ('Учитель записал', '996555005499', '25400000-0000-4000-8000-000000000003',
             'd5400000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a teacher cannot book a trial at all'
);

-- ─── Admin books after the fact ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a5400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ insert into public.trials (id, full_name, grade, parent_phone, lesson_id, group_id, status, source)
     values ('75400000-0000-4000-8000-000000000001', 'Алия Садыкова', 8, '996555005410',
             '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'attended', 'referral') $$,
  'admin books a lead on yesterday''s lesson as attended'
);
select results_eq(
  $$ select status::text, came, marked_by, marked_at is not null, created_by
     from public.trials where id = '75400000-0000-4000-8000-000000000001' $$,
  $$ values ('attended', true, 'a5400000-0000-4000-8000-000000000002'::uuid, true,
             'a5400000-0000-4000-8000-000000000002'::uuid) $$,
  'the mark is set by the database: came, marked_at, marked_by = the admin'
);
select lives_ok(
  $$ insert into public.trials (id, full_name, parent_phone, lesson_id, group_id, status)
     values ('75400000-0000-4000-8000-000000000002', 'Не дошёл', '996555005411',
             '25400000-0000-4000-8000-000000000004', 'd5400000-0000-4000-8000-000000000001', 'no_show') $$,
  'admin books a lead on today''s lesson as no_show'
);
select is(
  (select came from public.trials where id = '75400000-0000-4000-8000-000000000002'),
  false, 'no_show after the fact: came = false'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id, status)
     values ('Отменённое', '25400000-0000-4000-8000-000000000002', 'd5400000-0000-4000-8000-000000000001', 'attended') $$,
  '23514', null, 'not on a cancelled lesson'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id, status)
     values ('Завтрашний', '25400000-0000-4000-8000-000000000003', 'd5400000-0000-4000-8000-000000000001', 'attended') $$,
  '23514', 'the trial lesson is not today yet', 'not on a future lesson'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id, status)
     values ('Архивный', '25400000-0000-4000-8000-000000000006', 'd5400000-0000-4000-8000-000000000002', 'attended') $$,
  '23514', 'group d5400000-0000-4000-8000-000000000002 is archived', 'not in an archived group'
);
select lives_ok(
  $$ insert into public.trials (id, full_name, parent_phone, lesson_id, group_id, status, came, marked_at, marked_by)
     values ('75400000-0000-4000-8000-000000000008', 'Подделка', '996555005413',
             '25400000-0000-4000-8000-000000000004', 'd5400000-0000-4000-8000-000000000001', 'attended',
             false, '2000-01-01', 'a5400000-0000-4000-8000-000000000001') $$,
  'admin books after the fact with a forged mark'
);
select results_eq(
  $$ select came, marked_by, marked_at > '2000-01-02'
     from public.trials where id = '75400000-0000-4000-8000-000000000008' $$,
  $$ values (true, 'a5400000-0000-4000-8000-000000000002'::uuid, true) $$,
  'came / marked_at / marked_by from the client are ignored — the database sets them'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id, status)
     values ('Закрытый', '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'closed') $$,
  '23514', 'a trial starts as scheduled', 'a trial starts as scheduled, attended or no_show only'
);
select throws_ok(
  $$ insert into public.trials (student_id, full_name, lesson_id, group_id, status)
     values ('e5400000-0000-4000-8000-000000000002', '—', '25400000-0000-4000-8000-000000000001',
             'd5400000-0000-4000-8000-000000000001', 'attended') $$,
  '23505', null, 'a student enrolled in the group gets no trial there, after the fact too'
);
select throws_ok(
  $$ insert into public.trials (full_name, lesson_id, group_id)
     values ('Прошлый', '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a scheduled booking on a past lesson is still refused'
);
select throws_ok(
  $$ update public.trials set lesson_id = '25400000-0000-4000-8000-000000000004'
     where id = '75400000-0000-4000-8000-000000000001' $$,
  '23514', null, '«Перенести» an attended trial to another past lesson is refused (only scheduled moves)'
);

-- ─── Ж2 / Ж6: nothing in attendance, subscriptions or payroll ──────────────
-- the teacher confirms yesterday's lesson late with the enrolled student; the trial on it changes nothing
set local request.jwt.claims = '{"sub":"a5400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select lives_ok(
  $$ select public.confirm_lesson('25400000-0000-4000-8000-000000000001',
       '[{"student_id":"e5400000-0000-4000-8000-000000000002","status":"present"}]') $$,
  'teacher confirms the lesson with the trial on it'
);
select is(
  (select count(*)::integer from public.attendance a
   where a.lesson_id in ('25400000-0000-4000-8000-000000000001', '25400000-0000-4000-8000-000000000004')),
  1, 'a trial after the fact writes no attendance (only the enrolled student''s row)'
);
select is(
  (select row(student_lessons, base_amount) from public.v_payroll_preview
   where teacher_id = 'b5400000-0000-4000-8000-000000000001'),
  row(1, 135), 'payroll counts the enrolled student only (3 600 / 12 × 45 %)'
);
set local request.jwt.claims = '{"sub":"a5400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ insert into public.trials (id, full_name, parent_phone, lesson_id, group_id, status)
     values ('75400000-0000-4000-8000-000000000009', 'На проведённое', '996555005414',
             '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'attended') $$,
  'after the fact on a held (confirmed) lesson too'
);

-- ─── Journal: 'retro' ───────────────────────────────────────────────────────
select is(
  (select kind from public.v_audit_feed
   where entity = 'trials' and entity_id = '75400000-0000-4000-8000-000000000001' and action = 'insert'),
  'retro', 'a trial booked after the fact is a correction after the fact (И32)'
);
select lives_ok(
  $$ insert into public.trials (id, full_name, parent_phone, lesson_id, group_id)
     values ('75400000-0000-4000-8000-000000000003', 'Обычная запись', '996555005412',
             '25400000-0000-4000-8000-000000000005', 'd5400000-0000-4000-8000-000000000001') $$,
  'a usual booking on a future lesson'
);
select is(
  (select kind from public.v_audit_feed
   where entity = 'trials' and entity_id = '75400000-0000-4000-8000-000000000003' and action = 'insert'),
  'other', 'a usual booking stays «other»'
);

-- ─── enroll_trial: the same name and phone → the existing student ─────────
select lives_ok(
  $$ insert into public.trials (id, full_name, parent_phone, lesson_id, group_id, status, grade, referred_by_student_id)
     values ('75400000-0000-4000-8000-000000000004', ' нурай жумабаева ', '996555005401',
             '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'attended',
             9, 'e5400000-0000-4000-8000-000000000002'),
            ('75400000-0000-4000-8000-000000000005', 'Айбек Жумабаев', '996555005401',
             '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'attended',
             null, null),
            ('75400000-0000-4000-8000-000000000007', E'АЛЕНА\u00a0\t КИМ', '996555005430',
             '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'attended',
             null, 'e5400000-0000-4000-8000-000000000001') $$,
  'a former student and a sibling (same phone, another name) come as leads'
);
select is(
  (select student_id from public.enroll_trial('75400000-0000-4000-8000-000000000004', public.bishkek_today() + 7, 15, 'returning')),
  'e5400000-0000-4000-8000-000000000001'::uuid,
  'same name (case / spaces ignored) and phone → enrolled as the existing student'
);
select is(
  (select count(*)::integer from public.students where parent_phone = '996555005401'),
  1, 'no duplicate students row for the former student'
);
select results_eq(
  $$ select grade, referred_by_student_id from public.students
     where id = 'e5400000-0000-4000-8000-000000000001' $$,
  $$ values (9, 'e5400000-0000-4000-8000-000000000002'::uuid) $$,
  'the lead''s «привёл друг» (И40) and class move to the existing student'
);
select is(
  (select s.discount_percent from public.subscriptions s
   join public.enrollments e on e.id = s.enrollment_id
   where e.student_id = 'e5400000-0000-4000-8000-000000000001'),
  15, 'the returning student''s 15 % (В5) applies'
);
select isnt(
  (select student_id from public.enroll_trial('75400000-0000-4000-8000-000000000005', public.bishkek_today() + 7)),
  'e5400000-0000-4000-8000-000000000001'::uuid,
  'same phone with another name (a sibling) → a new student'
);
select is(
  (select count(*)::integer from public.students where parent_phone = '996555005401'),
  2, 'the sibling is a new students row'
);

select is(
  (select student_id from public.enroll_trial('75400000-0000-4000-8000-000000000007', public.bishkek_today() + 7)),
  'e5400000-0000-4000-8000-000000000003'::uuid,
  'NBSP / tab / double space / Ё vs е in the name still match the existing student'
);
select results_eq(
  $$ select grade, referred_by_student_id from public.students
     where id = 'e5400000-0000-4000-8000-000000000003' $$,
  $$ values (7, 'e5400000-0000-4000-8000-000000000002'::uuid) $$,
  'a lead without a class keeps the student''s, an existing «привёл» is not overwritten'
);

-- several students with the same name and phone → refused
reset role;
insert into public.students (full_name, parent_phone) values
  ('Двойник', '996555005420'), ('двойник', '996555005420');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["admin"]}}';
insert into public.trials (id, full_name, parent_phone, lesson_id, group_id, status)
values ('75400000-0000-4000-8000-000000000006', 'Двойник', '996555005420',
        '25400000-0000-4000-8000-000000000001', 'd5400000-0000-4000-8000-000000000001', 'attended');
select throws_ok(
  $$ select * from public.enroll_trial('75400000-0000-4000-8000-000000000006', public.bishkek_today() + 7) $$,
  '23505', 'several students match the trial name and phone', 'an ambiguous match is refused'
);

reset role;
select * from finish();
rollback;
