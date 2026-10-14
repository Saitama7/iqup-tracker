-- Issue #84: the admin sets «Заморозка» before the lesson (attendance_presets), the lesson's teacher
-- sees it, confirm_lesson takes it as the default mark, the freeze limit counts it; «Не был» goes into
-- the payroll, «Заморозка» does not (0099).
-- Self-contained fixtures in September 2099 (lessons must be today or later), rolled back.
begin;
select plan(45);

-- ─── Seed payroll is untouched ──────────────────────────────────────────────
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

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8400000-0000-4000-8000-000000000001', 'admin84@test.local'),
  ('a8400000-0000-4000-8000-000000000002', 'teacher84a@test.local'),
  ('a8400000-0000-4000-8000-000000000003', 'teacher84b@test.local'),
  ('a8400000-0000-4000-8000-000000000004', 'admin84b@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b8400000-0000-4000-8000-000000000001', null, 'Teacher 84 A', '996000008401'),
  ('b8400000-0000-4000-8000-000000000002', null, 'Teacher 84 B', '996000008402');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8400000-0000-4000-8000-000000000001', '996000008400', 'Admin 84', '{admin}'),
  ('a8400000-0000-4000-8000-000000000002', '996000008401', 'Teacher 84 A', '{teacher}'),
  ('a8400000-0000-4000-8000-000000000003', '996000008402', 'Teacher 84 B', '{teacher}'),
  ('a8400000-0000-4000-8000-000000000004', '996000008403', 'Admin 84 B', '{admin}');
update public.teachers set user_id = 'a8400000-0000-4000-8000-000000000002' where id = 'b8400000-0000-4000-8000-000000000001';
update public.teachers set user_id = 'a8400000-0000-4000-8000-000000000003' where id = 'b8400000-0000-4000-8000-000000000002';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b8400000-0000-4000-8000-000000000001', 50, '1999-01-01'),
  ('b8400000-0000-4000-8000-000000000002', 40, '1999-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('mini', 12, 3600, 4, 60, 2, '1991-01-01');

-- G1 (teacher A) and G2 (teacher B), ВТ/ЧТ 09:00 from 1 Sep 2099
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select g.id::uuid, g.name, (select id from public.subjects where name = 'Математика'), 9, 'mini',
       g.teacher::uuid, '2099-09-01', 'active'
from (values
  ('d8400000-0000-4000-8000-000000000001', 'S84 G1', 'b8400000-0000-4000-8000-000000000001'),
  ('d8400000-0000-4000-8000-000000000002', 'S84 G2', 'b8400000-0000-4000-8000-000000000002')
) as g(id, name, teacher);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, w, '09:00', g.start_date
from public.groups g cross join unnest(array[2, 4]) w
where g.name like 'S84 %';
select public.generate_lessons(g.id, '2099-09-30') from public.groups g where g.name like 'S84 %';

-- n = 1, 2, … in date order per group
create temp table l84 as
select l.id, g.name as grp, l.lesson_date,
       row_number() over (partition by g.name order by l.lesson_date)::integer as n
from public.lessons l join public.groups g on g.id = l.group_id
where g.name like 'S84 %';
grant all on l84 to authenticated;

insert into public.students (id, full_name) values
  ('e8400000-0000-4000-8000-000000000001', 'Student 84 one'),
  ('e8400000-0000-4000-8000-000000000002', 'Student 84 two'),
  ('e8400000-0000-4000-8000-000000000003', 'Student 84 outsider');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f8400000-0000-4000-8000-000000000001', 'e8400000-0000-4000-8000-000000000001', 'd8400000-0000-4000-8000-000000000001', '2099-09-01'),
  ('f8400000-0000-4000-8000-000000000002', 'e8400000-0000-4000-8000-000000000002', 'd8400000-0000-4000-8000-000000000001', '2099-09-01'),
  ('f8400000-0000-4000-8000-000000000003', 'e8400000-0000-4000-8000-000000000003', 'd8400000-0000-4000-8000-000000000002', '2099-09-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('c84000000000400080000000000000' || right(e.id::text, 2))::uuid, e.id,
       (select id from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'),
       12, 3600, 3600, e.start_date
from public.enrollments e where e.id::text like 'f8400000-%';

-- G1 lesson 8 is moved into the past (still planned) — no preset there
update public.lessons set lesson_date = '2004-09-02' where id = (select id from l84 where grp = 'S84 G1' and n = 8);

-- ─── Teacher: no presets ────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 1),
       'e8400000-0000-4000-8000-000000000001', 'warned') $$,
  '42501', null, 'teacher: set_attendance_preset refused'
);
select throws_ok(
  $$ insert into public.attendance_presets (lesson_id, student_id)
     values ((select id from l84 where grp = 'S84 G1' and n = 1), 'e8400000-0000-4000-8000-000000000001') $$,
  '42501', null, 'teacher: no direct insert'
);

