-- #95 · unconfirm_lesson / lesson_payroll_impact (0027): admin only, a reason, only a held lesson of
-- an open period; the marks go, pending requests are rejected, presets and trials stay, the payroll
-- drops by exactly the preview; lessons_guard still refuses a direct reset; confirm_lesson works
-- again. After-school: the preview prices by hours (И62). Self-contained fixtures in 2003, rolled back.
--
-- March 2003: Mondays 3, 10, …; Wednesdays 5, …; Fridays 7, ….
begin;
select plan(36);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9500000-0000-4000-8000-000000000001', 'teacher95@test.local'),
  ('a9500000-0000-4000-8000-000000000003', 'admin95@test.local'),
  ('a9500000-0000-4000-8000-000000000004', 'acc95@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9500000-0000-4000-8000-000000000001', 'Teacher 95', '996000009501');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9500000-0000-4000-8000-000000000001', '996000009501', 'Teacher 95', '{teacher}'),
  ('a9500000-0000-4000-8000-000000000003', '996000009503', 'Admin 95', '{admin}'),
  ('a9500000-0000-4000-8000-000000000004', '996000009504', 'Accountant 95', '{accountant}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b9500000-0000-4000-8000-000000000001', 40, '2003-01-01');

insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('mini', 12, 3200, 6, 60, 2, '2003-01-01', null),
  ('afterschool', 20, 7400, 8, 180, 2, '2003-01-01', 100);

-- G1 — mini, Mon / Wed / Fri 15:00; G2 — after-school Mon–Fri 13:00
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d9500000-0000-4000-8000-000000000001', 'Group 95', (select id from public.subjects where name = 'Математика'), 8, 'mini', 'b9500000-0000-4000-8000-000000000001', '2003-03-01', 'active'),
  ('d9500000-0000-4000-8000-000000000002', 'Продлёнка 95', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b9500000-0000-4000-8000-000000000001', '2003-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from) values
  ('d9500000-0000-4000-8000-000000000001', 1, '15:00', '2003-03-01'),
  ('d9500000-0000-4000-8000-000000000001', 3, '15:00', '2003-03-01'),
  ('d9500000-0000-4000-8000-000000000001', 5, '15:00', '2003-03-01');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd9500000-0000-4000-8000-000000000002', d, '13:00', '2003-03-01' from generate_series(1, 5) d;
select public.generate_lessons('d9500000-0000-4000-8000-000000000001', '2003-03-31');
select public.generate_lessons('d9500000-0000-4000-8000-000000000002', '2003-03-31');

insert into public.students (id, full_name)
select ('e9500000-0000-4000-8000-00000000000' || n)::uuid, 'S95-' || n from generate_series(1, 5) n;

create function pg_temp.lesson(p_group int, p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = ('d9500000-0000-4000-8000-00000000000' || p_group)::uuid and lesson_date = p_date;
$$;
create function pg_temp.st(n int)
returns uuid language sql as $$ select ('e9500000-0000-4000-8000-00000000000' || n)::uuid; $$;
create function pg_temp.pay()
returns integer language sql as $$
  select coalesce((select base_amount from public.v_payroll_preview
    where teacher_id = 'b9500000-0000-4000-8000-000000000001' and month = '2003-03-01'), 0);
$$;
create function pg_temp.marks(p_status text[])
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('student_id', pg_temp.st(i::int), 'status', p_status[i]))
  from generate_subscripts(p_status, 1) i;
$$;
create table pg_temp.seen (key text primary key, n integer);
grant execute on function pg_temp.lesson(int, date), pg_temp.st(int), pg_temp.pay(), pg_temp.marks(text[])
  to authenticated, anon;
grant all on pg_temp.seen to authenticated;

-- ─── Admin enrolls and holds; the teacher asks to fix one lesson ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select public.enroll_student(pg_temp.st(n), 'd9500000-0000-4000-8000-000000000001', '2003-03-01')
from generate_series(1, 3) n;
-- after-school: S4 — 2 h on Mondays, S5 — the default plan (3 h)
select * from public.enroll_student(pg_temp.st(4), 'd9500000-0000-4000-8000-000000000002',
  '2003-03-01', 0, 'none', array[2, 0, 1, 0, 2, 0, 0]::numeric[]);
select * from public.enroll_student(pg_temp.st(5), 'd9500000-0000-4000-8000-000000000002', '2003-03-01');

-- 03.03: 3 present; 05.03: 2 present + 1 frozen; 07.03: 3 frozen (nothing consumed)
select public.confirm_lesson(pg_temp.lesson(1, '2003-03-03'), pg_temp.marks(array['present', 'present', 'present']));
select public.confirm_lesson(pg_temp.lesson(1, '2003-03-05'), pg_temp.marks(array['present', 'present', 'absent_frozen']));
select public.confirm_lesson(pg_temp.lesson(1, '2003-03-07'), pg_temp.marks(array['absent_frozen', 'absent_frozen', 'absent_frozen']));
select public.confirm_lesson(pg_temp.lesson(2, '2003-03-03'), jsonb_build_array(
  jsonb_build_object('student_id', pg_temp.st(4), 'status', 'present'),
  jsonb_build_object('student_id', pg_temp.st(5), 'status', 'present')));

