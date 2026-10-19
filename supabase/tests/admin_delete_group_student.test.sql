-- #94 · delete_group(id, reason) / group_delete_preview / group_payroll_impact, delete_student /
-- student_delete_preview / student_payroll_impact, delete_subject (0028): admin only, a reason, a
-- direct delete refused (groups_guard / students_guard / subjects_guard), money never goes silently
-- (a group with payments, a student with an active paid / attended enrollment — refused), closed
-- periods refused, the payroll drops by exactly the preview, the journal has every row with the
-- reason. Self-contained fixtures in March 2007 (Mondays 5, 12, 19, 26), rolled back.
begin;
select plan(43);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9450000-0000-4000-8000-000000000001', 'teacher945@test.local'),
  ('a9450000-0000-4000-8000-000000000003', 'admin945@test.local'),
  ('a9450000-0000-4000-8000-000000000004', 'acc945@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9450000-0000-4000-8000-000000000001', 'Teacher 945', '996000094501');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9450000-0000-4000-8000-000000000001', '996000094501', 'Teacher 945', '{teacher}'),
  ('a9450000-0000-4000-8000-000000000003', '996000094503', 'Admin 945', '{admin}'),
  ('a9450000-0000-4000-8000-000000000004', '996000094504', 'Accountant 945', '{accountant}');
insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('b9450000-0000-4000-8000-000000000001', 40, '2007-01-01');
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
values ('mini', 12, 3200, 6, 60, '2007-01-01');
insert into public.subjects (id, name) values ('c9450000-0000-4000-8000-000000000001', 'Предмет 945');

-- G1 — marks, a trial, no money; G2 — payments; G3 — a lesson in a closed period
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select ('d9450000-0000-4000-8000-00000000000' || n)::uuid, 'Group 945-' || n,
       (select id from public.subjects where name = 'Математика'), 8, 'mini',
       'b9450000-0000-4000-8000-000000000001', '2007-03-01', 'active'
from generate_series(1, 3) n;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select ('d9450000-0000-4000-8000-00000000000' || n)::uuid, 1, '15:00', '2007-03-01' from generate_series(1, 3) n;
select public.generate_lessons(('d9450000-0000-4000-8000-00000000000' || n)::uuid, '2007-03-31') from generate_series(1, 3) n;

insert into public.students (id, full_name)
select ('e9450000-0000-4000-8000-00000000000' || n)::uuid, 'S945-' || n from generate_series(1, 6) n;

create function pg_temp.lesson(p_group int, p_date date)
returns uuid language sql as $$
  select id from public.lessons
  where group_id = ('d9450000-0000-4000-8000-00000000000' || p_group)::uuid and lesson_date = p_date;
$$;
create function pg_temp.st(n int)
returns uuid language sql as $$ select ('e9450000-0000-4000-8000-00000000000' || n)::uuid; $$;
create function pg_temp.gr(n int)
returns uuid language sql as $$ select ('d9450000-0000-4000-8000-00000000000' || n)::uuid; $$;
create function pg_temp.pay()
returns integer language sql as $$
  select coalesce((select base_amount from public.v_payroll_preview
    where teacher_id = 'b9450000-0000-4000-8000-000000000001' and month = '2007-03-01'), 0);
$$;
create function pg_temp.present(variadic p_students int[])
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('student_id', pg_temp.st(n), 'status', 'present')) from unnest(p_students) n;
$$;
create table pg_temp.seen (key text primary key, n integer);
grant execute on function pg_temp.lesson(int, date), pg_temp.st(int), pg_temp.gr(int), pg_temp.pay(),
  pg_temp.present(int[]) to authenticated, anon;
grant all on pg_temp.seen to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9450000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
-- G1: S1 (attends, no money), S4 (nothing); G2: S2 (paid), S5 (paid, attended, left with a refund)
select public.enroll_student(pg_temp.st(1), pg_temp.gr(1), '2007-03-01');
select public.enroll_student(pg_temp.st(4), pg_temp.gr(1), '2007-03-01');
select public.enroll_student(pg_temp.st(2), pg_temp.gr(2), '2007-03-01');
select public.enroll_student(pg_temp.st(5), pg_temp.gr(2), '2007-03-01');
select public.record_payment(s.id, 3200, 'cash', '2007-03-01')
from public.subscriptions s join public.enrollments e on e.id = s.enrollment_id
where e.student_id in (pg_temp.st(2), pg_temp.st(5));
-- S4 is frozen on both (on the roster, nothing consumed)
select public.confirm_lesson(pg_temp.lesson(1, d), pg_temp.present(1) || jsonb_build_array(
  jsonb_build_object('student_id', pg_temp.st(4), 'status', 'absent_frozen')))