-- ─── Anon ───────────────────────────────────────────────────────────────────
reset request.jwt.claims;
set local role anon;
select throws_ok(
  $$ select public.set_attendance_preset(gen_random_uuid(), gen_random_uuid(), null) $$,
  '42501', null, 'anon: set_attendance_preset not granted'
);
select throws_ok(
  $$ select count(*) from public.attendance_presets $$,
  '42501', null, 'anon: no access to presets'
);

-- ─── Admin: set ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 1),
       'e8400000-0000-4000-8000-000000000001', '  мама написала в WhatsApp ') $$,
  'admin: «предупредил» for a future lesson'
);
select results_eq(
  $$ select status::text, comment, created_by from public.attendance_presets $$,
  $$ values ('absent_frozen'::text, 'мама написала в WhatsApp'::text, 'a8400000-0000-4000-8000-000000000001'::uuid) $$,
  'preset: «Заморозка», comment trimmed, author from the database'
);
select is(
  public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 1),
    'e8400000-0000-4000-8000-000000000001', 'заболел'),
  (select id from public.attendance_presets),
  'admin: a repeat keeps one preset'
);
select is((select comment from public.attendance_presets), 'заболел', 'admin: a repeat replaces the comment');
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G2' and n = 1),
       'e8400000-0000-4000-8000-000000000003', null) $$,
  'admin: a preset without a comment'
);

select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 8),
       'e8400000-0000-4000-8000-000000000001', null) $$,
  '23514', null, 'admin: not for a past lesson'
);
select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 2),
       'e8400000-0000-4000-8000-000000000003', null) $$,
  '23514', null, 'admin: only a student of the group'
);
select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 2),
       'e8400000-0000-4000-8000-000000000001', repeat('x', 501)) $$,
  '23514', null, 'admin: comment up to 500 characters'
);

-- ─── Freeze limit (2 per subscription) counts presets ───────────────────────
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 2),
       'e8400000-0000-4000-8000-000000000001', null) $$,
  'limit: the second freeze fits'
);
select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 3),
       'e8400000-0000-4000-8000-000000000001', null) $$,
  '23514', 'freeze limit (2) exceeded for subscription c8400000-0000-4000-8000-000000000001',
  'limit: the third preset is refused'
);
select is(
  public.clear_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 2), 'e8400000-0000-4000-8000-000000000001'),
  true, 'admin: «Снять» removes a preset'
);
select is(
  public.clear_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 2), 'e8400000-0000-4000-8000-000000000001'),
  false, 'admin: «Снять» again is a no-op'
);
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 3),
       'e8400000-0000-4000-8000-000000000001', null) $$,
  'limit: freed after «Снять»'
);

-- ─── Teacher: reads presets of own lessons only ─────────────────────────────
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select l.n, p.comment from public.attendance_presets p join l84 l on l.id = p.lesson_id order by l.n $$,
  $$ values (1, 'заболел'::text), (3, null::text) $$,
  'teacher A: sees the presets of own lessons'
);
select throws_ok(
  $$ select public.clear_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 1), 'e8400000-0000-4000-8000-000000000001') $$,
  '42501', null, 'teacher: «Снять» refused'
);
select is(
  (select count(*)::integer from public.attendance_presets
   where lesson_id = (select id from l84 where grp = 'S84 G1' and n = 1)),
  1, 'teacher: a direct delete removes nothing'
);
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select student_id from public.attendance_presets $$,
  $$ values ('e8400000-0000-4000-8000-000000000003'::uuid) $$,
  'teacher B: sees only the preset of own lesson'
);

-- ─── confirm_lesson takes the preset as the default ─────────────────────────
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select public.confirm_lesson((select id from l84 where grp = 'S84 G1' and n = 1),
       '[{"student_id":"e8400000-0000-4000-8000-000000000002","status":"absent_burned"}]') $$,
  'confirm: the student with a preset may be left out of the marks'
);
select results_eq(
  $$ select student_id, status::text, subscription_id from public.attendance
     where lesson_id = (select id from l84 where grp = 'S84 G1' and n = 1) order by student_id $$,
  $$ values ('e8400000-0000-4000-8000-000000000001'::uuid, 'absent_frozen'::text, 'c8400000-0000-4000-8000-000000000001'::uuid),
            ('e8400000-0000-4000-8000-000000000002'::uuid, 'absent_burned'::text, 'c8400000-0000-4000-8000-000000000002'::uuid) $$,
  'confirm: preset → «Заморозка» on the subscription, «Не был» as marked'
);
select lives_ok(
  $$ select public.confirm_lesson((select id from l84 where grp = 'S84 G1' and n = 3),
       '[{"student_id":"e8400000-0000-4000-8000-000000000001","status":"present"},
         {"student_id":"e8400000-0000-4000-8000-000000000002","status":"present"}]') $$,
  'confirm: the student came after all'
);
select is(
  (select status::text from public.attendance
   where lesson_id = (select id from l84 where grp = 'S84 G1' and n = 3) and student_id = 'e8400000-0000-4000-8000-000000000001'),
  'present', 'confirm: an explicit mark wins over the preset'
);
select throws_ok(
  $$ select public.confirm_lesson((select id from l84 where grp = 'S84 G1' and n = 4),
       '[{"student_id":"e8400000-0000-4000-8000-000000000002","status":"present"}]') $$,
  '23514', null, 'confirm: without a preset every student is still required'
);
select throws_ok(
  $$ select public.clear_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 1), 'e8400000-0000-4000-8000-000000000001') $$,
  '23514', null, 'held lesson: the preset stays'
);

