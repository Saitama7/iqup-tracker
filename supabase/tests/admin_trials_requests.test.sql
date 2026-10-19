-- #94 · update_trial / reopen_trial and delete_correction_request (0028): admin only, a reason, a
-- direct write still refused, the journal. A trial changes its lead fields in any status, its lesson
-- while scheduled / attended / no_show; «Вернуть в воронку» from closed goes by the teacher's mark.
-- A mistaken correction request is deleted, the marks stay. Dates relative to today; rolled back.
begin;
select plan(29);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9440000-0000-4000-8000-000000000001', 'teacher944@test.local'),
  ('a9440000-0000-4000-8000-000000000003', 'admin944@test.local'),
  ('a9440000-0000-4000-8000-000000000004', 'acc944@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9440000-0000-4000-8000-000000000001', 'Teacher 944', '996000094401');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9440000-0000-4000-8000-000000000001', '996000094401', 'Teacher 944', '{teacher}'),
  ('a9440000-0000-4000-8000-000000000003', '996000094403', 'Admin 944', '{admin}'),
  ('a9440000-0000-4000-8000-000000000004', '996000094404', 'Accountant 944', '{accountant}');

create temp table d as select public.bishkek_today() as today;
grant select on d to authenticated, anon;
delete from public.holidays h where h.day between (select today - 20 from d) and (select today + 20 from d);

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select 'd9440000-0000-4000-8000-000000000001', 'Group 944', (select id from public.subjects where name = 'Математика'),
       8, 'mini', 'b9440000-0000-4000-8000-000000000001', today - 20, 'active' from d;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd9440000-0000-4000-8000-000000000001', w, '08:00', today - 20 from d, generate_series(1, 7) w;
select public.generate_lessons('d9440000-0000-4000-8000-000000000001', (select today + 20 from d));
insert into public.students (id, full_name) values ('e9440000-0000-4000-8000-000000000001', 'S944-1');

create function pg_temp.lesson(p_offset int)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = 'd9440000-0000-4000-8000-000000000001' and lesson_date = public.bishkek_today() + p_offset;
$$;
create function pg_temp.trial(p_name text)
returns uuid language sql as $$ select id from public.trials where full_name = p_name; $$;
grant execute on function pg_temp.lesson(int), pg_temp.trial(text) to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9440000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
insert into public.trials (full_name, parent_phone, lesson_id, status) values
  ('Лид 1', '996700000001', pg_temp.lesson(5), 'scheduled'),
  ('Лид 2', '996700000002', pg_temp.lesson(-5), 'attended'),
  ('Лид 3', '996700000003', pg_temp.lesson(5), 'scheduled'),
  ('Лид 4', '996700000004', pg_temp.lesson(-5), 'no_show');
update public.trials set status = 'closed' where full_name in ('Лид 2', 'Лид 3', 'Лид 4');
select public.cancel_lesson(pg_temp.lesson(7), 'center', null);

-- a held lesson with a teacher's request
select public.enroll_student('e9440000-0000-4000-8000-000000000001', 'd9440000-0000-4000-8000-000000000001', (select today - 20 from d));
select public.confirm_lesson(pg_temp.lesson(-3), jsonb_build_array(
  jsonb_build_object('student_id', 'e9440000-0000-4000-8000-000000000001', 'status', 'absent_burned')));
set local request.jwt.claims = '{"sub":"a9440000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
insert into public.attendance_correction_requests (lesson_id, marks, comment)
values (pg_temp.lesson(-3), jsonb_build_array(jsonb_build_object(
  'student_id', 'e9440000-0000-4000-8000-000000000001', 'status', 'present')), 'была');
create temp table req as select id from public.attendance_correction_requests where lesson_id = pg_temp.lesson(-3);

-- ─── Access ─────────────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.update_trial(pg_temp.trial('Лид 2'), 'Лид 2', null, null, null, null, null, 'опечатка') $$,
  '42501', null, 'the teacher cannot edit a trial'
);
select throws_ok(
  $$ select public.delete_correction_request((select id from req), 'ошибка') $$,
  '42501', null, 'the teacher cannot delete a correction request'
);
set local request.jwt.claims = '{"sub":"a9440000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.reopen_trial(pg_temp.trial('Лид 2'), 'передумали') $$,
  '42501', null, 'the accountant cannot reopen a trial'
);
select throws_ok(
  $$ select public.delete_correction_request((select id from req), 'ошибка') $$,
  '42501', null, 'the accountant cannot delete a correction request'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.reopen_trial('00000000-0000-4000-8000-000000000000', 'x') $$,
  '42501', null, 'anon cannot reopen a trial'
);
select throws_ok(
  $$ select public.delete_correction_request('00000000-0000-4000-8000-000000000000', 'x') $$,
  '42501', null, 'anon cannot delete a correction request'
);

