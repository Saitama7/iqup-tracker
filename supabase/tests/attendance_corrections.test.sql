-- Issue #74: an admin corrects the marks of a held lesson (correct_attendance), a teacher asks to
-- correct them (attendance_correction_requests), the admin applies / rejects (0021).
-- Self-contained fixtures in September 2004 (no seed holidays), rolled back.
begin;
select plan(56);

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
  ('a7400000-0000-4000-8000-000000000001', 'admin74@test.local'),
  ('a7400000-0000-4000-8000-000000000002', 'teacher74a@test.local'),
  ('a7400000-0000-4000-8000-000000000003', 'teacher74b@test.local');
insert into public.teachers (id, user_id, full_name, phone) values
  ('b7400000-0000-4000-8000-000000000001', null, 'Teacher 74 A', '996000007401'),
  ('b7400000-0000-4000-8000-000000000002', null, 'Teacher 74 B', '996000007402');
insert into public.profiles (id, phone, full_name, roles) values
  ('a7400000-0000-4000-8000-000000000001', '996000007400', 'Admin 74', '{admin}'),
  ('a7400000-0000-4000-8000-000000000002', '996000007401', 'Teacher 74 A', '{teacher}'),
  ('a7400000-0000-4000-8000-000000000003', '996000007402', 'Teacher 74 B', '{teacher}');
update public.teachers set user_id = 'a7400000-0000-4000-8000-000000000002' where id = 'b7400000-0000-4000-8000-000000000001';
update public.teachers set user_id = 'a7400000-0000-4000-8000-000000000003' where id = 'b7400000-0000-4000-8000-000000000002';
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b7400000-0000-4000-8000-000000000001', 50, '1999-01-01'),
  ('b7400000-0000-4000-8000-000000000002', 40, '1999-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('mini', 12, 3600, 4, 60, 2, '1991-01-01');

-- G1 (teacher A) and G2 (teacher B), ВТ/ЧТ 09:00 from Thu 2 Sep 2004
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select g.id::uuid, g.name, (select id from public.subjects where name = 'Математика'), 9, 'mini',
       g.teacher::uuid, '2004-09-02', 'active'
from (values
  ('d7400000-0000-4000-8000-000000000001', 'S74 G1', 'b7400000-0000-4000-8000-000000000001'),
  ('d7400000-0000-4000-8000-000000000002', 'S74 G2', 'b7400000-0000-4000-8000-000000000002')
) as g(id, name, teacher);
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, w, '09:00', g.start_date
from public.groups g cross join unnest(array[2, 4]) w
where g.name like 'S74 %';
select public.generate_lessons(g.id, '2004-09-30') from public.groups g where g.name like 'S74 %';

create temp table l74 as
select l.id, g.name as grp, l.lesson_date from public.lessons l join public.groups g on g.id = l.group_id
where g.name like 'S74 %';
grant all on l74 to authenticated;

insert into public.students (id, full_name) values
  ('e7400000-0000-4000-8000-000000000001', 'Student 74 one'),
  ('e7400000-0000-4000-8000-000000000002', 'Student 74 two'),
  ('e7400000-0000-4000-8000-000000000003', 'Student 74 outsider');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f7400000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'd7400000-0000-4000-8000-000000000001', '2004-09-02'),
  ('f7400000-0000-4000-8000-000000000002', 'e7400000-0000-4000-8000-000000000002', 'd7400000-0000-4000-8000-000000000001', '2004-09-02'),
  ('f7400000-0000-4000-8000-000000000003', 'e7400000-0000-4000-8000-000000000003', 'd7400000-0000-4000-8000-000000000002', '2004-09-02');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('c74000000000400080000000000000' || right(e.id::text, 2))::uuid, e.id,
       (select id from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'),
       12, 3600, 3600, e.start_date
from public.enrollments e where e.id::text like 'f7400000-%';

-- G1: 2, 7, 9 Sep held, both present; 14 Sep held and closed; 16 Sep planned
update public.lessons set status = 'held'
where id in (select id from l74 where grp = 'S74 G1' and lesson_date in ('2004-09-02', '2004-09-07', '2004-09-09', '2004-09-14'));
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, s.student_id, ('c74000000000400080000000000000' || right(s.enrollment_id::text, 2))::uuid, 'present'
from l74 l
cross join (values
  ('e7400000-0000-4000-8000-000000000001'::uuid, 'f7400000-0000-4000-8000-000000000001'::uuid),
  ('e7400000-0000-4000-8000-000000000002'::uuid, 'f7400000-0000-4000-8000-000000000002'::uuid)
) as s(student_id, enrollment_id)
where l.grp = 'S74 G1' and l.lesson_date in ('2004-09-02', '2004-09-07', '2004-09-09', '2004-09-14');
update public.lessons set is_locked = true where id in (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-14');

create temp view pay74 as
select base_amount from public.v_payroll_preview
where teacher_id = 'b7400000-0000-4000-8000-000000000001' and month = '2004-09-01';
grant select on pay74 to authenticated;
-- 4 lessons × 2 students × 3600 / 12 × 50 %
select is((select base_amount from pay74), 1200, 'fixture: teacher A earns 1 200 in September 2004');

-- ─── Teacher: no direct change, no admin RPCs ───────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ update public.attendance set status = 'absent_burned'
     where lesson_id = (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09')
       and student_id = 'e7400000-0000-4000-8000-000000000001' $$,
  '42501', null, 'teacher: a mark of a held lesson cannot be changed directly'
);
select throws_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_burned"}]', 'typo') $$,
  '42501', null, 'teacher: correct_attendance refused'
);

-- ─── Teacher: a request for own lesson ──────────────────────────────────────
select lives_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000002","status":"absent_burned"}]',
             '  Айжан не пришла, отметила по ошибке ') $$,
  'teacher: asks to correct own held lesson'
);
select results_eq(
  $$ select teacher_id, status, comment, created_by from public.attendance_correction_requests $$,
  $$ values ('b7400000-0000-4000-8000-000000000001'::uuid, 'pending'::text,
             'Айжан не пришла, отметила по ошибке'::text, 'a7400000-0000-4000-8000-000000000002'::uuid) $$,
  'request: author, teacher and pending status from the database, comment trimmed'
);
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_burned"}]', 'again') $$,
  '23505', null, 'request: one pending request per lesson'
);
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-16'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_burned"}]', 'planned') $$,
  '23514', null, 'request: only for a held lesson'
);
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-14'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_burned"}]', 'closed') $$,
  '23514', null, 'request: not in a closed period'
);
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-02'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000003","status":"present"}]', 'outsider') $$,
  '23514', null, 'request: only students of the lesson'
);
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-02'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"present"}]', '   ') $$,
  '23514', null, 'request: comment is required'
);
update public.attendance_correction_requests set status = 'approved';
select is(
  (select status from public.attendance_correction_requests),
  'pending', 'teacher: cannot decide a request by a direct update'
);
select throws_ok(
  $$ select public.apply_correction_request((select id from public.attendance_correction_requests limit 1)) $$,
  '42501', null, 'teacher: apply refused'
);
select throws_ok(
  $$ select public.reject_correction_request((select id from public.attendance_correction_requests limit 1), 'no') $$,
  '42501', null, 'teacher: reject refused'
);

