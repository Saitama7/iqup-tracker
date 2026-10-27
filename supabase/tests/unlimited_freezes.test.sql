-- Issue #108 (К9): no freeze limit — tariffs.freeze_limit is null, any number of «Заморозка» per
-- subscription through confirm_lesson, correct_attendance and the admin's presets (0032).
-- Self-contained fixtures: held lessons in September 2004, planned ones in September 2099; rolled back.
begin;
select plan(14);

-- ─── Schema and seed ────────────────────────────────────────────────────────
select col_is_null('public', 'tariffs', 'freeze_limit', 'tariffs.freeze_limit is nullable');
select is(
  (select count(*)::integer from public.tariffs where freeze_limit is not null), 0,
  'seed: every tariff version has no freeze limit'
);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1080000-0000-4000-8000-000000000001', 'admin108@test.local'),
  ('a1080000-0000-4000-8000-000000000002', 'teacher108@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b1080000-0000-4000-8000-000000000001', null, 'Teacher 108', '996000010801');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1080000-0000-4000-8000-000000000001', '996000010800', 'Admin 108', '{admin}'),
  ('a1080000-0000-4000-8000-000000000002', '996000010801', 'Teacher 108', '{teacher}');
update public.teachers set user_id = 'a1080000-0000-4000-8000-000000000002' where id = 'b1080000-0000-4000-8000-000000000001';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b1080000-0000-4000-8000-000000000001', 50, '1999-01-01');
-- a new version with no freeze_limit given — no limit by default
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from) values
  ('mini', 12, 3600, 4, 60, '1991-01-01');
select is(
  (select freeze_limit from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'), null,
  'a new tariff version has no freeze limit by default'
);

-- G1 in the past (held / planned lessons to confirm), G2 in 2099 (presets); ВТ/ЧТ 09:00
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select g.id::uuid, g.name, (select id from public.subjects where name = 'Математика'), 9, 'mini',
       'b1080000-0000-4000-8000-000000000001', g.start::date, 'active'
from (values
  ('d1080000-0000-4000-8000-000000000001', 'S108 G1', '2004-09-02'),
  ('d1080000-0000-4000-8000-000000000002', 'S108 G2', '2099-09-01')
) as g(id, name, start);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, w, '09:00', g.start_date
from public.groups g cross join unnest(array[2, 4]) w
where g.name like 'S108 %';
select public.generate_lessons('d1080000-0000-4000-8000-000000000001', '2004-09-30');
select public.generate_lessons('d1080000-0000-4000-8000-000000000002', '2099-09-30');

create temp table l108 as
select l.id, g.name as grp, l.lesson_date,
       row_number() over (partition by g.name order by l.lesson_date)::integer as n
from public.lessons l join public.groups g on g.id = l.group_id
where g.name like 'S108 %';
grant all on l108 to authenticated;

insert into public.students (id, full_name) values
  ('e1080000-0000-4000-8000-000000000001', 'Student 108 one'),
  ('e1080000-0000-4000-8000-000000000002', 'Student 108 two');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f1080000-0000-4000-8000-000000000001', 'e1080000-0000-4000-8000-000000000001', 'd1080000-0000-4000-8000-000000000001', '2004-09-02'),
  ('f1080000-0000-4000-8000-000000000002', 'e1080000-0000-4000-8000-000000000002', 'd1080000-0000-4000-8000-000000000002', '2099-09-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('c10800000000400080000000000000' || right(e.id::text, 2))::uuid, e.id,
       (select id from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'),
       12, 3600, 3600, e.start_date
from public.enrollments e where e.id::text like 'f1080000-%';

-- ─── Teacher: three freezes in a row through confirm_lesson ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1080000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select lives_ok(
  $$ select public.confirm_lesson((select id from l108 where grp = 'S108 G1' and n = 1),
       '[{"student_id":"e1080000-0000-4000-8000-000000000001","status":"absent_frozen"}]') $$,
  'teacher: first freeze'
);
select lives_ok(
  $$ select public.confirm_lesson((select id from l108 where grp = 'S108 G1' and n = 2),
       '[{"student_id":"e1080000-0000-4000-8000-000000000001","status":"absent_frozen"}]') $$,
  'teacher: second freeze'
);
select lives_ok(
  $$ select public.confirm_lesson((select id from l108 where grp = 'S108 G1' and n = 3),
       '[{"student_id":"e1080000-0000-4000-8000-000000000001","status":"absent_frozen"}]') $$,
  'teacher: third freeze on the same subscription — no limit (К9)'
);
select is(
  (select freezes_used from public.v_student_balance where subscription_id = 'c1080000-0000-4000-8000-000000000001'),
  3, 'balance: 3 freezes used'
);
select is(
  (select freeze_limit from public.v_student_balance where subscription_id = 'c1080000-0000-4000-8000-000000000001'),
  null, 'balance: no freeze limit'
);
select is(
  (select lessons_left from public.v_student_balance where subscription_id = 'c1080000-0000-4000-8000-000000000001'),
  12::numeric, 'balance: frozen lessons are not consumed'
);

-- ─── Admin: the 4th and 5th freeze through correct_attendance ───────────────
select public.confirm_lesson((select id from l108 where grp = 'S108 G1' and n = n2), '[{"student_id":"e1080000-0000-4000-8000-000000000001","status":"present"}]')
from (values (4), (5)) as v(n2);
set local request.jwt.claims = '{"sub":"a1080000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select public.correct_attendance((select id from l108 where grp = 'S108 G1' and n = 4),
       '[{"student_id":"e1080000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'предупредил') $$,
  'admin: a fourth freeze through correct_attendance'
);
select lives_ok(
  $$ select public.correct_attendance((select id from l108 where grp = 'S108 G1' and n = 5),
       '[{"student_id":"e1080000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'болел') $$,
  'admin: a fifth one'
);

-- ─── Admin: three presets on one subscription ───────────────────────────────
select lives_ok(
  $$ select public.set_attendance_preset(id, 'e1080000-0000-4000-8000-000000000002', null)
     from l108 where grp = 'S108 G2' and n in (1, 2) $$,
  'admin: two freezes in advance'
);
select lives_ok(
  $$ select public.set_attendance_preset((select id from l108 where grp = 'S108 G2' and n = 3),
       'e1080000-0000-4000-8000-000000000002', null) $$,
  'admin: the third freeze in advance on the same subscription'
);
select is(
  (select count(*)::integer from public.attendance_presets where student_id = 'e1080000-0000-4000-8000-000000000002'),
  3, 'presets: 3 saved'
);

select * from finish();
rollback;