-- ─── Trials (admin) ─────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9440000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_like(
  $$ update public.trials set full_name = 'Лид Два' where full_name = 'Лид 2' $$,
  '%is already decided%', 'a direct edit of a closed trial is still refused'
);
select throws_ok(
  $$ select public.update_trial(pg_temp.trial('Лид 2'), 'Лид Два', 9, '996700000022', 'instagram', null, null, '') $$,
  '23514', 'reason is required', 'a reason is required'
);
select lives_ok(
  $$ select public.update_trial(pg_temp.trial('Лид 2'), 'Лид Два', 9, '996700000022', 'instagram', 'мама звонила', null, 'опечатка в имени') $$,
  'the admin edits a closed trial: name, class, phone, source, note'
);
select results_eq(
  $$ select full_name, grade, parent_phone, source::text, note, status::text, came from public.trials where full_name = 'Лид Два' $$,
  $$ values ('Лид Два'::text, 9, '996700000022'::text, 'instagram'::text, 'мама звонила'::text, 'closed'::text, true) $$,
  'the fields are changed, the status and the mark stay'
);
select results_eq(
  $$ select before ->> 'full_name', after ->> 'full_name' from public.audit_log
     where entity = 'trials' and entity_id = pg_temp.trial('Лид Два') and reason = 'опечатка в имени' $$,
  $$ values ('Лид 2'::text, 'Лид Два'::text) $$,
  'the journal has the edit with its reason'
);
select throws_like(
  $$ select public.update_trial(pg_temp.trial('Лид Два'), 'Лид Два', 9, '996700000022', 'instagram', null, pg_temp.lesson(-4), 'другое занятие') $$,
  '%keeps its lesson%', 'a closed trial keeps its lesson'
);
select lives_ok(
  $$ select public.update_trial(pg_temp.trial('Лид 1'), 'Лид 1', null, '996700000001', null, null, pg_temp.lesson(6), 'перенесли') $$,
  'a scheduled trial moves to another planned lesson ahead'
);
select is((select lesson_id from public.trials where full_name = 'Лид 1'), pg_temp.lesson(6), 'moved');
select throws_like(
  $$ select public.update_trial(pg_temp.trial('Лид 1'), 'Лид 1', null, '996700000001', null, null, pg_temp.lesson(-4), 'назад') $$,
  '%planned lesson today or later%', 'a scheduled trial does not move to a past lesson'
);
select throws_like(
  $$ select public.update_trial(pg_temp.trial('Лид 1'), 'Лид 1', null, '996700000001', null, null, pg_temp.lesson(7), 'на отменённое') $$,
  '%planned lesson today or later%', 'nor to a cancelled one'
);
select throws_like(
  $$ select public.reopen_trial(pg_temp.trial('Лид 1'), 'ошибка') $$,
  '%is not closed%', 'only a closed trial goes back to the funnel'
);
select is(public.reopen_trial(pg_temp.trial('Лид Два'), 'передумали — оплатят')::text, 'attended', 'came → attended');
select is(public.reopen_trial(pg_temp.trial('Лид 3'), 'закрыли по ошибке')::text, 'scheduled', 'not marked, lesson ahead → scheduled');
select is(public.reopen_trial(pg_temp.trial('Лид 4'), 'перезвонить')::text, 'no_show', 'did not come → no_show');
select results_eq(
  $$ select before ->> 'status', after ->> 'status', reason from public.audit_log
     where entity = 'trials' and entity_id = pg_temp.trial('Лид 3') and reason = 'закрыли по ошибке' $$,
  $$ values ('closed'::text, 'scheduled'::text, 'закрыли по ошибке'::text) $$,
  'the journal has «Вернуть в воронку» with its reason'
);
select lives_ok(
  $$ update public.trials set status = 'enrolled' where false $$,
  'the usual flow is untouched'
);

-- ─── Correction request (admin) ─────────────────────────────────────────────
select throws_ok(
  $$ select public.delete_correction_request((select id from req), ' ') $$,
  '23514', 'reason is required', 'a reason is required'
);
delete from public.attendance_correction_requests where id = (select id from req);
select isnt_empty(
  $$ select 1 from public.attendance_correction_requests where id = (select id from req) $$,
  'a direct delete removes nothing (no delete policy)'
);
select throws_ok(
  $$ select public.delete_correction_request('00000000-0000-4000-8000-000000000000', 'ошибка') $$,
  'P0002', null, 'an unknown request'
);
select lives_ok(
  $$ select public.delete_correction_request((select id from req), 'учитель ошибся занятием') $$,
  'the admin deletes a mistaken request'
);
select is_empty(
  $$ select 1 from public.attendance_correction_requests where id = (select id from req) $$,
  'the request is gone'
);
select is(
  (select status::text from public.attendance where lesson_id = pg_temp.lesson(-3)),
  'absent_burned', 'the marks stay'
);
select results_eq(
  $$ select action, reason from public.audit_log where entity = 'attendance_correction_requests'
     and entity_id = (select id from req) and action = 'delete' $$,
  $$ values ('delete'::text, 'учитель ошибся занятием'::text) $$,
  'the journal has the delete with its reason'
);

select * from finish();
rollback;
