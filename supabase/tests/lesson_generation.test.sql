-- Issue #9: generate_lessons / ensure_lessons, create_group, reschedule_group, cancel_lesson,
-- create_extra_lesson, archive_group (0008). Self-contained fixtures, rolled back.
begin;
select plan(49);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: a…1 admin, a…2 teacher A (group G1), a…3 teacher B
insert into auth.users (id, email) values
  ('a9000000-0000-4000-8000-000000000001', 'admin9@test.local'),
  ('a9000000-0000-4000-8000-000000000002', 'teacher9a@test.local'),
  ('a9000000-0000-4000-8000-000000000003', 'teacher9b@test.local');

insert into public.teachers (id, user_id, full_name, phone) values
  ('b9000000-0000-4000-8000-000000000001', null, 'Teacher A', '996000000901'),
  ('b9000000-0000-4000-8000-000000000002', null, 'Teacher B', '996000000902');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9000000-0000-4000-8000-000000000001', '996000000900', 'Admin', '{admin}'),
  ('a9000000-0000-4000-8000-000000000002', '996000000901', 'Teacher A', '{teacher}'),
  ('a9000000-0000-4000-8000-000000000003', '996000000902', 'Teacher B', '{teacher}');
update public.teachers set user_id = 'a9000000-0000-4000-8000-000000000002' where id = 'b9000000-0000-4000-8000-000000000001';
update public.teachers set user_id = 'a9000000-0000-4000-8000-000000000003' where id = 'b9000000-0000-4000-8000-000000000002';

-- Test tariffs from 1990 (seed ones start later); 'individual' lessons become 90 min from 2001-10-01
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('mini', 12, 3200, 4, 60, 2, '1990-01-01'),
  ('group', 12, 3000, 10, 60, 2, '1990-01-01'),
  ('individual', 12, 6000, 1, 60, 2, '1990-01-01'),
  ('individual', 12, 6000, 1, 90, 2, '2001-10-01');

-- Two holidays on lesson days (Thu 1 Oct, Sat 12 Sep 2026); the seed may already have them
insert into public.holidays (day, name) values
  ('2026-10-01', 'Test holiday'),
  ('2026-09-12', 'Test holiday')
on conflict (day) do nothing;

-- G1: ВТ/ЧТ/СБ 09:00, 1 Sep – 31 Oct 2026 (teacher A). G2: individual, ПН 10:00, Sep–Oct 2001 (teacher B).
-- G3: archived. G4: forming, ПН 10:00 from 2001-09-03, no end.
insert into public.groups (id, name, subject, grade, group_type, teacher_id, start_date, end_date, status) values
  ('d9000000-0000-4000-8000-000000000001', 'G1', 'Математика', 8, 'mini', 'b9000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-31', 'active'),
  ('d9000000-0000-4000-8000-000000000002', 'G2', 'Химия', 9, 'individual', 'b9000000-0000-4000-8000-000000000002', '2001-09-01', '2001-10-31', 'active'),
  ('d9000000-0000-4000-8000-000000000003', 'G3', 'Химия', 9, 'mini', 'b9000000-0000-4000-8000-000000000002', '2001-09-01', null, 'archived'),
  ('d9000000-0000-4000-8000-000000000004', 'G4', 'Химия', 9, 'mini', 'b9000000-0000-4000-8000-000000000002', '2001-09-03', null, 'forming');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from) values
  ('d9000000-0000-4000-8000-000000000001', 2, '09:00', '2026-09-01'),
  ('d9000000-0000-4000-8000-000000000001', 4, '09:00', '2026-09-01'),
  ('d9000000-0000-4000-8000-000000000001', 6, '09:00', '2026-09-01'),
  ('d9000000-0000-4000-8000-000000000002', 1, '10:00', '2001-09-01'),
  ('d9000000-0000-4000-8000-000000000003', 1, '10:00', '2001-09-01'),
  ('d9000000-0000-4000-8000-000000000004', 1, '10:00', '2001-09-03');

create temp table r (key text primary key, id uuid, n integer);
grant all on r to authenticated;

-- ─── Teacher and anon: no access ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select throws_ok(
  $$ select public.generate_lessons('d9000000-0000-4000-8000-000000000001', '2026-12-31') $$,
  '42501', null, 'teacher cannot generate lessons, even for own group'
);
select throws_ok($$ select public.ensure_lessons('2026-12-31') $$, '42501', null, 'teacher cannot call ensure_lessons');
select throws_ok(
  $$ select * from public.create_group('X', 'Химия', 9, 'mini', 'b9000000-0000-4000-8000-000000000001', '{1}', '10:00', '2026-09-01', null, '2026-09-30') $$,
  '42501', null, 'teacher cannot create groups'
);

