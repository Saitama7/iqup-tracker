-- #83 · advances (0022): payroll_adjustments RLS (teacher reads own, staff read all, nobody writes
-- directly), issue_advance / delete_payroll_adjustment (admin and accountant; teacher / anon 42501),
-- amount > 0, no future date, delete only with a reason, closed month, audit_log, v_payroll_preview
-- advances / to_pay — the accrual of the seed does not move. Fixtures in 2003 + the seed, rolled back.
begin;
select plan(38);

-- ─── Fixtures (as postgres) ─────────────────────────────────────────────────
-- users: …1 teacher A, …2 teacher B, …3 admin, …4 accountant
insert into auth.users (id, email) values
  ('a8300000-0000-4000-8000-000000000001', 'teacher83a@test.local'),
  ('a8300000-0000-4000-8000-000000000002', 'teacher83b@test.local'),
  ('a8300000-0000-4000-8000-000000000003', 'admin83@test.local'),
  ('a8300000-0000-4000-8000-000000000004', 'acc83@test.local');
insert into public.teachers (id, full_name, phone) values
  ('b8300000-0000-4000-8000-000000000001', 'Teacher A', '996000008301'),
  ('b8300000-0000-4000-8000-000000000002', 'Teacher B', '996000008302');
insert into public.profiles (id, phone, full_name, roles) values
  ('a8300000-0000-4000-8000-000000000001', '996000008301', 'Teacher A', '{teacher}'),
  ('a8300000-0000-4000-8000-000000000002', '996000008302', 'Teacher B', '{teacher}'),
  ('a8300000-0000-4000-8000-000000000003', '996000008303', 'Admin', '{admin}'),
  ('a8300000-0000-4000-8000-000000000004', '996000008304', 'Accountant', '{accountant}');

-- ─── Schema ─────────────────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payroll_adjustments'::regclass),
  'payroll_adjustments has RLS'
);
select ok(
  not has_table_privilege('anon', 'public.payroll_adjustments', 'select'),
  'anon cannot read payroll_adjustments'
);
select ok(
  not has_function_privilege('anon', 'public.issue_advance(uuid, integer, date, date, text)', 'execute'),
  'anon cannot execute issue_advance'
);

-- ─── Accountant issues advances ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8300000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';

select lives_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 3000, '2003-03-10', null, '  на лекарства  ') $$,
  'accountant issues an advance to teacher A'
);
select results_eq(
  $$ select month, kind::text, amount, issued_on, comment, created_by from public.payroll_adjustments
     where teacher_id = 'b8300000-0000-4000-8000-000000000001' $$,
  $$ values ('2003-03-01'::date, 'advance', 3000, '2003-03-10'::date, 'на лекарства',
             'a8300000-0000-4000-8000-000000000004'::uuid) $$,
  'the month is that of the issue date, comment trimmed, author — the accountant'
);
select lives_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 1500, '2003-03-28', '2003-04-17') $$,
  'an advance may go to another chosen month'
);
select is(
  (select month from public.payroll_adjustments where amount = 1500
   and teacher_id = 'b8300000-0000-4000-8000-000000000001'),
  '2003-04-01'::date,
  'any day of the chosen month means that month'
);
select lives_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000002', 700) $$,
  'issue date may be omitted'
);
select is(
  (select issued_on from public.payroll_adjustments
   where teacher_id = 'b8300000-0000-4000-8000-000000000002'),
  public.bishkek_today(),
  'issue date defaults to today (Bishkek)'
);
select throws_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 0) $$,
  '23514', null, 'amount 0 is rejected'
);
select throws_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', -500) $$,
  '23514', null, 'a negative amount is rejected'
);
select throws_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 500, public.bishkek_today() + 1) $$,
  '23514', null, 'an advance cannot be dated in the future'
);
select throws_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-0000000000ff', 500) $$,
  '23503', null, 'unknown teacher'
);
select throws_ok(
  $$ insert into public.payroll_adjustments (teacher_id, month, amount, issued_on)
     values ('b8300000-0000-4000-8000-000000000001', '2003-03-01', 100, '2003-03-01') $$,
  '42501', null, 'no direct insert — only through issue_advance'
);
select is(
  (select count(*)::integer from public.payroll_adjustments
   where teacher_id in ('b8300000-0000-4000-8000-000000000001', 'b8300000-0000-4000-8000-000000000002')),
  3,
  'accountant reads every teacher''s advances'
);

-- ─── Admin issues too ───────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8300000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"roles":["admin"]}}';

select lives_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 2000, '2003-03-15') $$,
  'admin issues an advance'
);

