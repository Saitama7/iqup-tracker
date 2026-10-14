-- #82 × #84 · заморозка заранее у продлёнки по часам (И63, 0025 attendance_presets_guard / confirm_lesson):
-- a day with 0 h by the student's plan takes no preset; a day with hours does, the freeze limit counts
-- per invoice; a plan changed to 0 h after the preset — confirm_lesson does not expect the student and
-- writes nothing for them. Self-contained fixtures in September 2099 (presets need future lessons),
-- rolled back.
--
-- September 2099: Tue 1, Wed 2, Thu 3, Fri 4, Mon 7, Tue 8, Wed 9, … A — ПН 2 / СР 1 / ПТ 2 (0 h on
-- Tuesday and Thursday); B — the default plan (3 h Mon–Fri).
begin;
select plan(9);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8230000-0000-4000-8000-000000000001', 'teacher823@test.local'),
  ('a8230000-0000-4000-8000-000000000003', 'admin823@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b8230000-0000-4000-8000-000000000001', 'Teacher 823', '996000008231');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8230000-0000-4000-8000-000000000001', '996000008231', 'Teacher 823', '{teacher}'),
  ('a8230000-0000-4000-8000-000000000003', '996000008233', 'Admin 823', '{admin}');
update public.teachers set user_id = 'a8230000-0000-4000-8000-000000000001'
where id = 'b8230000-0000-4000-8000-000000000001';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8230000-0000-4000-8000-000000000001', 45, '2099-01-01');

insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, hour_price) values
  ('afterschool', 20, 7400, 8, 180, 2, '2099-01-01', 100);

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d8230000-0000-4000-8000-000000000001', 'Продлёнка 823', (select id from public.subjects where name = 'Математика'), 3, 'afterschool', 'b8230000-0000-4000-8000-000000000001', '2099-09-01', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd8230000-0000-4000-8000-000000000001', d, '13:00', '2099-09-01' from generate_series(1, 5) d;
select public.generate_lessons('d8230000-0000-4000-8000-000000000001', '2099-09-30');

insert into public.students (id, full_name) values
  ('e8230000-0000-4000-8000-000000000001', 'A'),
  ('e8230000-0000-4000-8000-000000000002', 'B');

create function pg_temp.lesson(p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = 'd8230000-0000-4000-8000-000000000001' and lesson_date = p_date;
$$;
create function pg_temp.enr_a()
returns uuid language sql as $$
  select id from public.enrollments
  where student_id = 'e8230000-0000-4000-8000-000000000001' and group_id = 'd8230000-0000-4000-8000-000000000001';
$$;
grant execute on function pg_temp.lesson(date), pg_temp.enr_a() to authenticated;

-- ─── Admin enrolls and sets presets ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8230000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select * from public.enroll_student('e8230000-0000-4000-8000-000000000001', 'd8230000-0000-4000-8000-000000000001',
  '2099-09-01', 0, 'none', array[2, 0, 1, 0, 2, 0, 0]::numeric[]);
select * from public.enroll_student('e8230000-0000-4000-8000-000000000002', 'd8230000-0000-4000-8000-000000000001', '2099-09-01');

select throws_ok(
  $$ select public.set_attendance_preset(pg_temp.lesson('2099-09-08'), 'e8230000-0000-4000-8000-000000000001', 'болеет') $$,
  '23514', null,
  'A: Tuesday 8 Sep is 0 h by the plan — no preset'
);
select lives_ok(
  $$ select public.set_attendance_preset(pg_temp.lesson('2099-09-08'), 'e8230000-0000-4000-8000-000000000002', null) $$,
  'B: Tuesday 8 Sep (3 h) — preset set'
);
select lives_ok(
  $$ select public.set_attendance_preset(pg_temp.lesson('2099-09-07'), 'e8230000-0000-4000-8000-000000000001', null) $$,
  'A: Monday 7 Sep (2 h) — preset set'
);
select lives_ok(
  $$ select public.set_attendance_preset(pg_temp.lesson('2099-09-09'), 'e8230000-0000-4000-8000-000000000001', null) $$,
  'A: Wednesday 9 Sep (1 h) — second preset on the September invoice'
);
select throws_ok(
  $$ select public.set_attendance_preset(pg_temp.lesson('2099-09-11'), 'e8230000-0000-4000-8000-000000000001', null) $$,
  '23514', null,
  'A: Friday 11 Sep — the freeze limit 2 of the September invoice'
);

-- ─── The plan changes to 0 h on Monday after the preset ─────────────────────
select lives_ok(
  $$ select public.set_afterschool_plan(pg_temp.enr_a(), '2099-09-07', array[0, 0, 1, 0, 2, 0, 0]::numeric[]) $$,
  'admin: A from 7 Sep — no Mondays'
);
select is(
  (select count(*)::integer from public.attendance_presets
   where lesson_id = pg_temp.lesson('2099-09-07') and student_id = 'e8230000-0000-4000-8000-000000000001'),
  1,
  'the Monday preset stays'
);

select lives_ok(
  $$ select public.confirm_lesson(pg_temp.lesson('2099-09-07'),
       '[{"student_id":"e8230000-0000-4000-8000-000000000002","status":"present"}]') $$,
  'confirm Monday 7 Sep with B only'
);
select is(
  (select string_agg(concat_ws(' ', s.full_name, a.status, a.hours), ', ' order by s.full_name)
   from public.attendance a join public.students s on s.id = a.student_id
   where a.lesson_id = pg_temp.lesson('2099-09-07')),
  'B present 3.0',
  'A (0 h now) gets no mark from the stale preset'
);

select * from finish();
rollback;
