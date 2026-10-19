-- #92 · delete_payment / update_payment (0026): admin only, a reason, never a transfer; the duplicate
-- «новый абонемент» goes with its payment, a package with marks stays and owes, a deleted refund opens
-- the subscription again; payments_guard still refuses a direct update / delete. Fixtures in 2003,
-- rolled back.
begin;
select plan(45);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a9200000-0000-4000-8000-000000000001', 'teacher92@test.local'),
  ('a9200000-0000-4000-8000-000000000003', 'admin92@test.local'),
  ('a9200000-0000-4000-8000-000000000004', 'acc92@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b9200000-0000-4000-8000-000000000001', 'Teacher 92', '996000009201');
insert into public.profiles (id, phone, full_name, roles) values
  ('a9200000-0000-4000-8000-000000000001', '996000009201', 'Teacher 92', '{teacher}'),
  ('a9200000-0000-4000-8000-000000000003', '996000009203', 'Admin 92', '{admin}'),
  ('a9200000-0000-4000-8000-000000000004', '996000009204', 'Accountant 92', '{accountant}');

insert into public.tariffs (id, group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('f9200000-0000-4000-8000-000000000001', 'mini', 12, 3200, 6, 60, 2, '2003-01-01');
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('d9200000-0000-4000-8000-000000000001', 'Group 92', (select id from public.subjects where name = 'Математика'), 8, 'mini', 'b9200000-0000-4000-8000-000000000001', '2003-01-01', 'active');

-- S1 — a paid package, then the duplicate «новый абонемент»; S2 — a second package with 3 marks;
-- S3 — a refund; S4 — a transfer row; S5 — the only (first) package of the enrollment.
insert into public.students (id, full_name)
select ('e9200000-0000-4000-8000-00000000000' || n)::uuid, 'S92-' || n from generate_series(1, 5) n;
insert into public.enrollments (id, student_id, group_id, start_date)
select ('c9200000-0000-4000-8000-00000000000' || n)::uuid, ('e9200000-0000-4000-8000-00000000000' || n)::uuid,
       'd9200000-0000-4000-8000-000000000001', '2003-01-01'
from generate_series(1, 5) n;
insert into public.subscriptions (id, enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select ('59200000-0000-4000-8000-00000000000' || n)::uuid, ('c9200000-0000-4000-8000-00000000000' || n)::uuid,
       'f9200000-0000-4000-8000-000000000001', 12, 3200, 3200, '2003-01-01'
from generate_series(1, 5) n;

set session_replication_role = replica;
insert into public.lessons (id, group_id, teacher_id, lesson_date, planned_start, duration_min, status, confirmed_at)
select ('39200000-0000-4000-8000-00000000000' || n)::uuid, 'd9200000-0000-4000-8000-000000000001',
       'b9200000-0000-4000-8000-000000000001', date '2003-01-01' + n, '09:00', 60, 'held', now()
from generate_series(1, 3) n;
-- S4: a transfer pair (#81) lands on its subscription
insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id) values
  ('59200000-0000-4000-8000-000000000004', 1000, null, 'transfer', 'перенос из Group X',
   '79200000-0000-4000-8000-000000000001');
set session_replication_role = origin;

-- «debt_lessons debt_som paid_som» of a subscription
create function pg_temp.bal(p_sub uuid)
returns text language sql as $$
  select b.debt_lessons || ' ' || b.debt_som || ' ' || b.paid_som
  from public.v_student_balance b where b.subscription_id = p_sub;
$$;
create function pg_temp.pay(p_sub uuid)
returns uuid language sql as $$
  select p.id from public.payments p where p.subscription_id = p_sub
  order by p.created_at desc, p.id limit 1;
$$;
create function pg_temp.newest(p_enr uuid)
returns uuid language sql as $$
  select s.id from public.subscriptions s where s.enrollment_id = p_enr
  order by s.started_at desc, s.created_at desc, s.id desc limit 1;
$$;
grant execute on function pg_temp.bal(uuid), pg_temp.pay(uuid), pg_temp.newest(uuid) to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select public.record_payment(('59200000-0000-4000-8000-00000000000' || n)::uuid, 3200, 'cash')
from generate_series(1, 5) n where n <> 4;

-- ─── Access ─────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';
select throws_ok(
  $$ select public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 'дубль') $$,
  '42501', null, 'the accountant cannot delete a payment'
);
select throws_ok(
  $$ select public.update_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 100, 'cash', null, null, 'опечатка') $$,
  '42501', null, 'the accountant cannot edit a payment'
);
set local request.jwt.claims = '{"sub":"a9200000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select throws_ok(
  $$ select public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 'дубль') $$,
  '42501', null, 'a teacher cannot delete a payment'
);
select throws_ok(
  $$ select public.update_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 100, 'cash', null, null, 'опечатка') $$,
  '42501', null, 'a teacher cannot edit a payment'
);
reset role;
create temp table t_ids as
select pg_temp.pay('59200000-0000-4000-8000-000000000001') as s1_pay;
grant select on t_ids to anon, authenticated;
set local role anon;
select throws_ok(
  $$ select public.delete_payment((select s1_pay from t_ids), 'дубль') $$,
  '42501', null, 'anon cannot delete a payment'
);
select throws_ok(
  $$ select public.update_payment((select s1_pay from t_ids), 100, 'cash', null, null, 'опечатка') $$,
  '42501', null, 'anon cannot edit a payment'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';
update public.payments set amount = 1 where subscription_id = '59200000-0000-4000-8000-000000000001';
delete from public.payments where subscription_id = '59200000-0000-4000-8000-000000000001';
select is(
  (select amount from public.payments where subscription_id = '59200000-0000-4000-8000-000000000001'),
  3200, 'a direct update / delete from the admin through PostgREST changes nothing (no write policy)'
);
reset role;
select throws_ok(
  $$ delete from public.payments where subscription_id = '59200000-0000-4000-8000-000000000001' $$,
  '42501', null, 'payments_guard: a direct delete outside the RPC is refused even past RLS'
);
select throws_ok(
  $$ update public.payments set amount = 1 where subscription_id = '59200000-0000-4000-8000-000000000001' $$,
  '42501', null, 'payments_guard: a direct update outside the RPC is refused even past RLS'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

-- ─── Checks ─────────────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), '  ') $$,
  '23514', 'reason is required', 'delete without a reason is refused'
);
select throws_ok(
  $$ select public.update_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 100, 'cash', null, null, null) $$,
  '23514', 'reason is required', 'edit without a reason is refused'
);
select throws_ok(
  $$ select public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), repeat('x', 501)) $$,
  '23514', 'reason is too long', 'a reason is at most 500 characters'
);
select throws_ok(
  $$ select public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000004'), 'ошибка') $$,
  '23514', 'a transfer is undone only by undoing the transfer or the withdrawal', 'a transfer is not deleted'
);
select throws_ok(
  $$ select public.update_payment(pg_temp.pay('59200000-0000-4000-8000-000000000004'), 10, 'cash', null, null, 'ошибка') $$,
  '23514', 'a transfer is undone only by undoing the transfer or the withdrawal', 'a transfer is not edited'
);
select throws_ok(
  $$ select public.update_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 3200, 'cash', public.bishkek_today() + 1, null, 'дата') $$,
  '23514', 'payment date is in the future', 'a date in the future is refused'
);
select throws_ok(
  $$ select public.update_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 0, 'cash', null, null, 'сумма') $$,
  '23514', 'amount must be positive', 'amount must be positive'
);