set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
insert into public.attendance_correction_requests (lesson_id, marks, comment)
values (pg_temp.lesson(1, '2003-03-05'),
  jsonb_build_array(jsonb_build_object('student_id', pg_temp.st(3), 'status', 'present')),
  'S95-3 была');

reset role;
-- a preset and a trial on 05.03, a held lesson in a closed period (10.03), a cancelled one (12.03)
set session_replication_role = replica;
insert into public.attendance_presets (lesson_id, student_id, status, comment)
values (pg_temp.lesson(1, '2003-03-05'), pg_temp.st(2), 'absent_frozen', 'предупредил');
insert into public.trials (full_name, group_id, lesson_id, status)
values ('Trial 95', 'd9500000-0000-4000-8000-000000000001', pg_temp.lesson(1, '2003-03-05'), 'scheduled');
update public.lessons set status = 'held', confirmed_at = now(), is_locked = true
where id = pg_temp.lesson(1, '2003-03-10');
update public.lessons set status = 'cancelled', cancel_reason = 'center' where id = pg_temp.lesson(1, '2003-03-12');
set session_replication_role = origin;

-- ─── Access ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-05'), 'не та дата') $$,
  '42501', null, 'the teacher cannot unconfirm a lesson'
);
select throws_ok(
  $$ select * from public.lesson_payroll_impact(pg_temp.lesson(1, '2003-03-05')) $$,
  '42501', null, 'the teacher cannot read the payroll impact'
);

set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-05'), 'не та дата') $$,
  '42501', null, 'the accountant cannot unconfirm a lesson'
);

reset role;
set local role anon;
select throws_ok(
  $$ select public.unconfirm_lesson('00000000-0000-4000-8000-000000000000', 'x') $$,
  '42501', null, 'anon cannot unconfirm a lesson'
);

-- ─── Refusals (admin) ───────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-05'), '   ') $$,
  '23514', 'reason is required', 'a reason is required'
);
select throws_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-05'), repeat('x', 501)) $$,
  '23514', 'reason is too long', 'the reason is at most 500 characters'
);
select throws_like(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-14'), 'x') $$,
  '%is not held', 'a planned lesson is refused'
);
select throws_like(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-12'), 'x') $$,
  '%is not held', 'a cancelled lesson is refused'
);
select throws_like(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-10'), 'x') $$,
  '%closed period', 'a lesson of a closed period is refused'
);
select throws_like(
  $$ update public.lessons set confirmed_at = null where id = pg_temp.lesson(1, '2003-03-05') $$,
  'confirmed_at of lesson % cannot be changed', 'a direct reset of confirmed_at fails for the admin'
);
select throws_like(
  $$ update public.lessons set status = 'planned' where id = pg_temp.lesson(1, '2003-03-05') $$,
  '%only by unconfirm_lesson', 'a direct held → planned fails for the admin'
);
select is(
  (select status::text || ' ' || (confirmed_at is not null) from public.lessons where id = pg_temp.lesson(1, '2003-03-05')),
  'held true', 'the refusals changed nothing'
);

-- ─── Preview ────────────────────────────────────────────────────────────────
-- 3200 / 12 × 40 % = 106.67 per mark
select is(
  (select marks || ' ' || amount || ' ' || teacher_name from public.lesson_payroll_impact(pg_temp.lesson(1, '2003-03-05'))),
  '2 213 Teacher 95', '05.03: 2 consumed marks, −213'
);
select is(
  (select marks || ' ' || amount from public.lesson_payroll_impact(pg_temp.lesson(1, '2003-03-07'))),
  '0 0', 'a lesson with frozen marks only — 0'
);
select is(
  (select marks || ' ' || amount from public.lesson_payroll_impact(pg_temp.lesson(1, '2003-03-14'))),
  '0 0', 'a planned lesson — 0'
);

-- ─── Unconfirm 05.03 ────────────────────────────────────────────────────────
insert into pg_temp.seen values
  ('pay', pg_temp.pay()),
  ('impact', (select amount from public.lesson_payroll_impact(pg_temp.lesson(1, '2003-03-05'))));