from unnest(array['2007-03-05', '2007-03-12']::date[]) d;
select public.confirm_lesson(pg_temp.lesson(2, '2007-03-05'), pg_temp.present(2, 5));
select * from public.withdraw_enrollment(
  (select id from public.enrollments where student_id = pg_temp.st(5)), '2007-03-05', 2933, 'cash', 'ушла');
insert into public.trials (full_name, parent_phone, lesson_id, status)
values ('Лид 945', '996700009451', pg_temp.lesson(1, '2007-03-05'), 'attended');
update public.students set referred_by_student_id = pg_temp.st(6) where id = pg_temp.st(4);

reset role;
set local request.jwt.claims = '{}';
set session_replication_role = replica;
insert into public.attendance_presets (lesson_id, student_id, status, comment)
values (pg_temp.lesson(1, '2007-03-26'), pg_temp.st(1), 'absent_frozen', 'предупредил');
update public.lessons set is_locked = true where id = pg_temp.lesson(3, '2007-03-05');
set session_replication_role = origin;

-- ─── Access ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9450000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok($$ select public.delete_group(pg_temp.gr(1), 'ошибка') $$, '42501', null, 'the teacher cannot delete a group');
select throws_ok($$ select public.delete_student(pg_temp.st(4), 'ошибка') $$, '42501', null, 'the teacher cannot delete a student');
select throws_ok($$ select * from public.student_delete_preview(pg_temp.st(4)) $$, '42501', null, 'the teacher cannot read the preview');
set local request.jwt.claims = '{"sub":"a9450000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok($$ select public.delete_group(pg_temp.gr(1), 'ошибка') $$, '42501', null, 'the accountant cannot delete a group');
select throws_ok($$ select public.delete_student(pg_temp.st(4), 'ошибка') $$, '42501', null, 'the accountant cannot delete a student');
select throws_ok(
  $$ select public.delete_subject('c9450000-0000-4000-8000-000000000001', 'ошибка') $$,
  '42501', null, 'the accountant cannot delete a subject'
);
reset role;
set local role anon;
select throws_ok($$ select public.delete_group('00000000-0000-4000-8000-000000000000', 'x') $$, '42501', null, 'anon cannot delete a group');
select throws_ok($$ select public.delete_student('00000000-0000-4000-8000-000000000000', 'x') $$, '42501', null, 'anon cannot delete a student');
select throws_ok($$ select public.delete_subject('00000000-0000-4000-8000-000000000000', 'x') $$, '42501', null, 'anon cannot delete a subject');

-- ─── Direct deletes and reasons (admin) ─────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9450000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ delete from public.students where id = pg_temp.st(6) $$,
  '42501', null, 'a direct delete of a student is refused'
);
select throws_ok(
  $$ delete from public.groups where id = pg_temp.gr(1) $$,
  '42501', null, 'a direct delete of a group is refused'
);
select throws_ok(
  $$ delete from public.subjects where id = 'c9450000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a direct delete of a subject is refused'
);
select throws_ok($$ select public.delete_student(pg_temp.st(6), '') $$, '23514', 'reason is required', 'a student — a reason');
select throws_ok($$ select public.delete_group(pg_temp.gr(1), '') $$, '23514', 'reason is required', 'a group — a reason');

-- ─── Students ───────────────────────────────────────────────────────────────
select results_eq(
  $$ select blockers from public.student_delete_preview(pg_temp.st(1)) $$,
  $$ values (array['active_enrollment']::text[]) $$,
  'S1 attends with no money: «Ушёл» / «Записан по ошибке» first'
);
select throws_like(
  $$ select public.delete_student(pg_temp.st(2), 'дубль') $$,
  '%active_enrollment%', 'S2 (active, paid) cannot be deleted'
);
select results_eq(
  $$ select enrollments, active_enrollments, consumed_marks, payments, paid_som, refunded_som, blockers
     from public.student_delete_preview(pg_temp.st(5)) $$,
  $$ values (1, 0, 1, 1, 3200, 2933, '{}'::text[]) $$,
  'S5 left with a refund: deletable, the preview shows the money and the marks'
);
select results_eq(
  $$ select teacher_name, month, marks, amount from public.student_payroll_impact(pg_temp.st(5)) $$,
  $$ values ('Teacher 945'::text, '2007-03-01'::date, 1, 107) $$,
  'S5: the teacher loses 107 (3 200 / 12 × 40 %, rounded within the month)'
);
insert into pg_temp.seen values ('before', pg_temp.pay());
select lives_ok($$ select public.delete_student(pg_temp.st(5), 'дубль ученика') $$, 'S5 is deleted');
select is(
  (select n from pg_temp.seen where key = 'before') - pg_temp.pay(), 107,
  'the payroll drops by exactly the preview'
);
select is_empty(
  $$ select 1 from public.enrollments where student_id = pg_temp.st(5)
     union all select 1 from public.attendance where student_id = pg_temp.st(5)
     union all select 1 from public.students where id = pg_temp.st(5) $$,
  'S5, the enrollment and the marks are gone'
);
select is(
  (select count(*)::integer from public.audit_log where reason = 'дубль ученика'
   and entity in ('students', 'enrollments', 'subscriptions', 'payments', 'attendance')),
  6, 'the journal: student, enrollment, subscription, payment, refund and mark — with the reason'
);
select is(
  (select before ->> 'full_name' from public.audit_log where entity = 'students' and reason = 'дубль ученика'),
  'S945-5', 'the student row keeps the name'
);
select lives_ok($$ select public.delete_student(pg_temp.st(4), 'записали не того') $$, 'S4 (nothing yet) is deleted');
select lives_ok($$ select public.delete_student(pg_temp.st(6), 'тестовая запись') $$, 'S6 (no enrollment) is deleted');
select is(
  (select count(*)::integer from public.audit_log where entity = 'students' and action = 'delete'
   and before ->> 'id' in (pg_temp.st(4)::text, pg_temp.st(6)::text)),
  2, 'both in the journal'
);

