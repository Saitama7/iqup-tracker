-- #82 × #74 · исправление отметок продлёнки в часах (0021 correct_attendance / apply_correction_request
-- on 0025): a fixed mark keeps the plan hours of the day, «Был → Заморозка» gives the hours back to the
-- invoice and to the credit, the teacher's pay by hours follows, the freeze limit holds per invoice, a
-- teacher's request applies the same way, a student with 0 h that day cannot be added, a credit already
-- taken off an invoice is not billed twice. Self-contained fixtures in 2003, rolled back.
--
-- March 2003: Mondays 3, 10, 17, 24, 31; Tuesdays 4, …; Wednesdays 5, …; Fridays 7, ….
-- A — ПН 2 / СР 1 / ПТ 2 (0 h on Tuesday); B — the default plan (3 h Mon–Fri). Hour price 100, 45 %.
begin;
select plan(28);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher of the group, …3 admin
insert into auth.users (id, email) values
  ('a8210000-0000-4000-8000-000000000001', 'teacher821@test.local'),
  ('a8210000-0000-4000-8000-000000000003', 'admin821@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b8210000-0000-4000-8000-000000000001', 'Teacher 821', '996000008211');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8210000-0000-4000-8000-000000000001', '996000008211', 'Teacher 821', '{teacher}'),
  ('a8210000-0000-4000-8000-000000000003', '996000008213', 'Admin 821', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8210000-0000-4000-8000-000000000001', 45, '2003-01-01');

insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('afterschool', 20, 7400, 8, 180, 2, '2003-01-01', 100);

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d8210000-0000-4000-8000-000000000001', 'Продлёнка 821', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8210000-0000-4000-8000-000000000001', '2003-03-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8210000-0000-4000-8000-000000000001', d, '13:00', '2003-03-01' from generate_series(1, 5) d;

select public.generate_lessons('d8210000-0000-4000-8000-000000000001', '2003-04-30');

insert into public.students (id, full_name) values
  ('e8210000-0000-4000-8000-000000000001', 'A'),
  ('e8210000-0000-4000-8000-000000000002', 'B');

create function pg_temp.lesson(p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = 'd8210000-0000-4000-8000-000000000001' and lesson_date = p_date;
$$;
create function pg_temp.enr_a()
returns uuid language sql as $$
  select id from public.enrollments
  where student_id = 'e8210000-0000-4000-8000-000000000001' and group_id = 'd8210000-0000-4000-8000-000000000001';
$$;
create function pg_temp.sub_a(p_month date)
returns uuid language sql as $$
  select s.id from public.subscriptions s
  where s.enrollment_id = pg_temp.enr_a() and s.period_month = p_month;
$$;
-- A's mark on a date: status, hours, on the March invoice
create function pg_temp.mark_a(p_date date)
returns text language sql as $$
  select concat_ws(' ', a.status, a.hours, a.subscription_id = pg_temp.sub_a('2003-03-01'))
  from public.attendance a
  where a.lesson_id = pg_temp.lesson(p_date) and a.student_id = 'e8210000-0000-4000-8000-000000000001';
$$;
-- A's hours used on the March invoice
create function pg_temp.used_a()
returns numeric language sql as $$
  select lessons_used from public.v_student_balance where subscription_id = pg_temp.sub_a('2003-03-01');
$$;
create function pg_temp.pay()
returns text language sql as $$
  select concat_ws(' ', base_amount, student_hours) from public.v_payroll_preview
  where teacher_id = 'b8210000-0000-4000-8000-000000000001' and month = '2003-03-01';
$$;
grant execute on function pg_temp.lesson(date), pg_temp.enr_a(), pg_temp.sub_a(date), pg_temp.mark_a(date),
  pg_temp.used_a(), pg_temp.pay() to authenticated;

-- ─── Admin enrolls, the teacher marks ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8210000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select * from public.enroll_student('e8210000-0000-4000-8000-000000000001', 'd8210000-0000-4000-8000-000000000001',
  '2003-03-01', 0, 'none', array[2, 0, 1, 0, 2, 0, 0]::numeric[]);
select * from public.enroll_student('e8210000-0000-4000-8000-000000000002', 'd8210000-0000-4000-8000-000000000001', '2003-03-01');

set local request.jwt.claims = '{"sub":"a8210000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select public.confirm_lesson(pg_temp.lesson(d), jsonb_build_array(
  jsonb_build_object('student_id', 'e8210000-0000-4000-8000-000000000001', 'status', 'present'),
  jsonb_build_object('student_id', 'e8210000-0000-4000-8000-000000000002', 'status', 'present')))
from unnest(array['2003-03-03', '2003-03-05', '2003-03-07']::date[]) d;
select public.confirm_lesson(pg_temp.lesson('2003-03-04'), jsonb_build_array(
  jsonb_build_object('student_id', 'e8210000-0000-4000-8000-000000000002', 'status', 'present')));

