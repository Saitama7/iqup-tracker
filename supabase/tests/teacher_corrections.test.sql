-- Issue #110 (К10): the teacher corrects the marks of own held lesson in an open period
-- (teacher_correct_attendance, 0034). Self-contained fixtures in September 2004, rolled back.
begin;
select plan(26);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1100000-0000-4000-8000-000000000001', 'admin110@test.local'),
  ('a1100000-0000-4000-8000-000000000002', 'teacher110a@test.local'),
  ('a1100000-0000-4000-8000-000000000003', 'teacher110b@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b1100000-0000-4000-8000-000000000001', null, 'Teacher 110 A', '996000011001'),
  ('b1100000-0000-4000-8000-000000000002', null, 'Teacher 110 B', '996000011002');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1100000-0000-4000-8000-000000000001', '996000011000', 'Admin 110', '{admin}'),
  ('a1100000-0000-4000-8000-000000000002', '996000011001', 'Teacher 110 A', '{teacher}'),
  ('a1100000-0000-4000-8000-000000000003', '996000011002', 'Teacher 110 B', '{teacher}');
update public.teachers set user_id = 'a1100000-0000-4000-8000-000000000002' where id = 'b1100000-0000-4000-8000-000000000001';
update public.teachers set user_id = 'a1100000-0000-4000-8000-000000000003' where id = 'b1100000-0000-4000-8000-000000000002';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b1100000-0000-4000-8000-000000000001', 50, '1999-01-01'),
  ('b1100000-0000-4000-8000-000000000002', 40, '1999-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('mini', 12, 3600, 4, 60, 2, '1991-01-01');

-- G1 (teacher A), ВТ/ЧТ 09:00 from Thu 2 Sep 2004
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
values ('d1100000-0000-4000-8000-000000000001', 'S110 G1', (select id from public.subjects where name = 'Математика'),
        9, 'mini', 'b1100000-0000-4000-8000-000000000001', '2004-09-02', 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd1100000-0000-4000-8000-000000000001', w, '09:00', '2004-09-02' from unnest(array[2, 4]) w;
select public.generate_lessons('d1100000-0000-4000-8000-000000000001', '2004-09-30');

create temp table l110 as
select l.id, l.lesson_date from public.lessons l where l.group_id = 'd1100000-0000-4000-8000-000000000001';
grant all on l110 to authenticated;

insert into public.students (id, full_name) values
  ('e1100000-0000-4000-8000-000000000001', 'Student 110 one'),
  ('e1100000-0000-4000-8000-000000000002', 'Student 110 two'),
  ('e1100000-0000-4000-8000-000000000003', 'Student 110 late');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f1100000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', '2004-09-02'),
  ('f1100000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000002', 'd1100000-0000-4000-8000-000000000001', '2004-09-02'),
  ('f1100000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000003', 'd1100000-0000-4000-8000-000000000001', '2004-09-02');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('c11000000000400080000000000000' || right(e.id::text, 2))::uuid, e.id,
       (select id from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'),
       12, 3600, 3600, e.start_date
from public.enrollments e where e.id::text like 'f1100000-%';

-- 7, 9 Sep held, students one and two present (three — enrolled, unmarked, #107); 14 Sep held and closed
update public.lessons set status = 'held'
where id in (select id from l110 where lesson_date in ('2004-09-07', '2004-09-09', '2004-09-14'));
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, s.student_id, ('c11000000000400080000000000000' || right(s.enrollment_id::text, 2))::uuid, 'present'
from l110 l
cross join (values
  ('e1100000-0000-4000-8000-000000000001'::uuid, 'f1100000-0000-4000-8000-000000000001'::uuid),
  ('e1100000-0000-4000-8000-000000000002'::uuid, 'f1100000-0000-4000-8000-000000000002'::uuid)
) as s(student_id, enrollment_id)
where l.lesson_date in ('2004-09-07', '2004-09-09', '2004-09-14');
update public.lessons set is_locked = true where id in (select id from l110 where lesson_date = '2004-09-14');

create temp view pay110 as
select base_amount from public.v_payroll_preview
where teacher_id = 'b1100000-0000-4000-8000-000000000001' and month = '2004-09-01';
grant select on pay110 to authenticated;
create temp view mark110 as
select l.lesson_date, a.student_id, a.status::text, a.marked_by
from public.attendance a join l110 l on l.id = a.lesson_id;
grant select on mark110 to authenticated;
create temp view log110 as
select a.reason, a.actor_id, a.before ->> 'status' as was, a.after ->> 'status' as now
from public.audit_log a
where a.entity = 'attendance' and a.after ->> 'lesson_id' in (select id::text from l110)
  and a.reason like 'Исправил учитель%';
grant select on log110 to authenticated;
-- 3 lessons × 2 students × 3600 / 12 × 50 %
select is((select base_amount from pay110), 900, 'fixture: teacher A earns 900 in September 2004');

-- ─── Teacher B: not own lesson ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"absent_frozen"}]', null) $$,
  '42501', null, 'another teacher: refused'
);

-- ─── Teacher A: own lesson ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a1100000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ update public.attendance set status = 'absent_burned'
     where lesson_id = (select id from l110 where lesson_date = '2004-09-09')
       and student_id = 'e1100000-0000-4000-8000-000000000001' $$,
  '42501', null, 'teacher: still no direct change of a held lesson''s mark'
);
select is(
  public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
    '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"absent_frozen"},
      {"student_id":"e1100000-0000-4000-8000-000000000002","status":"present"}]', null),
  1, 'teacher: Был → Заморозка, the unchanged mark is skipped'
);
select results_eq(
  $$ select status, marked_by from mark110
     where lesson_date = '2004-09-09' and student_id = 'e1100000-0000-4000-8000-000000000001' $$,
  $$ values ('absent_frozen'::text, 'a1100000-0000-4000-8000-000000000002'::uuid) $$,
  'mark: frozen, marked by the teacher'
);
select is((select base_amount from pay110), 750, 'payroll: −150 for the frozen lesson');
select results_eq(
  $$ select reason, actor_id, was, now from log110 $$,
  $$ values ('Исправил учитель'::text, 'a1100000-0000-4000-8000-000000000002'::uuid, 'present'::text, 'absent_frozen'::text) $$,
  'journal: one row, author — the teacher, reason «Исправил учитель»'
);
select is(
  public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
    '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'again'),
  0, 'teacher: a repeat is a no-op'
);
select is((select count(*)::integer from log110), 1, 'journal: a no-op writes nothing');