select lives_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-05'), '  провели не ту дату  ') $$,
  'the admin unconfirms a held lesson'
);
select is(
  (select concat_ws(' ', status, confirmed_at is null, confirmed_by is null, confirmed_late)
   from public.lessons where id = pg_temp.lesson(1, '2003-03-05')),
  'planned t t f', 'the lesson is planned, confirmed_* reset'
);
select is(
  (select count(*)::integer from public.attendance where lesson_id = pg_temp.lesson(1, '2003-03-05')),
  0, 'its marks are deleted'
);
select is(
  (select status || ' | ' || decision_comment from public.attendance_correction_requests
   where lesson_id = pg_temp.lesson(1, '2003-03-05')),
  'rejected | занятие возвращено в запланированные: провели не ту дату',
  'the pending request is rejected with the reason'
);
select is(
  (select count(*)::integer from public.attendance_presets where lesson_id = pg_temp.lesson(1, '2003-03-05')),
  1, 'the preset stays'
);
select is(
  (select count(*)::integer from public.trials where lesson_id = pg_temp.lesson(1, '2003-03-05')),
  1, 'the trial stays'
);
select is(
  pg_temp.pay(),
  (select n from pg_temp.seen where key = 'pay') - (select n from pg_temp.seen where key = 'impact'),
  'v_payroll_preview drops by exactly lesson_payroll_impact.amount'
);
select is(
  (select count(*)::integer from public.attendance a
   join public.lessons l on l.id = a.lesson_id
   where l.group_id = 'd9500000-0000-4000-8000-000000000001' and l.lesson_date <> '2003-03-05'),
  6, 'other lessons keep their marks'
);

-- ─── Journal ────────────────────────────────────────────────────────────────
select is(
  (select concat_ws(' | ', reason, kind, jsonb_array_length(marks), amount) from public.v_audit_feed
   where entity = 'lessons' and entity_id = pg_temp.lesson(1, '2003-03-05')
     and before ->> 'status' = 'held' and after ->> 'status' = 'planned'),
  'провели не ту дату | retro | 3 | 213', 'А10: the lesson row — reason, retro, 3 marks, −213'
);
select is(
  (select count(*)::integer from public.v_audit_feed
   where entity = 'attendance' and action = 'delete' and reason = 'провели не ту дату'
     and before ->> 'lesson_id' = pg_temp.lesson(1, '2003-03-05')::text and kind = 'retro'),
  3, 'А10: a row per deleted mark with the reason'
);

-- ─── Confirm again ──────────────────────────────────────────────────────────
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson(1, '2003-03-05'), pg_temp.marks(array['present', 'present', 'present'])) $$,
  'confirm_lesson works again'
);
select is(
  (select concat_ws(' ', status, confirmed_at is not null, confirmed_late)
   from public.lessons where id = pg_temp.lesson(1, '2003-03-05')),
  'held t t', 'a new confirmed_at, late by bishkek_today()'
);
select is(
  pg_temp.pay(),
  (select n from pg_temp.seen where key = 'pay') + 107,
  'the payroll counts the new marks (3 × 106.67 instead of 2)'
);
select throws_like(
  $$ update public.lessons set confirmed_at = null where id = pg_temp.lesson(1, '2003-03-05') $$,
  'confirmed_at of lesson % cannot be changed', 'the new confirmed_at is frozen again'
);

-- the teacher can hold an unconfirmed lesson again herself
select lives_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(1, '2003-03-07'), 'отметили на будущее') $$,
  'unconfirm a lesson without consumed marks'
);
set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson(1, '2003-03-07'), pg_temp.marks(array['present', 'present', 'absent_burned'])) $$,
  'the teacher confirms the unconfirmed lesson'
);
select is(
  (select confirmed_by::text from public.lessons where id = pg_temp.lesson(1, '2003-03-07')),
  'a9500000-0000-4000-8000-000000000001', 'confirmed_by — the teacher this time'
);

-- ─── After-school: a package of days (К13) ──────────────────────────────────
set local request.jwt.claims = '{"sub":"a9500000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
-- S4 2 h + S5 3 h on 20-day packages of 7 400; percent 40 — 148 a day whatever the hours
delete from pg_temp.seen;
insert into pg_temp.seen values
  ('pay', pg_temp.pay()),
  ('impact', (select amount from public.lesson_payroll_impact(pg_temp.lesson(2, '2003-03-03')))),
  ('by_days', (
    select round(sum(s.price_full * 40 / (s.lessons_total * 100.0)))::integer
    from public.attendance a join public.subscriptions s on s.id = a.subscription_id
    where a.lesson_id = pg_temp.lesson(2, '2003-03-03')
  ));
select is(
  (select marks from public.lesson_payroll_impact(pg_temp.lesson(2, '2003-03-03'))),
  2, 'after-school: 2 consumed marks'
);
select ok(
  (select n from pg_temp.seen where key = 'by_days') = 296
  and (select n from pg_temp.seen where key = 'impact') = (select n from pg_temp.seen where key = 'by_days'),
  'after-school: the preview is price_full / lessons_total × percent a day'
);
select lives_ok(
  $$ select public.unconfirm_lesson(pg_temp.lesson(2, '2003-03-03'), 'не та группа') $$,
  'after-school: unconfirm'
);
select is(
  pg_temp.pay(),
  (select n from pg_temp.seen where key = 'pay') - (select n from pg_temp.seen where key = 'impact'),
  'after-school: the payroll drops by exactly the preview'
);

select * from finish();
rollback;