-- A: 2 + 1 + 2 = 5 h → 225; B: 4 × 3 = 12 h → 540
select is(pg_temp.used_a(), 5.0, 'held: A used 5 h of the March invoice');
select is(pg_temp.pay(), '765 17.0', 'pay before the fix: 765 for 17 student-hours');

-- ─── Admin: «Был → Заморозка» ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8210000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.correct_attendance(pg_temp.lesson('2003-03-03'),
    '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'предупреждали заранее'),
  1,
  'admin: Monday 3 March, A present → freeze'
);
select is(pg_temp.mark_a('2003-03-03'), 'absent_frozen 2.0 t', 'the mark keeps the plan hours and the invoice');
select is(pg_temp.used_a(), 3.0, 'the day''s 2 h are given back to the invoice');
select is(public.afterschool_credit_hours(pg_temp.enr_a()), 2.0, 'and go to the credit of the next invoice');
select is(pg_temp.pay(), '675 15.0', 'pay follows: −2 h × 100 × 45 % = −90');
select is(
  public.correct_attendance(pg_temp.lesson('2003-03-03'),
    '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'повтор'),
  0,
  'a repeat is a no-op'
);

-- ─── «Был → Не был» keeps the charge; the freeze limit holds per invoice ────
select is(
  public.correct_attendance(pg_temp.lesson('2003-03-07'),
    '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"absent_burned"}]', 'не пришла'),
  1,
  'Friday 7 March: A present → did not come'
);
select is(pg_temp.mark_a('2003-03-07'), 'absent_burned 2.0 t', 'burned: the same 2 h on the invoice');
select is(pg_temp.pay(), '675 15.0', 'a burned day is paid like a present one');
select lives_ok(
  $$ select public.correct_attendance(pg_temp.lesson('2003-03-05'),
       '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'вторая заморозка') $$,
  'Wednesday 5 March: second freeze on the March invoice'
);
select throws_ok(
  $$ select public.correct_attendance(pg_temp.lesson('2003-03-07'),
       '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'третья') $$,
  '23514', null,
  'the freeze limit (2 per invoice) still holds'
);
select is(public.afterschool_credit_hours(pg_temp.enr_a()), 3.0, 'credit: Monday 2 h + Wednesday 1 h');

-- ─── 0 h that day: not on the lesson ────────────────────────────────────────
select throws_ok(
  $$ select public.correct_attendance(pg_temp.lesson('2003-03-04'),
       '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"present"}]', 'добавить') $$,
  '23514', null,
  'Tuesday: A has 0 h — a mark cannot be added by a correction'
);
select is(
  public.correct_attendance(pg_temp.lesson('2003-03-04'),
    '[{"student_id":"e8210000-0000-4000-8000-000000000002","status":"absent_frozen"}]', 'B предупредил'),
  1,
  'Tuesday: B (3 h that day) present → freeze'
);
select is(pg_temp.pay(), '495 11.0', 'pay: A 2 h (Fri) + B 9 h (Mon, Wed, Fri) = 11 h → 495');

-- ─── Teacher's request → admin applies ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8210000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values (pg_temp.lesson('2003-03-04'), '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"present"}]', 'A была') $$,
  '23514', null,
  'teacher: a request cannot add a student with 0 h that day either'
);
select lives_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values (pg_temp.lesson('2003-03-03'), '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"present"}]', 'A была, ошибся') $$,
  'teacher: asks to fix Monday 3 March back to present'
);

set local request.jwt.claims = '{"sub":"a8210000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.apply_correction_request((select id from public.attendance_correction_requests where lesson_id = pg_temp.lesson('2003-03-03'))),
  1,
  'admin applies the request'
);
select is(pg_temp.mark_a('2003-03-03'), 'present 2.0 t', 'Monday is charged again: 2 h on the March invoice');
select is(pg_temp.used_a(), 4.0, 'A used: Monday 2 h + Friday 2 h');
select is(public.afterschool_credit_hours(pg_temp.enr_a()), 1.0, 'credit: only Wednesday 1 h is left');
select is(pg_temp.pay(), '585 13.0', 'pay: A 4 h + B 9 h = 13 h → 585');

-- ─── After the credit is taken off the next invoice ─────────────────────────
select lives_ok(
  $$ select public.issue_afterschool_invoice(pg_temp.enr_a(), '2003-04-01') $$,
  'admin issues the April invoice'
);
select is(
  (select credit_hours from public.subscriptions where id = pg_temp.sub_a('2003-04-01')),
  1.0,
  'April takes the 1 h credit (Wednesday)'
);
select is(
  public.correct_attendance(pg_temp.lesson('2003-03-05'),
    '[{"student_id":"e8210000-0000-4000-8000-000000000001","status":"present"}]', 'всё-таки была'),
  1,
  'Wednesday 5 March: freeze → present after April was issued'
);
select is(
  public.afterschool_credit_hours(pg_temp.enr_a()),
  0.0,
  'the credit never goes negative: April is not re-billed, the hour is charged in March'
);

select * from finish();
rollback;