-- ─── S1: the duplicate «новый абонемент» goes whole ──────────────────────────
select is(pg_temp.bal('59200000-0000-4000-8000-000000000001'), '0 0 3200', 'S1 before: paid in full');
select lives_ok(
  $$ select * from public.buy_subscription('c9200000-0000-4000-8000-000000000001', 3200, 'cash') $$,
  'S1: the duplicate «новый абонемент» + payment'
);
create temp table t_dup as
select pg_temp.newest('c9200000-0000-4000-8000-000000000001') as sub;
select isnt((select sub from t_dup), '59200000-0000-4000-8000-000000000001'::uuid, 'a second package exists');
select is(
  public.delete_payment(pg_temp.pay((select sub from t_dup)), 'дубль'),
  'subscription_deleted', 'delete_payment of the duplicate: the package goes with it'
);
select is(
  (select count(*)::integer from public.subscriptions where id = (select sub from t_dup)),
  0, 'the duplicate package is gone'
);
select is(pg_temp.bal('59200000-0000-4000-8000-000000000001'), '0 0 3200', 'S1 after: as before the duplicate');

-- the same payment recorded twice on one package: only the payment goes
select public.record_payment('59200000-0000-4000-8000-000000000001', 3200, 'cash');
select is(
  public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000001'), 'дубль'),
  'deleted', 'a second payment on the same package: only the payment goes'
);
select is(pg_temp.bal('59200000-0000-4000-8000-000000000001'), '0 0 3200', 'S1: one payment left');

reset role;
select results_eq(
  $$ select entity, action, reason, kind from public.audit_log
     where (entity = 'payments' and action = 'delete' and before ->> 'subscription_id' = (select sub::text from t_dup))
        or (entity = 'subscriptions' and action = 'delete' and entity_id = (select sub from t_dup))
     order by entity $$,
  $$ values ('payments'::text, 'delete'::text, 'дубль'::text, 'payment'::text),
            ('subscriptions', 'delete', 'дубль', 'payment') $$,
  'audit: the payment and the package deleted, with the reason, under «Оплаты»'
);
select ok(
  (select search from public.v_audit_feed
   where entity = 'payments' and action = 'delete' and before ->> 'subscription_id' = (select sub::text from t_dup))
  like '%' || public.person_name_key('S92-1') || '%',
  'А10 search still finds the student of a payment whose package is gone'
);
set local role authenticated;

