-- #92 · delete_payment / update_payment × after-school invoices in hours (0026): the invoice stays
-- without its payment (И60), and И72 holds — debt − refund in v_student_balance = −Σ
-- subscription_settlement = −enrollment_settlement — after a payment behind credit hours is deleted or
-- edited. Fixtures as afterschool_credit_flow (2004, ПН 3 ч, 123 сом/ч), rolled back.
-- H1 — October paid 1 476, 6 h used, 6 h frozen → November takes 6 h credit; then October's payment
-- is deleted, recorded again and edited. H2 — an invoice with one payment, deleted.
begin;
select plan(9);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a9210000-0000-4000-8000-000000000009', 'admin921@test.local');
insert into public.teachers (id, full_name, phone)
select ('b9210000-0000-4000-8000-00000000000' || n)::uuid, 'Teacher 921-' || n, '99600000921' || n
from generate_series(1, 2) n;
insert into public.profiles (id, phone, full_name, roles) values
  ('a9210000-0000-4000-8000-000000000009', '996000009219', 'Admin 921', '{admin}');
insert into public.teacher_rates (teacher_id, percent, valid_from)
select ('b9210000-0000-4000-8000-00000000000' || n)::uuid, 45, '2004-01-01' from generate_series(1, 2) n;
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('afterschool', 20, 7400, 8, 180, 2, '2004-01-01');

insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status)
select ('d9210000-0000-4000-8000-00000000000' || n)::uuid, 'Продлёнка 921-' || n,
       (select id from public.subjects where name = 'Математика'), 3, 'afterschool',
       ('b9210000-0000-4000-8000-00000000000' || n)::uuid, '2004-10-01', 'active'
from generate_series(1, 2) n;
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select ('d9210000-0000-4000-8000-00000000000' || n)::uuid, d, '13:00', '2004-10-01'
from generate_series(1, 2) n, generate_series(1, 5) d;
select public.generate_lessons(('d9210000-0000-4000-8000-00000000000' || n)::uuid, '2004-12-31')
from generate_series(1, 2) n;
insert into public.students (id, full_name)
select ('e9210000-0000-4000-8000-00000000000' || n)::uuid, 'S' || n from generate_series(1, 2) n;

create function pg_temp.enr(p_n integer)
returns uuid language sql as $$
  select id from public.enrollments
  where student_id = ('e9210000-0000-4000-8000-00000000000' || p_n)::uuid;
$$;
create function pg_temp.mark(p_n integer, p_dates date[], p_status text)
returns void language sql as $$
  select public.confirm_lesson(l.id, jsonb_build_array(jsonb_build_object(
    'student_id', ('e9210000-0000-4000-8000-00000000000' || p_n)::uuid, 'status', p_status)))
  from unnest(p_dates) d
  join public.lessons l
    on l.group_id = ('d9210000-0000-4000-8000-00000000000' || p_n)::uuid and l.lesson_date = d;
$$;
create function pg_temp.sub(p_n integer, p_month date)
returns uuid language sql as $$
  select s.id from public.subscriptions s
  where s.enrollment_id = pg_temp.enr(p_n) and s.period_month = p_month and s.status <> 'refunded';
$$;
-- «debt − refund in v_student_balance | −Σ subscription_settlement | −enrollment_settlement»: one number
create function pg_temp.agree(p_n integer)
returns text language sql as $$
  select concat_ws(' | ',
    (select coalesce(sum(debt_som - refund_suggested), 0)::integer from public.v_student_balance
     where enrollment_id = pg_temp.enr(p_n)),
    (select -coalesce(sum(remainder), 0)::integer from public.subscription_settlement(pg_temp.enr(p_n))),
    (select -remainder from public.enrollment_settlement(pg_temp.enr(p_n))));
$$;
-- «debt refund» of one invoice
create function pg_temp.bal(p_n integer, p_month date)
returns text language sql as $$
  select debt_som || ' ' || refund_suggested from public.v_student_balance
  where subscription_id = pg_temp.sub(p_n, p_month);
$$;
grant execute on function pg_temp.enr(integer), pg_temp.mark(integer, date[], text),
  pg_temp.sub(integer, date), pg_temp.bal(integer, date), pg_temp.agree(integer) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9210000-0000-4000-8000-000000000009","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select public.enroll_student(('e9210000-0000-4000-8000-00000000000' || n)::uuid,
                             ('d9210000-0000-4000-8000-00000000000' || n)::uuid, '2004-10-01',
                             0, 'none', array[3, 0, 0, 0, 0, 0, 0]::numeric[])
from generate_series(1, 2) n;
select pg_temp.mark(1, array['2004-10-04', '2004-10-11']::date[], 'present');
select pg_temp.mark(1, array['2004-10-18', '2004-10-25']::date[], 'absent_frozen');

select public.record_payment(pg_temp.sub(1, '2004-10-01'), 1476, 'cash');
select public.issue_afterschool_invoice(pg_temp.enr(1), '2004-11-01');
select pg_temp.mark(1, array['2004-11-01', '2004-11-08', '2004-11-15']::date[], 'present');
select is(
  (select credit_hours from public.subscriptions where id = pg_temp.sub(1, '2004-11-01')),
  6.0::numeric, 'November took the 6 h credit'
);
reset role;
select is(pg_temp.agree(1), '369 | 369 | 369', 'before: balance = settlement, 369 owed');
set local role authenticated;

select is(
  public.delete_payment(
    (select id from public.payments where subscription_id = pg_temp.sub(1, '2004-10-01')), 'дубль'),
  'deleted', 'the October payment is deleted'
);
select is(
  (select count(*)::integer from public.subscriptions where id = pg_temp.sub(1, '2004-10-01')),
  1, 'the October invoice in hours stays without a payment (И60)'
);
reset role;
select is(
  (select split_part(pg_temp.agree(1), ' | ', 1) = split_part(pg_temp.agree(1), ' | ', 2)
      and split_part(pg_temp.agree(1), ' | ', 2) = split_part(pg_temp.agree(1), ' | ', 3)),
  true, 'И72 after the delete: balance = settlement = enrollment_settlement'
);
select is(pg_temp.agree(1), '1845 | 1845 | 1845', 'the 1 476 is owed again: 369 + 1 476');
set local role authenticated;

select public.record_payment(pg_temp.sub(1, '2004-10-01'), 1476, 'cash');
select lives_ok(
  $$ select public.update_payment(
       (select id from public.payments where subscription_id = pg_temp.sub(1, '2004-10-01')),
       1000, 'mbank', null, null, 'опечатка') $$,
  'the October payment is edited down to 1 000'
);
reset role;
select is(
  (select split_part(pg_temp.agree(1), ' | ', 1) = split_part(pg_temp.agree(1), ' | ', 2)
      and split_part(pg_temp.agree(1), ' | ', 2) = split_part(pg_temp.agree(1), ' | ', 3)),
  true, 'И72 after the edit: balance = settlement = enrollment_settlement'
);
set local role authenticated;

-- ─── H2: an invoice with its only payment ───────────────────────────────────
select public.record_payment(pg_temp.sub(2, '2004-10-01'), 1476, 'cash');
select public.delete_payment(
  (select id from public.payments where subscription_id = pg_temp.sub(2, '2004-10-01')), 'ошибка');
select is(
  (select count(*)::integer from public.subscriptions s
   where s.enrollment_id = pg_temp.enr(2) and s.period_month = '2004-10-01'),
  1, 'H2: the invoice stays after its only payment is deleted'
);

select * from finish();
rollback;