-- ─── v_payroll_preview: advances and to_pay ─────────────────────────────────
select results_eq(
  $$ select lessons_held, base_amount, advances, to_pay from public.v_payroll_preview
     where teacher_id = 'b8300000-0000-4000-8000-000000000001' order by month $$,
  $$ values (0, 0, 5000, -5000), (0, 0, 1500, -1500) $$,
  'a teacher with advances only: a row of zeros, to_pay negative (overpaid)'
);
select lives_ok(
  $$ select public.issue_advance('00000000-0000-4000-a000-000000000001', 10000, '2026-09-20') $$,
  'advance to Гульзат for September 2026'
);
select results_eq(
  $$ select student_lessons, base_amount, advances, to_pay from public.v_payroll_preview
     where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01' $$,
  $$ values (318, 38160, 10000, 28160) $$,
  'seed: Гульзат in September — the accrual stays 38 160, to pay 28 160'
);
select is(
  (select sum(base_amount)::integer from public.v_payroll_preview where month = '2026-09-01'),
  47546,
  'seed: everyone in September — still 47 546 сом accrued'
);

-- ─── Teacher A: own only, cannot write ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8300000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["teacher"]}}';

select is(
  (select count(*)::integer from public.payroll_adjustments), 3,
  'teacher A sees her three advances'
);
select is(
  (select count(*)::integer from public.payroll_adjustments
   where teacher_id <> 'b8300000-0000-4000-8000-000000000001'), 0,
  'teacher A sees nobody else''s advances (seed included)'
);
select is(
  (select sum(advances)::integer from public.v_payroll_preview), 6500,
  'teacher A sees her advances in v_payroll_preview'
);
select throws_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 1000) $$,
  '42501', null, 'teacher cannot issue an advance (even to herself)'
);
select throws_ok(
  $$ select public.delete_payroll_adjustment(
       (select id from public.payroll_adjustments where amount = 3000), 'ошибка') $$,
  '42501', null, 'teacher cannot delete an advance'
);
select is_empty(
  $$ delete from public.payroll_adjustments returning id $$,
  'direct delete removes nothing (no policy)'
);

-- ─── Teacher B ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8300000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"roles":["teacher"]}}';
select results_eq(
  $$ select amount from public.payroll_adjustments $$,
  $$ values (700) $$,
  'teacher B sees only her own advance'
);

-- ─── Delete: reason, journal ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a8300000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"roles":["accountant"]}}';

select throws_ok(
  $$ select public.delete_payroll_adjustment(
       (select id from public.payroll_adjustments where amount = 3000), '   ') $$,
  '23514', null, 'delete needs a reason'
);
select throws_ok(
  $$ select public.delete_payroll_adjustment('b8300000-0000-4000-8000-0000000000ff', 'нет такой') $$,
  'P0002', null, 'deleting a missing entry'
);
select lives_ok(
  $$ select public.delete_payroll_adjustment(
       (select id from public.payroll_adjustments where amount = 3000), 'ошиблись суммой') $$,
  'accountant deletes a mistaken advance with a reason'
);
select is(
  (select advances from public.v_payroll_preview
   where teacher_id = 'b8300000-0000-4000-8000-000000000001' and month = '2003-03-01'),
  2000,
  'the deleted advance no longer counts'
);

reset role;
select results_eq(
  $$ select action, actor_id, reason, kind from public.audit_log
     where entity = 'payroll_adjustments' and before ->> 'amount' = '3000' $$,
  $$ values ('delete', 'a8300000-0000-4000-8000-000000000004'::uuid, 'ошиблись суммой', 'payment') $$,
  'audit_log: the delete with its reason and author, filed under «Оплаты»'
);
select is(
  (select count(*)::integer from public.audit_log
   where entity = 'payroll_adjustments' and action = 'insert'
     and after ->> 'teacher_id' in ('b8300000-0000-4000-8000-000000000001', 'b8300000-0000-4000-8000-000000000002')),
  4,
  'audit_log: every advance issued'
);
select ok(
  (select search from public.v_audit_feed f where f.entity = 'payroll_adjustments' and f.action = 'delete')
    like '%teacher a%',
  'journal search finds the advance by the teacher''s name'
);
select throws_ok(
  $$ update public.payroll_adjustments set amount = 1 $$,
  '42501', null, 'an advance is never edited, not even by the service role'
);

-- ─── Closed month ───────────────────────────────────────────────────────────
-- A locked lesson of Гульзат in September: no new advances there, no deletes.
set session_replication_role = replica;
update public.lessons set is_locked = true
where id = (select id from public.lessons
            where teacher_id = '00000000-0000-4000-a000-000000000001' and lesson_date between '2026-09-01' and '2026-09-30'
            order by planned_start limit 1);
set session_replication_role = origin;

set local role authenticated;
select throws_ok(
  $$ select public.issue_advance('00000000-0000-4000-a000-000000000001', 500, '2026-09-25') $$,
  '23514', null, 'no advance into a closed month'
);
select throws_ok(
  $$ select public.delete_payroll_adjustment(
       (select id from public.payroll_adjustments
        where teacher_id = '00000000-0000-4000-a000-000000000001' and month = '2026-09-01'), 'ошибка') $$,
  '23514', null, 'no delete in a closed month'
);

-- ─── Nobody signed in ───────────────────────────────────────────────────────
set local request.jwt.claims = '';
set local role anon;
select throws_ok(
  $$ select public.issue_advance('b8300000-0000-4000-8000-000000000001', 1000) $$,
  '42501', null, 'anon cannot issue an advance'
);

select * from finish();
rollback;