-- comment goes into the reason, trimmed; an unmarked enrolled student gets a mark (#107)
select is(
  public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-07'),
    '[{"student_id":"e1100000-0000-4000-8000-000000000003","status":"present"}]', '  Был, забыла отметить '),
  1, 'teacher: marks an unmarked enrolled student'
);
select results_eq(
  $$ select status from mark110
     where lesson_date = '2004-09-07' and student_id = 'e1100000-0000-4000-8000-000000000003' $$,
  $$ values ('present'::text) $$,
  'mark: inserted'
);
select is(
  (select subscription_id from public.attendance
   where lesson_id = (select id from l110 where lesson_date = '2004-09-07')
     and student_id = 'e1100000-0000-4000-8000-000000000003'),
  'c1100000-0000-4000-8000-000000000003'::uuid, 'mark: subscription picked like in confirm_lesson'
);
select is(
  (select reason from log110 where now = 'present' and was is null),
  'Исправил учитель: Был, забыла отметить', 'journal: «Исправил учитель: комментарий»'
);
select is((select base_amount from pay110), 900, 'payroll: +150 for the added mark');

-- refusals
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-14'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"absent_frozen"}]', null) $$,
  '23514', null, 'teacher: closed period refused'
);
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-16'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"present"}]', null) $$,
  '23514', null, 'teacher: a planned lesson is not corrected (it is marked as usual)'
);
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"present"}]', repeat('x', 501)) $$,
  '23514', null, 'teacher: comment over 500 refused'
);
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[]', null) $$,
  '23514', null, 'teacher: empty marks refused'
);
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000099","status":"present"}]', null) $$,
  '23514', null, 'teacher: a student outside the group refused'
);
select throws_ok(
  $$ select public.correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"present"}]', 'x') $$,
  '42501', null, 'teacher: correct_attendance is still admin-only'
);
-- the flag does not leak out of the RPC
select throws_ok(
  $$ update public.attendance set status = 'present'
     where lesson_id = (select id from l110 where lesson_date = '2004-09-09')
       and student_id = 'e1100000-0000-4000-8000-000000000001' $$,
  '42501', null, 'teacher: after the RPC a direct change is refused again'
);
select is(coalesce(current_setting('iqup.teacher_correct', true), ''), '', 'flag cleared after the RPC');

-- ─── Admin: refused, uses correct_attendance ────────────────────────────────
set local request.jwt.claims = '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"present"}]', null) $$,
  '42501', null, 'admin: teacher_correct_attendance refused'
);
select is(
  public.correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
    '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"present"}]', 'back'),
  1, 'admin: correct_attendance works as before'
);

-- ─── Anonymous ──────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok(
  $$ select public.teacher_correct_attendance((select id from l110 where lesson_date = '2004-09-09'),
       '[{"student_id":"e1100000-0000-4000-8000-000000000001","status":"present"}]', null) $$,
  '42501', null, 'anon: no execute'
);
reset role;
select is((select base_amount from pay110), 1050, 'payroll: 900 + 150 after the admin''s fix');

select * from finish();
rollback;