reset role;
set local role anon;
select throws_ok(
  $$ select public.generate_lessons('d9000000-0000-4000-8000-000000000001', '2026-12-31') $$,
  '42501', null, 'anon cannot call generate_lessons'
);

-- ─── generate_lessons (admin) ───────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- ВТ/ЧТ/СБ 1 Sep – 31 Oct 2026 = 27 slots (13 in Sep, 14 in Oct) minus holidays on those days
-- (the two test holidays → 25 with the dev seed, which has none in that range)
select is(
  public.generate_lessons('d9000000-0000-4000-8000-000000000001', '2026-12-31'),
  27 - (
    select count(*)::integer from public.holidays h
    where h.day between '2026-09-01' and '2026-10-31' and extract(isodow from h.day) in (2, 4, 6)
  ),
  'G1: 27 Tue/Thu/Sat slots minus holidays, capped at end_date'
);
select is(
  (select count(*)::integer from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000001'),
  25, 'G1: 25 lessons with the two test holidays'
);
select is(
  public.generate_lessons('d9000000-0000-4000-8000-000000000001', '2026-12-31'),
  0, 'second call creates nothing (idempotent)'
);
select is_empty(
  $$ select 1 from public.lessons l join public.holidays h on h.day = l.lesson_date
     where l.group_id = 'd9000000-0000-4000-8000-000000000001' $$,
  'no lesson on a holiday'
);
select results_eq(
  $$ select distinct planned_start, duration_min, status::text, is_extra
     from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000001' $$,
  $$ values ('09:00'::time, 60, 'planned', false) $$,
  'generated lessons: rule time, tariff duration, planned, regular'
);
select results_eq(
  $$ select min(lesson_date), max(lesson_date) from public.lessons
     where group_id = 'd9000000-0000-4000-8000-000000000001' $$,
  $$ values ('2026-09-01'::date, '2026-10-31'::date) $$,
  'within start_date / end_date'
);
select is(
  public.lesson_starts_at('2026-09-01', '09:00'),
  '2026-09-01 03:00:00+00'::timestamptz,
  '09:00 in Asia/Bishkek is 03:00 UTC'
);
select is(
  public.generate_lessons('d9000000-0000-4000-8000-000000000001', '2026-09-10'),
  0, 'a shorter horizon adds nothing'
);

-- duration from the tariff in effect on each lesson date
select is(public.generate_lessons('d9000000-0000-4000-8000-000000000002', '2001-12-31'), 9, 'G2: 9 Mondays Sep–Oct 2001');
select results_eq(
  $$ select to_char(lesson_date, 'MM'), min(duration_min), max(duration_min) from public.lessons
     where group_id = 'd9000000-0000-4000-8000-000000000002' group by 1 order by 1 $$,
  $$ values ('09', 60, 60), ('10', 90, 90) $$,
  'September lessons 60 min, October 90 min (tariff from 2001-10-01)'
);

select is(public.generate_lessons('d9000000-0000-4000-8000-000000000003', '2001-12-31'), 0, 'archived group: nothing generated');

-- ensure_lessons: forming and active groups (G4 forming: Mondays 3 Sep – 24 Sep 2001 = 4)
select is(public.ensure_lessons('2001-09-30'), 4 + 0, 'ensure_lessons: G4 (forming) gets 4, G2 already done, G3 skipped');
select is(public.ensure_lessons('2001-09-30'), 0, 'ensure_lessons again: 0');

-- ─── Teacher sees own lessons only ──────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is((select count(*)::integer from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000001'), 25, 'teacher A sees own group lessons');
select is((select count(*)::integer from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000002'), 0, 'teacher A does not see lessons of another group');
select throws_ok(
  $$ select public.cancel_lesson((select id from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000001' limit 1), 'teacher') $$,
  '42501', null, 'teacher cannot cancel a lesson'
);
select throws_ok(
  $$ update public.lessons set substitute_teacher_id = 'b9000000-0000-4000-8000-000000000002'
     where group_id = 'd9000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'teacher cannot set a substitute'
);

-- ─── cancel_lesson and the balance ──────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

insert into public.students (id, full_name) values ('e9000000-0000-4000-8000-000000000001', 'Student');
insert into r (key, id) select 'sub', subscription_id from public.enroll_student(
  'e9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', '2026-09-01');
insert into r (key, id) select 'l1', id from public.lessons
  where group_id = 'd9000000-0000-4000-8000-000000000001' and lesson_date = '2026-09-03';
insert into r (key, id) select 'l2', id from public.lessons
  where group_id = 'd9000000-0000-4000-8000-000000000001' and lesson_date = '2026-09-05';

-- attendance marked on a planned lesson that is then cancelled: the marks go, the lesson costs nothing
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select (select id from r where key = 'l1'), 'e9000000-0000-4000-8000-000000000001', (select id from r where key = 'sub'), 'present';
select is(
  (select lessons_used from public.v_subscription_balances where subscription_id = (select id from r where key = 'sub')),
  1, 'draft mark counts before the cancel'
);

select throws_ok(
  $$ select public.cancel_lesson((select id from r where key = 'l1'), 'holiday') $$,
  '23514', null, 'holiday is not a manual cancel reason'
);
select lives_ok(
  $$ select public.cancel_lesson((select id from r where key = 'l1'), 'teacher', 'Учитель заболел') $$,
  'admin cancels a planned lesson (teacher)'
);
select results_eq(
  $$ select status::text, cancel_reason::text, comment from public.lessons where id = (select id from r where key = 'l1') $$,
  $$ values ('cancelled', 'teacher', 'Учитель заболел') $$,
  'lesson is cancelled with the reason'
);
select is(
  (select lessons_used from public.v_subscription_balances where subscription_id = (select id from r where key = 'sub')),
  0, 'cancelled lesson consumes no credit'
);
select throws_ok(
  $$ insert into public.attendance (lesson_id, student_id, subscription_id, status)
     values ((select id from r where key = 'l1'), 'e9000000-0000-4000-8000-000000000001', (select id from r where key = 'sub'), 'present') $$,
  '23514', null, 'no attendance on a cancelled lesson, even by an admin'
);
select throws_ok(
  $$ select public.cancel_lesson((select id from r where key = 'l1'), 'center') $$,
  '23514', null, 'only a planned lesson can be cancelled'
);
select is(
  (select reason from public.audit_log where entity = 'lessons' and entity_id = (select id from r where key = 'l1') and action = 'update'),
  'Учитель заболел', 'audit log keeps the cancel comment'
);
select lives_ok(
  $$ select public.cancel_lesson((select id from r where key = 'l2'), 'all_frozen') $$,
  'whole group froze → all_frozen'
);

-- ─── create_extra_lesson ────────────────────────────────────────────────────
insert into r (key, id) select 'extra', public.create_extra_lesson(
  'd9000000-0000-4000-8000-000000000001', '2026-09-30', '15:00', (select id from r where key = 'l1'));
select results_eq(
  $$ select is_extra, makes_up_for_lesson_id, duration_min, status::text from public.lessons where id = (select id from r where key = 'extra') $$,
  $$ select true, (select id from r where key = 'l1'), 60, 'planned' $$,
  'extra lesson makes up the cancelled one'
);
select throws_ok(
  $$ select public.create_extra_lesson('d9000000-0000-4000-8000-000000000001', '2026-09-29', '15:00', (select id from r where key = 'l1')) $$,
  '23505', null, 'a cancelled lesson is made up once'
);
select throws_ok(
  $$ select public.create_extra_lesson('d9000000-0000-4000-8000-000000000001', '2026-09-29', '15:00',
       (select id from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000001' and lesson_date = '2026-09-08')) $$,
  '23514', null, 'only a cancelled lesson can be made up'
);
select lives_ok(
  $$ select public.create_extra_lesson('d9000000-0000-4000-8000-000000000001', '2026-09-28', '15:00') $$,
  'extra lesson without a link (frozen students make up, В3)'
);

-- substitute: informational, admin only
select lives_ok(
  $$ update public.lessons set substitute_teacher_id = 'b9000000-0000-4000-8000-000000000002'
     where id = (select id from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000001' and lesson_date = '2026-09-08') $$,
  'admin sets a substitute teacher'
);

-- ─── create_group ───────────────────────────────────────────────────────────
insert into r (key, id, n) select 'new', group_id, lessons_created from public.create_group(
  ' Химия · 7 класс ', 'Химия', 7, 'group', 'b9000000-0000-4000-8000-000000000001',
  '{1,3,5,5}', '16:00', public.bishkek_today(), '3', public.bishkek_today() + 13);
select is(
  (select n from r where key = 'new'),
  (select count(*)::integer from generate_series(public.bishkek_today()::timestamp, (public.bishkek_today() + 13)::timestamp, interval '1 day') d
   where extract(isodow from d) in (1, 3, 5) and not exists (select 1 from public.holidays h where h.day = d::date)),
  'create_group generates Mon/Wed/Fri lessons up to the horizon'
);
select results_eq(
  $$ select g.name, g.status::text, g.room, (select count(*)::integer from public.schedule_rules s where s.group_id = g.id)
     from public.groups g where g.id = (select id from r where key = 'new') $$,
  $$ values ('Химия · 7 класс', 'forming', '3', 3) $$,
  'group is forming, one rule per distinct weekday'
);
select throws_ok(
  $$ select * from public.create_group('X', 'Химия', 7, 'group', 'b9000000-0000-4000-8000-000000000001', '{}', '16:00', '2026-09-01', null, '2026-09-30') $$,
  '23514', null, 'at least one weekday'
);

-- ─── reschedule_group ───────────────────────────────────────────────────────
-- G5: ПН/СР/ПТ 10:00 from two weeks ago; generated four weeks ahead
insert into public.groups (id, name, subject, grade, group_type, teacher_id, start_date, status) values
  ('d9000000-0000-4000-8000-000000000005', 'G5', 'Химия', 9, 'mini', 'b9000000-0000-4000-8000-000000000002', public.bishkek_today() - 14, 'active');
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select 'd9000000-0000-4000-8000-000000000005', w, '10:00', public.bishkek_today() - 14 from unnest(array[1, 3, 5]) w;
select ok(public.generate_lessons('d9000000-0000-4000-8000-000000000005', public.bishkek_today() + 28) > 0, 'G5 generated');

insert into r (key, n) select 'past', count(*) from public.lessons
  where group_id = 'd9000000-0000-4000-8000-000000000005' and lesson_date < public.bishkek_today() + 7;
-- a future lesson cancelled before the change and an extra lesson — both must survive
insert into r (key, id) select 'g5c', id from public.lessons
  where group_id = 'd9000000-0000-4000-8000-000000000005' and lesson_date >= public.bishkek_today() + 7
  order by lesson_date limit 1;
select public.cancel_lesson((select id from r where key = 'g5c'), 'center');
insert into r (key, id) select 'g5x', public.create_extra_lesson(
  'd9000000-0000-4000-8000-000000000005', public.bishkek_today() + 20, '18:00');

select throws_ok(
  $$ select * from public.reschedule_group('d9000000-0000-4000-8000-000000000005', public.bishkek_today() - 1, '{2,4}', '15:00', public.bishkek_today() + 28) $$,
  '23514', null, 'a schedule change cannot start in the past'
);
select lives_ok(
  $$ select * from public.reschedule_group('d9000000-0000-4000-8000-000000000005', public.bishkek_today() + 7, '{2,4}', '15:00', public.bishkek_today() + 28) $$,
  'reschedule from next week to ВТ/ЧТ 15:00'
);
select results_eq(
  $$ select weekday, start_time, valid_from - public.bishkek_today(), valid_to - public.bishkek_today()
     from public.schedule_rules where group_id = 'd9000000-0000-4000-8000-000000000005' order by valid_from, weekday $$,
  $$ values (1, '10:00'::time, -14, 6), (3, '10:00'::time, -14, 6), (5, '10:00'::time, -14, 6),
            (2, '15:00'::time, 7, null::integer), (4, '15:00'::time, 7, null::integer) $$,
  'old rules closed the day before, new rules from valid_from'
);
select is(
  (select count(*)::integer from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000005' and lesson_date < public.bishkek_today() + 7),
  (select n from r where key = 'past'),
  'lessons before the change are untouched'
);
select is_empty(
  $$ select 1 from public.lessons
     where group_id = 'd9000000-0000-4000-8000-000000000005' and lesson_date >= public.bishkek_today() + 7
       and status = 'planned' and not is_extra
       and (planned_start <> '15:00' or extract(isodow from lesson_date) not in (2, 4)) $$,
  'no planned regular lesson by the old rule after the change'
);
select is(
  (select count(*)::integer from public.lessons where id in ((select id from r where key = 'g5c'), (select id from r where key = 'g5x'))),
  2, 'cancelled and extra lessons survive the change'
);
select is(
  (select count(*)::integer from public.lessons
   where group_id = 'd9000000-0000-4000-8000-000000000005' and lesson_date between public.bishkek_today() + 7 and public.bishkek_today() + 28
     and planned_start = '15:00'),
  (select count(*)::integer from generate_series((public.bishkek_today() + 7)::timestamp, (public.bishkek_today() + 28)::timestamp, interval '1 day') d
   where extract(isodow from d) in (2, 4) and not exists (select 1 from public.holidays h where h.day = d::date)),
  'new rule lessons generated up to the horizon'
);

-- ─── archive_group ──────────────────────────────────────────────────────────
select ok(public.archive_group('d9000000-0000-4000-8000-000000000005') > 0, 'archive removes future planned lessons');
select is_empty(
  $$ select 1 from public.lessons where group_id = 'd9000000-0000-4000-8000-000000000005'
     and status = 'planned' and public.lesson_starts_at(lesson_date, planned_start) > now() $$,
  'no future planned lessons in an archived group'
);
select is(
  (select status::text from public.lessons where id = (select id from r where key = 'g5c')),
  'cancelled', 'cancelled history stays after archiving'
);

select * from finish();
rollback;