-- ─── Groups ─────────────────────────────────────────────────────────────────
select results_eq(
  $$ select payments, payments_som, blockers from public.group_delete_preview(pg_temp.gr(2)) $$,
  $$ values (1, 3200, array['payments']::text[]) $$,
  'G2 has the money of S2: refused'
);
select throws_like(
  $$ select public.delete_group(pg_temp.gr(2), 'ошибка') $$,
  '%payments%', 'a group with payments is not deleted'
);
select results_eq(
  $$ select blockers from public.group_delete_preview(pg_temp.gr(3)) $$,
  $$ values (array['locked']::text[]) $$,
  'G3 has a lesson in a closed period: refused'
);
select throws_like(
  $$ select public.delete_group(pg_temp.gr(3), 'ошибка') $$,
  '%locked%', 'a group with a locked lesson is not deleted'
);
select results_eq(
  $$ select lessons, held_lessons, marks, consumed_marks, enrollments, trials, payments, blockers
     from public.group_delete_preview(pg_temp.gr(1)) $$,
  $$ values (4, 2, 2, 2, 1, 1, 0, '{}'::text[]) $$,
  'G1: 4 lessons (2 held), 2 marks of S1 (S4 is gone), S1, a trial, no money'
);
select results_eq(
  $$ select teacher_name, month, marks, amount from public.group_payroll_impact(pg_temp.gr(1)) $$,
  $$ values ('Teacher 945'::text, '2007-03-01'::date, 2, 213) $$,
  'G1: the teacher loses 213'
);
update pg_temp.seen set n = pg_temp.pay() where key = 'before';
select is(public.delete_group(pg_temp.gr(1), 'группа создана по ошибке'), 4, 'G1 is deleted with its 4 lessons');
select is(
  (select n from pg_temp.seen where key = 'before') - pg_temp.pay(), 213,
  'the payroll drops by exactly the preview'
);
select is_empty(
  $$ select 1 from public.groups where id = pg_temp.gr(1)
     union all select 1 from public.lessons where group_id = pg_temp.gr(1)
     union all select 1 from public.enrollments where group_id = pg_temp.gr(1)
     union all select 1 from public.trials where group_id = pg_temp.gr(1)
     union all select 1 from public.attendance_presets where student_id = pg_temp.st(1)
     union all select 1 from public.schedule_rules where group_id = pg_temp.gr(1) $$,
  'the group goes with everything'
);
select isnt_empty($$ select 1 from public.students where id = pg_temp.st(1) $$, 'the student stays');
select is(
  (select reason from public.audit_log where entity = 'groups' and action = 'delete' and entity_id = pg_temp.gr(1)),
  'группа создана по ошибке', 'the journal has the group with the reason'
);
select ok(
  (select count(*) from public.audit_log where reason = 'группа создана по ошибке' and entity = 'attendance') = 2,
  'the marks are in the journal with the reason'
);
select lives_ok(
  $$ select public.delete_group(g.id) from public.groups g where false $$,
  'the old delete_group(uuid) is still there'
);

-- ─── Subjects ───────────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.delete_subject((select id from public.subjects where name = 'Математика'), 'ошибка') $$,
  '23503', null, 'a subject with groups is not deleted'
);
select throws_ok(
  $$ select public.delete_subject('c9450000-0000-4000-8000-000000000001', ' ') $$,
  '23514', 'reason is required', 'a subject — a reason'
);
select lives_ok(
  $$ select public.delete_subject('c9450000-0000-4000-8000-000000000001', 'опечатка') $$,
  'an unused subject is deleted'
);
select is(
  (select reason from public.audit_log where entity = 'subjects' and action = 'delete'
   and entity_id = 'c9450000-0000-4000-8000-000000000001'),
  'опечатка', 'the journal has the subject with the reason'
);

select * from finish();
rollback;
