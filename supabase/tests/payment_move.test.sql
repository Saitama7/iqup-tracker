-- #119 · update_payment(p_subscription_id) (0036): a payment moves to another subscription of the
-- same enrollment — the older package's debt goes, audit_log keeps the move with the reason; another
-- enrollment, a refunded package, a refund — refused. Fixtures in 2004, rolled back.
begin;
select plan(11);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1190000-0000-4000-8000-000000000001', 'teacher119@test.local'),
  ('a1190000-0000-4000-8000-000000000003', 'admin119@test.local'),
  ('a1190000-0000-4000-8000-000000000004', 'acc119@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b1190000-0000-4000-8000-000000000001', 'Teacher 119', '996000011901');
insert into public.profiles (id, phone, full_name, roles) values
  ('a1190000-0000-4000-8000-000000000001', '996000011901', 'Teacher 119', '{teacher}'),
  ('a1190000-0000-4000-8000-000000000003', '996000011903', 'Admin 119', '{admin}'),
  ('a1190000-0000-4000-8000-000000000004', '996000011904', 'Accountant 119', '{accountant}');

insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('f1190000-0000-4000-8000-000000000001', 'mini', 12, 3200, 6, 60, null, '2004-01-01');
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d1190000-0000-4000-8000-000000000001', 'Group 119', (select id from public.subjects where name = 'Математика'), 8, 'mini', 'b1190000-0000-4000-8000-000000000001', '2004-01-01', 'active');

-- S1: «old» (01.01, 3 marks, unpaid), «new» (01.02, paid — the payment that belonged to «old»),
-- «gone» (refunded); S2: another enrollment.
insert into public.students (id, full_name) values
  ('e1190000-0000-4000-8000-000000000001', 'S119-1'),
  ('e1190000-0000-4000-8000-000000000002', 'S119-2');
insert into public.enrollments (id, student_id, group_id, start_date) values
  ('c1190000-0000-4000-8000-000000000001', 'e1190000-0000-4000-8000-000000000001', 'd1190000-0000-4000-8000-000000000001', '2004-01-01'),
  ('c1190000-0000-4000-8000-000000000002', 'e1190000-0000-4000-8000-000000000002', 'd1190000-0000-4000-8000-000000000001', '2004-01-01');
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at, status) values
  ('51190000-0000-4000-8000-000000000001', 'c1190000-0000-4000-8000-000000000001', 'f1190000-0000-4000-8000-000000000001', 12, 3200, 3200, '2004-01-01', 'active'),
  ('51190000-0000-4000-8000-000000000002', 'c1190000-0000-4000-8000-000000000001', 'f1190000-0000-4000-8000-000000000001', 12, 3200, 3200, '2004-02-01', 'active'),
  ('51190000-0000-4000-8000-000000000003', 'c1190000-0000-4000-8000-000000000001', 'f1190000-0000-4000-8000-000000000001', 12, 3200, 3200, '2003-12-01', 'active'),
  ('51190000-0000-4000-8000-000000000004', 'c1190000-0000-4000-8000-000000000002', 'f1190000-0000-4000-8000-000000000001', 12, 3200, 3200, '2004-01-01', 'active');

set session_replication_role = replica;
update public.subscriptions set status = 'refunded' where id = '51190000-0000-4000-8000-000000000003';
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at)
select ('31190000-0000-4000-8000-00000000000' || n)::uuid, 'd1190000-0000-4000-8000-000000000001',
       'b1190000-0000-4000-8000-000000000001', date '2004-01-01' + n, '09:00', 60, 'held', now()
from generate_series(1, 3) n;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('31190000-0000-4000-8000-00000000000' || n)::uuid, 'e1190000-0000-4000-8000-000000000001',
       '51190000-0000-4000-8000-000000000001', 'present'
from generate_series(1, 3) n;
set session_replication_role = origin;

create function pg_temp.bal(p_sub uuid)
returns text language sql as $$
  select b.debt_lessons || ' ' || b.paid_som
  from public.v_student_balance b where b.subscription_id = p_sub;
$$;
grant execute on function pg_temp.bal(uuid) to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1190000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select public.record_payment('51190000-0000-4000-8000-000000000002', 3200, 'cash');

reset role;
create temp table t_pay as
  select id from public.payments where subscription_id = '51190000-0000-4000-8000-000000000002';
grant select on t_pay to authenticated;

select is(pg_temp.bal('51190000-0000-4000-8000-000000000001'), '3 0', 'before: the older package owes 3 lessons');

-- ─── Access ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1190000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.update_payment((select id from t_pay), 3200, 'cash', null, null, 'не туда',
       '51190000-0000-4000-8000-000000000001') $$,
  '42501', null, 'the accountant cannot move a payment'
);

-- ─── Refused targets ────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1190000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
select throws_ok(
  $$ select public.update_payment((select id from t_pay), 3200, 'cash', null, null, 'не туда',
       '51190000-0000-4000-8000-000000000004') $$,
  '23514', 'the payment moves only to a subscription of the same enrollment',
  'another enrollment — refused'
);
select throws_ok(
  $$ select public.update_payment((select id from t_pay), 3200, 'cash', null, null, 'не туда',
       '51190000-0000-4000-8000-000000000003') $$,
  '23514', 'the subscription is refunded', 'a refunded package — refused'
);
select throws_ok(
  $$ select public.update_payment((select id from t_pay), 3200, 'cash', null, null, '',
       '51190000-0000-4000-8000-000000000001') $$,
  '23514', 'reason is required', 'a reason is required'
);
-- no write policy on payments: a direct update through PostgREST touches nothing
update public.payments set subscription_id = '51190000-0000-4000-8000-000000000001'
where id = (select id from t_pay);
select is(
  (select subscription_id from public.payments where id = (select id from t_pay)),
  '51190000-0000-4000-8000-000000000002'::uuid, 'a direct update moves nothing'
);

-- ─── The move ───────────────────────────────────────────────────────────────
select lives_ok(
  $$ select public.update_payment((select id from t_pay), 3200, 'cash', null, null,
       'оплата ушла в новый абонемент', '51190000-0000-4000-8000-000000000001') $$,
  'moved to the older package'
);
select is(pg_temp.bal('51190000-0000-4000-8000-000000000001'), '0 3200', 'the older package is paid, no debt');
select is(pg_temp.bal('51190000-0000-4000-8000-000000000002'), '0 0', 'the newer one is unpaid');

reset role;
select results_eq(
  $$ select before ->> 'subscription_id', after ->> 'subscription_id', reason from public.audit_log
     where entity = 'payments' and action = 'update' and entity_id = (select id from t_pay) $$,
  $$ values ('51190000-0000-4000-8000-000000000002', '51190000-0000-4000-8000-000000000001',
             'оплата ушла в новый абонемент') $$,
  'audit: the move with its reason'
);
select is(current_setting('iqup.payment_edit', true), '', 'the RPC leaves no bypass behind');

select * from finish();
rollback;