-- ─── Payroll: «Не был» counts, «Заморозка» does not ─────────────────────────
-- lesson 1: frozen + burned = 1, lesson 3: 2 present = 2 → 3 × 3600 / 12 × 50 %
select is(
  (select base_amount::integer from public.v_payroll_preview
   where teacher_id = 'b8400000-0000-4000-8000-000000000001' and month = '2099-09-01'),
  450, 'payroll: «Не был» is paid, «Заморозка» is not'
);

-- ─── Journal ────────────────────────────────────────────────────────────────
select is(
  (select count(*)::integer from public.audit_log where entity = 'attendance_presets'),
  6, 'audit: every set / re-comment / remove is logged'
);
select ok(
  (select bool_and(search like '%student 84%') from public.v_audit_feed where entity = 'attendance_presets'),
  'audit: presets are found by the student''s name'
);

-- ─── Author stays on a re-comment by another admin ──────────────────────────
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 5),
       'e8400000-0000-4000-8000-000000000002', 'первый') $$,
  'admin A: preset on lesson 5'
);
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 5),
       'e8400000-0000-4000-8000-000000000002', 'второй') $$,
  'admin B: re-comments it'
);
select results_eq(
  $$ select comment, created_by from public.attendance_presets
     where lesson_id = (select id from l84 where grp = 'S84 G1' and n = 5) $$,
  $$ values ('второй'::text, 'a8400000-0000-4000-8000-000000000001'::uuid) $$,
  're-comment: the new comment, created_by stays the first admin'
);

-- ─── A cancelled lesson: the preset can be removed ──────────────────────────
reset role;
update public.lessons set status = 'cancelled', cancel_reason = 'center'
where id = (select id from l84 where grp = 'S84 G1' and n = 5);
-- lesson 7 is today and has started (00:00 Bishkek) — not «in advance» anymore
update public.lessons set lesson_date = public.bishkek_today(), planned_start = '00:00'
where id = (select id from l84 where grp = 'S84 G1' and n = 7);
-- G2 lesson 2 is paid to teacher A (lessons.teacher_id), the group is still teacher B's
update public.lessons set teacher_id = 'b8400000-0000-4000-8000-000000000001'
where id = (select id from l84 where grp = 'S84 G2' and n = 2);
set local role authenticated;
select is(
  public.clear_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 5), 'e8400000-0000-4000-8000-000000000002'),
  true, 'cancelled lesson: «Снять» removes the preset'
);

-- ─── A closed period: neither set nor remove ────────────────────────────────
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 6),
       'e8400000-0000-4000-8000-000000000002', null) $$,
  'admin: preset on lesson 6'
);
reset role;
update public.lessons set is_locked = true where id = (select id from l84 where grp = 'S84 G1' and n = 6);
set local role authenticated;
select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 6),
       'e8400000-0000-4000-8000-000000000002', 'поздно') $$,
  '23514', null, 'locked lesson: the preset cannot be changed'
);
select throws_ok(
  $$ select public.clear_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 6), 'e8400000-0000-4000-8000-000000000002') $$,
  '23514', null, 'locked lesson: the preset cannot be removed'
);

-- ─── After the planned start it is not «in advance» ─────────────────────────
select throws_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G1' and n = 7),
       'e8400000-0000-4000-8000-000000000002', null) $$,
  '23514', null, 'started lesson: no preset'
);

-- ─── The lesson's teacher is lessons.teacher_id, not the group's ────────────
select lives_ok(
  $$ select public.set_attendance_preset((select id from l84 where grp = 'S84 G2' and n = 2),
       'e8400000-0000-4000-8000-000000000003', 'на даче') $$,
  'admin: preset on G2 lesson 2'
);
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select p.comment from public.attendance_presets p join l84 l on l.id = p.lesson_id
     where l.grp = 'S84 G2' $$,
  $$ values ('на даче'::text) $$,
  'teacher A: sees the preset of the G2 lesson paid to them'
);
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select l.n from public.attendance_presets p join l84 l on l.id = p.lesson_id $$,
  $$ values (1) $$,
  'teacher B: leads G2 but does not see the preset of a lesson that is not theirs'
);

-- ─── A deleted lesson takes its presets along (FK cascade) ──────────────────
reset role;
reset request.jwt.claims;
delete from public.attendance where lesson_id = (select id from l84 where grp = 'S84 G1' and n = 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select lives_ok(
  $$ delete from public.lessons where id = (select id from l84 where grp = 'S84 G1' and n = 1) $$,
  'cascade: the admin deletes a held lesson with a preset'
);
select is(
  (select count(*)::integer from public.attendance_presets
   where lesson_id = (select id from l84 where grp = 'S84 G1' and n = 1)),
  0, 'cascade: the preset went along'
);

select * from finish();
rollback;