-- ─── Another teacher: neither sees nor creates ──────────────────────────────
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is((select count(*)::integer from public.attendance_correction_requests), 0,
  'other teacher: sees no requests of someone else');
select throws_ok(
  $$ insert into public.attendance_correction_requests (lesson_id, marks, comment)
     values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07'),
             '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_burned"}]', 'not mine') $$,
  '42501', null, 'other teacher: no request for someone else''s lesson'
);

-- ─── Anon ───────────────────────────────────────────────────────────────────
reset request.jwt.claims;
set local role anon;
select throws_ok(
  $$ select public.correct_attendance(gen_random_uuid(), '[]', 'x') $$,
  '42501', null, 'anon: correct_attendance not granted'
);
select throws_ok(
  $$ select count(*) from public.attendance_correction_requests $$,
  '42501', null, 'anon: no access to requests'
);

-- ─── Admin: correct_attendance ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is((select count(*)::integer from public.attendance_correction_requests), 1, 'admin: sees every request');
select throws_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_frozen"}]', '  ') $$,
  '23514', 'reason is required', 'admin: a reason is required'
);
select throws_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-14'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'closed') $$,
  '23514', null, 'admin: refused in a closed period'
);
select throws_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-16'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"present"}]', 'planned') $$,
  '23514', null, 'admin: only a held lesson'
);
select is(
  public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
    '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_frozen"},
      {"student_id":"e7400000-0000-4000-8000-000000000002","status":"present"}]',
    'Был → заморозка, предупредил'),
  1, 'admin: present → frozen, one mark changed (the unchanged one skipped)'
);
select is((select base_amount from pay74), 1050, 'payroll: the frozen lesson is not paid any more (1 200 − 150)');
select is(
  (select lessons_left from public.v_subscription_balances where subscription_id = 'c7400000-0000-4000-8000-000000000001'),
  9, 'balance: the lesson is given back to the subscription (12 − 3)'
);
select results_eq(
  $$ select action, reason, before ->> 'status', after ->> 'status', kind, actor_id from public.audit_log
     where entity = 'attendance' and reason = 'Был → заморозка, предупредил' $$,
  $$ values ('update'::text, 'Был → заморозка, предупредил'::text, 'present'::text, 'absent_frozen'::text,
             'retro'::text, 'a7400000-0000-4000-8000-000000000001'::uuid) $$,
  'journal: one retro row with the reason and was → became'
);
select is(
  public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
    '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'again'),
  0, 'admin: the same correction again changes nothing'
);
select lives_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'second freeze') $$,
  'admin: second freeze on the subscription'
);
select throws_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-02'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"absent_frozen"}]', 'third freeze') $$,
  '23514', null, 'admin: the freeze limit (2) still holds'
);
select lives_ok(
  $$ select public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07'),
       '[{"student_id":"e7400000-0000-4000-8000-000000000001","status":"present"}]', 'back to present') $$,
  'admin: frozen → present'
);
select is(
  (select subscription_id from public.attendance
   where lesson_id = (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07')
     and student_id = 'e7400000-0000-4000-8000-000000000001'),
  'c7400000-0000-4000-8000-000000000001'::uuid, 'frozen → present: charged to the subscription'
);
select is((select base_amount from pay74), 1050, 'payroll: 7 Sep paid again');

-- ─── Admin: apply the teacher's request ─────────────────────────────────────
select is(
  public.apply_correction_request((select id from public.attendance_correction_requests where status = 'pending')),
  1, 'apply: the proposed mark is written'
);
select results_eq(
  $$ select r.status, r.decided_by, r.decided_at is not null, a.status::text
     from public.attendance_correction_requests r
     join public.attendance a on a.lesson_id = r.lesson_id and a.student_id = 'e7400000-0000-4000-8000-000000000002' $$,
  $$ values ('approved'::text, 'a7400000-0000-4000-8000-000000000001'::uuid, true, 'absent_burned'::text) $$,
  'apply: request approved by the admin, mark → absent_burned'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'attendance' and reason = 'Айжан не пришла, отметила по ошибке'
          and after ->> 'status' = 'absent_burned'),
  'apply: journal reason is the teacher''s comment'
);
select is((select base_amount from pay74), 1050, 'payroll: burned is paid like present');
select is(
  public.apply_correction_request((select id from public.attendance_correction_requests where status = 'approved')),
  0, 'apply is idempotent: a second call changes nothing'
);
select throws_ok(
  $$ select public.reject_correction_request((select id from public.attendance_correction_requests where status = 'approved'), 'late') $$,
  '23514', null, 'reject: an approved request stays approved'
);

