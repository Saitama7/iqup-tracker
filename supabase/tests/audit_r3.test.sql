-- #52 · А10 R3: audit_log.kind is a stored generated column with an index (kind, at, id); a rate
-- inserted with a past valid_from is «retro»; v_audit_feed.search finds rows by the current names of
-- student / group / teacher; audit_feed_counts() — the chip counts in one query, under RLS.
begin;
select plan(19);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- a…1 admin, a…2 teacher (group G), a…3 accountant
insert into auth.users (id, email) values
  ('a5200000-0000-4000-8000-000000000001', 'admin52@test.local'),
  ('a5200000-0000-4000-8000-000000000002', 'teacher52@test.local'),
  ('a5200000-0000-4000-8000-000000000003', 'acc52@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b5200000-0000-4000-8000-000000000001', 'Сёмина Учительница', '996000005202'),
  ('b5200000-0000-4000-8000-000000000002', 'Замена Пятьдвадва', '996000005209');
insert into public.profiles (id, phone, full_name, roles) values
  ('a5200000-0000-4000-8000-000000000001', '996000005201', 'Admin 52', '{admin}'),
  ('a5200000-0000-4000-8000-000000000002', '996000005202', 'Сёмина Учительница', '{teacher}'),
  ('a5200000-0000-4000-8000-000000000003', '996000005203', 'Accountant 52', '{accountant}');
insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, valid_from)
values ('f5200000-0000-4000-8000-000000000001', 'pair', 12, 3200, 2, 60, '2003-01-01');
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d5200000-0000-4000-8000-000000000001', 'Группа Пятьдвадва', (select id from public.subjects where name = 'Химия'),
   8, 'pair', 'b5200000-0000-4000-8000-000000000001', '2003-01-01', 'active');
insert into public.students (id, full_name) values
  ('e5200000-0000-4000-8000-000000000001', 'Алёна  Тестова');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('c5200000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000001', 'd5200000-0000-4000-8000-000000000001', '2003-01-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at) values
  ('55200000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 12, 3200, 3200, '2003-01-01');
insert into public.lessons (id, group_id, lesson_date, planned_start, duration_min, substitute_teacher_id) values
  ('15200000-0000-4000-8000-000000000001', 'd5200000-0000-4000-8000-000000000001', '2003-01-06', '09:00', 60,
   'b5200000-0000-4000-8000-000000000002');

-- ─── Schema ─────────────────────────────────────────────────────────────────
select is(
  (select attgenerated::text from pg_attribute
   where attrelid = 'public.audit_log'::regclass and attname = 'kind'),
  's',
  'audit_log.kind is a stored generated column'
);
select has_index('public', 'audit_log', 'audit_log_kind_at_idx', array['kind', 'at', 'id'],
  'index (kind, at desc, id desc)');
select throws_ok(
  $$ update public.audit_log set kind = 'other' $$,
  '428C9', null, 'kind cannot be written by hand'
);

-- ─── Admin: rates with a past, today''s and a future valid_from ─────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5200000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["admin"]}}';

insert into public.teacher_rates (id, teacher_id, percent, valid_from) values
  ('75200000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001', 40, public.bishkek_today() - 10),
  ('75200000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000001', 45, public.bishkek_today()),
  ('75200000-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000001', 50, public.bishkek_today() + 10);
select lives_ok(
  $$ select public.record_payment('55200000-0000-4000-8000-000000000001', 3200, 'cash') $$,
  'admin records a payment'
);

select is(
  (select kind from public.v_audit_feed where entity_id = '75200000-0000-4000-8000-000000000001'),
  'retro',
  'a rate inserted with a past valid_from is «retro» (#52)'
);
select is(
  (select kind from public.v_audit_feed where entity_id = '75200000-0000-4000-8000-000000000002'),
  'other',
  'a rate from today is not «retro»'
);
select is(
  (select kind from public.v_audit_feed where entity_id = '75200000-0000-4000-8000-000000000003'),
  'other',
  'a planned rate is not «retro»'
);
select is(
  (select kind from public.audit_log where entity_id = '75200000-0000-4000-8000-000000000001'),
  public.audit_kind('teacher_rates', 'insert', null,
    jsonb_build_object('valid_from', public.bishkek_today() - 10), now()),
  'the stored kind is audit_kind() of the row'
);

-- ─── Search ─────────────────────────────────────────────────────────────────
select set_eq(
  $$ select entity from public.v_audit_feed where search like '%' || public.person_name_key('алена тестова') || '%' $$,
  array['enrollments', 'subscriptions', 'payments'],
  'a student: enrollment, subscription, payment (ё = е, spaces collapsed)'
);
select set_eq(
  $$ select entity from public.v_audit_feed where search like '%пятьдвадва%'
     and entity_id <> 'd5200000-0000-4000-8000-000000000001' $$,
  array['enrollments', 'subscriptions', 'payments', 'lessons'],
  'a group by name (and a substitute by name): every row of the group'
);
select set_eq(
  $$ select entity from public.v_audit_feed where search like '%химия%'
     and (search like '%пятьдвадва%') $$,
  array['enrollments', 'subscriptions', 'payments', 'lessons'],
  'a group by its subject'
);
select set_eq(
  $$ select entity from public.v_audit_feed where search like '%семина%' $$,
  array['enrollments', 'subscriptions', 'payments', 'lessons', 'teacher_rates'],
  'a teacher: her groups'' rows and her rates'
);
select is(
  (select search from public.v_audit_feed where entity = 'tariffs' and entity_id = 'f5200000-0000-4000-8000-000000000001'),
  null,
  'tariffs are about no one'
);
update public.groups set name = 'Переименована 52' where id = 'd5200000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.v_audit_feed where search like '%переименована 52%' and entity = 'enrollments'),
  1,
  'a renamed group is found by its new name'
);

-- ─── Counts ─────────────────────────────────────────────────────────────────
select set_eq(
  $$ select kind, n from public.audit_feed_counts() $$,
  $$ select kind, count(*)::integer from public.v_audit_feed group by kind $$,
  'audit_feed_counts() = counts of the feed per kind'
);
select set_eq(
  $$ select kind, n from public.audit_feed_counts(p_entity => 'teacher_rates', p_q => 'СЁМИНА') $$,
  $$ values ('retro', 1), ('other', 2) $$,
  'counts by table and search (the query normalised as the column)'
);
select is_empty(
  $$ select 1 from public.audit_feed_counts(p_actor => 'a5200000-0000-4000-8000-000000000001', p_system => true) $$,
  'an author and «Система» exclude each other'
);

-- ─── Accountant reads the counts, the teacher none ──────────────────────────
set local request.jwt.claims = '{"sub":"a5200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select isnt_empty(
  $$ select 1 from public.audit_feed_counts(p_q => 'семина') $$,
  'accountant reads the counts'
);
set local request.jwt.claims = '{"sub":"a5200000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select is_empty(
  $$ select 1 from public.audit_feed_counts() $$,
  'teacher gets no counts (RLS on audit_log)'
);

select * from finish();
rollback;