-- ─── S2: a package with marks stays and owes ────────────────────────────────
select lives_ok(
  $$ select * from public.buy_subscription('c9200000-0000-4000-8000-000000000002', 3200, 'mbank') $$,
  'S2: a second package'
);
reset role;
create temp table t_s2 as select pg_temp.newest('c9200000-0000-4000-8000-000000000002') as sub;
grant select on t_s2 to authenticated;
set session_replication_role = replica;
insert into public.attendance (lesson_id, student_id, subscription_id, status)
select ('39200000-0000-4000-8000-00000000000' || n)::uuid, 'e9200000-0000-4000-8000-000000000002',
       (select sub from t_s2), 'present'
from generate_series(1, 3) n;
set session_replication_role = origin;
set local role authenticated;
select is(
  public.delete_payment(pg_temp.pay((select sub from t_s2)), 'не та группа'),
  'deleted', 'a package with marks: only the payment goes'
);
select is(
  pg_temp.bal((select sub from t_s2)),
  (select '3 ' || ceil(3 * price_final / 12.0) || ' 0' from public.subscriptions where id = (select sub from t_s2)),
  'the package stays and owes its 3 lessons'
);
select is(
  (select count(*)::integer from public.attendance where subscription_id = (select sub from t_s2)),
  3, 'its marks stay on it'
);

-- ─── S5: the only package of the enrollment stays unpaid ────────────────────
select is(
  public.delete_payment(pg_temp.pay('59200000-0000-4000-8000-000000000005'), 'ошибка'),
  'deleted', 'the first package of an enrollment: only the payment goes'
);
select is(pg_temp.bal('59200000-0000-4000-8000-000000000005'), '0 0 0', 'it stays, unpaid');

-- ─── S3: a deleted refund opens the subscription again ──────────────────────
select public.refund_subscription('59200000-0000-4000-8000-000000000003', 2000, 'cash', 'уехал');
select throws_ok(
  $$ select public.delete_payment(
       (select id from public.payments where subscription_id = '59200000-0000-4000-8000-000000000003' and kind = 'payment'),
       'ошибка') $$,
  '23514', 'the refund is more than the rest paid — delete the refund first',
  'a payment behind a refund is not deleted first'
);
select throws_ok(
  $$ select public.update_payment(
       (select id from public.payments where subscription_id = '59200000-0000-4000-8000-000000000003' and kind = 'refund'),
       3500, 'cash', null, 'уехал', 'сумма') $$,
  '23514', 'refund must be between 0 and the amount paid', 'a refund is at most what was paid'
);
select lives_ok(
  $$ select public.update_payment(
       (select id from public.payments where subscription_id = '59200000-0000-4000-8000-000000000003' and kind = 'refund'),
       1500, 'mbank', null, 'уехал в Ош', 'сумма') $$,
  'a refund is edited'
);
select results_eq(
  $$ select amount, method::text, reason from public.payments
     where subscription_id = '59200000-0000-4000-8000-000000000003' and kind = 'refund' $$,
  $$ values (-1500, 'mbank', 'уехал в Ош') $$,
  'the refund stays negative'
);
select is(
  public.delete_payment(
    (select id from public.payments where subscription_id = '59200000-0000-4000-8000-000000000003' and kind = 'refund'),
    'возврат не выдавали'),
  'reactivated', 'delete_payment of a refund'
);
select is(
  (select status::text from public.subscriptions where id = '59200000-0000-4000-8000-000000000003'),
  'active', 'the subscription is active again'
);

-- ─── update_payment ─────────────────────────────────────────────────────────
reset role;
create temp table t_before as
select id, created_at, created_by, paid_at from public.payments
where subscription_id = '59200000-0000-4000-8000-000000000001';
grant select on t_before to authenticated;
set local role authenticated;
select lives_ok(
  $$ select public.update_payment((select id from t_before), 1600, 'mbank', public.bishkek_today() - 3, 'половина', 'опечатка') $$,
  'admin edits amount, method, date and comment'
);
select results_eq(
  $$ select amount, method::text, reason, (paid_at at time zone 'Asia/Bishkek')::text from public.payments
     where id = (select id from t_before) $$,
  $$ values (1600, 'mbank', 'половина', ((public.bishkek_today() - 3) + time '12:00')::text) $$,
  'И39: an earlier day → noon of that day in Bishkek'
);
select ok(
  (select p.created_at = b.created_at and p.created_by = b.created_by
   from public.payments p join t_before b on b.id = p.id),
  'created_at / created_by do not change'
);
select lives_ok(
  $$ select public.update_payment((select id from t_before), 1700, 'mbank', public.bishkek_today() - 3, 'половина', 'ещё раз') $$,
  'the same day again'
);
select is(
  (select (paid_at at time zone 'Asia/Bishkek')::text from public.payments where id = (select id from t_before)),
  ((public.bishkek_today() - 3) + time '12:00')::text,
  'the same day keeps the time'
);
reset role;
select results_eq(
  $$ select (before ->> 'amount')::integer, (after ->> 'amount')::integer, reason from public.audit_log
     where entity = 'payments' and action = 'update' and entity_id = (select id from t_before) order by (after ->> 'amount')::integer $$,
  $$ values (3200, 1600, 'опечатка'), (1600, 1700, 'ещё раз') $$,
  'audit: every edit with its reason'
);
select is(current_setting('iqup.payment_edit', true), '', 'the RPC leaves no bypass behind');

select * from finish();
rollback;