-- ─── Reject ─────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
insert into public.attendance_correction_requests (lesson_id, marks, comment)
values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-02'),
        '[{"student_id":"e7400000-0000-4000-8000-000000000002","status":"absent_frozen"}]', 'предупреждала');
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.reject_correction_request((select id from public.attendance_correction_requests where status = 'pending'), ' ') $$,
  '23514', 'reason is required', 'reject: a reason is required'
);
select lives_ok(
  $$ select public.reject_correction_request((select id from public.attendance_correction_requests where status = 'pending'), 'Не предупреждала') $$,
  'reject: with a reason'
);
select throws_ok(
  $$ select public.apply_correction_request((select id from public.attendance_correction_requests where status = 'rejected')) $$,
  '23514', null, 'apply: a rejected request is refused'
);
select is(
  (select status::text from public.attendance
   where lesson_id = (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-02')
     and student_id = 'e7400000-0000-4000-8000-000000000002'),
  'present', 'reject: the marks stay'
);
select is(
  (select count(*)::integer from public.audit_log where entity = 'attendance_correction_requests'),
  4, 'journal: requests created and decided (2 inserts, 2 updates)'
);

set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select status, decision_comment from public.attendance_correction_requests order by created_at, status $$,
  $$ values ('approved'::text, null::text), ('rejected'::text, 'Не предупреждала'::text) $$,
  'teacher: sees own requests with the decision'
);

-- ─── Frozen → present on an exhausted subscription; a new mark ─────────────
-- Student three in G1: subscription A (1 lesson) used on 2 Sep, frozen on 9 Sep, no mark on 7 Sep;
-- subscription B (12 lessons) bought later.
reset role;
reset request.jwt.claims;
insert into public.students (id, full_name) values ('e7400000-0000-4000-8000-000000000004', 'Student 74 three');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('f7400000-0000-4000-8000-000000000004', 'e7400000-0000-4000-8000-000000000004', 'd7400000-0000-4000-8000-000000000001', '2004-09-02');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('c7400000-0000-4000-8000-0000000000a4', 'f7400000-0000-4000-8000-000000000004',
   (select id from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'), 1, 300, 300, '2004-09-02'),
  ('c7400000-0000-4000-8000-0000000000b4', 'f7400000-0000-4000-8000-000000000004',
   (select id from public.tariffs where group_type = 'mini' and valid_from = '1991-01-01'), 12, 3600, 3600, '2004-09-08');
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select l.id, 'e7400000-0000-4000-8000-000000000004', 'c7400000-0000-4000-8000-0000000000a4', s.status::public.attendance_status
from l74 l join (values ('2004-09-02'::date, 'present'), ('2004-09-09'::date, 'absent_frozen')) as s(d, status)
  on l.lesson_date = s.d
where l.grp = 'S74 G1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select is(
  public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09'),
    '[{"student_id":"e7400000-0000-4000-8000-000000000004","status":"present"}]', 'пришёл'),
  1, 'admin: frozen → present on an exhausted subscription'
);
select is(
  (select subscription_id from public.attendance
   where lesson_id = (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-09')
     and student_id = 'e7400000-0000-4000-8000-000000000004'),
  'c7400000-0000-4000-8000-0000000000b4'::uuid, 'frozen → present: charged to the next subscription'
);
select results_eq(
  $$ select subscription_id, lessons_left from public.v_subscription_balances
     where subscription_id in ('c7400000-0000-4000-8000-0000000000a4', 'c7400000-0000-4000-8000-0000000000b4')
     order by lessons_total $$,
  $$ values ('c7400000-0000-4000-8000-0000000000a4'::uuid, 0), ('c7400000-0000-4000-8000-0000000000b4'::uuid, 11) $$,
  'balance: the used-up subscription is not overdrawn, the next one is charged'
);
select is(
  public.correct_attendance((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07'),
    '[{"student_id":"e7400000-0000-4000-8000-000000000004","status":"present"}]', 'забыли отметить'),
  1, 'admin: a mark for an enrolled student without one is inserted'
);
select results_eq(
  $$ select a.status::text, a.subscription_id, a.consumes_credit from public.attendance a
     where a.lesson_id = (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07')
       and a.student_id = 'e7400000-0000-4000-8000-000000000004' $$,
  $$ values ('present'::text, 'c7400000-0000-4000-8000-0000000000b4'::uuid, true) $$,
  'new mark: present, charged to the active subscription'
);
select ok(
  exists (select 1 from public.audit_log where entity = 'attendance' and action = 'insert'
          and reason = 'забыли отметить' and kind = 'retro'),
  'new mark: journal insert row with the reason'
);

-- ─── Apply after the period is closed ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
insert into public.attendance_correction_requests (lesson_id, marks, comment)
values ((select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07'),
        '[{"student_id":"e7400000-0000-4000-8000-000000000002","status":"absent_burned"}]', 'не пришёл');
reset role;
reset request.jwt.claims;
update public.lessons set is_locked = true where id = (select id from l74 where grp = 'S74 G1' and lesson_date = '2004-09-07');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.apply_correction_request((select id from public.attendance_correction_requests where status = 'pending')) $$,
  '23514', null, 'apply: refused once the period is closed'
);
select results_eq(
  $$ select r.status, a.status::text from public.attendance_correction_requests r
     join public.attendance a on a.lesson_id = r.lesson_id and a.student_id = 'e7400000-0000-4000-8000-000000000002'
     where r.comment = 'не пришёл' $$,
  $$ values ('pending'::text, 'present'::text) $$,
  'apply refused: the request stays pending, the mark stays'
);
select lives_ok(
  $$ select public.reject_correction_request((select id from public.attendance_correction_requests where status = 'pending'), 'Период закрыт') $$,
  'reject: works in a closed period'
);
select is(
  (select count(*)::integer from public.attendance_correction_requests where status = 'pending'),
  0, 'closed period: no request is left hanging'
);

reset role;
select results_eq(
  $$ select base_amount from public.v_payroll_preview
     where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01' $$,
  $$ values (38160) $$,
  'seed: Гульзат is still 38 160'
);

select * from finish();
rollback;
