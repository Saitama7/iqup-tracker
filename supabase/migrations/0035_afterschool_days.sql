-- #111 · After-school = a package of days for a sum, not hours (К13, revises И58–И63, И65–И66).
--
--   1. A new after-school subscription is a package, like every other type: enroll_student /
--      buy_subscription (enroll_trial calls enroll_student) create lessons_total = N days (default —
--      the tariff's lessons_in_package, 20), price_full = p_price or round(package_price × N / 20)
--      (subscription_default_price, И89), hours_total = null. The student's plan (afterschool_plans,
--      И59) stays: it decides on which days the student is on the lesson roster.
--   2. The monthly hour bill is switched off, not dropped (0 bills on production on 27.10):
--      issue_afterschool_invoice / afterschool_bill_from refuse; v_afterschool_unbilled is empty, so
--      v_student_balance has no unbilled debt and withdraw_enrollment bills nothing (И69); mark_pay
--      no longer prices a mark without a subscription by the hour price — such a mark pays 0 and is
--      «нет абонемента» (v_payroll_preview.no_subscription), as for every package. Existing hour bills
--      (hours_total is not null) keep working as before.
--   3. attendance_subscription: the hour-bill branch only where a bill of that month exists; else the
--      package rule (the oldest active one with lessons left, else the last one «в долг»).
--   4. A mark on a day with 0 h by the plan never consumes (attendance.consumes_credit), whatever its
--      status: neither the student's balance nor the teacher's pay counts it (views read
--      consumes_credit). Production fix (Сайкал, Гусев Артём): such marks made by a plan changed
--      backwards (И68) — consumes_credit becomes false, a journal row each, nothing deleted.
--   5. set_afterschool_plan from a date: marks of the days that become 0 h are deleted (a journal row
--      each, the reason of the plan change). afterschool_plan_preview — what goes: the marks, their
--      weekdays and the teacher's payroll Δ per month (marks_payroll_drop, 0028).
-- Production-safe: functions replaced with the same signatures (the preview — new columns), the
-- generated column's expression changes in place; the only data change is item 4.

-- ─── 4. consumes_credit: a day with 0 h never consumes ──────────────────────

-- the journal rows of the production fix — before the expression changes the rows
do $$
declare
  v_locked integer;
begin
  select count(*) into v_locked
  from public.attendance a
  join public.lessons l on l.id = a.lesson_id
  where a.hours = 0 and a.consumes_credit and l.is_locked;
  if v_locked > 0 then
    raise notice '% marks with 0 h are in a closed period — their payroll changes too', v_locked;
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, before, after, reason)
  select null, 'attendance', a.id, 'update', to_jsonb(a),
         to_jsonb(a) || jsonb_build_object('consumes_credit', false),
         'К13: день без часов по графику'
  from public.attendance a
  where a.hours = 0 and a.consumes_credit;
end;
$$;

-- hours is null outside after-school (and for a student with no plan) — consumes by status, as before
alter table public.attendance
  alter column consumes_credit set expression as (
    status in ('present', 'absent_burned') and coalesce(hours, 1) > 0
  );

comment on column public.attendance.consumes_credit is
  'present / absent_burned, except an after-school day with 0 h by the plan (К13, #111). Same as consumesCredit() in src/features/payroll/calc.ts.';

-- ─── 1. enroll_student: an after-school package of days ─────────────────────

-- Same as 0033; after-school — the plan as before, the subscription a package (p_lessons days,
-- p_price) instead of the month hour bill.
create or replace function public.enroll_student(
  p_student_id uuid,
  p_group_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_plan numeric[] default null,
  p_lessons integer default null,
  p_price integer default null
)
returns table (enrollment_id uuid, subscription_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_group public.groups%rowtype;
  v_tariff public.tariffs%rowtype;
  v_plan numeric[];
  v_enrollment_id uuid;
  v_subscription_id uuid;
  v_lessons integer;
  v_price integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin may enroll students' using errcode = 'insufficient_privilege';
  end if;

  if p_start_date is null then
    raise exception 'start date is required' using errcode = 'check_violation';
  end if;

  if not (
    (p_discount_pct = 0 and p_discount_reason = 'none')
    or (p_discount_pct = 15 and p_discount_reason = 'returning')
    or (p_discount_pct = 5 and p_discount_reason = 'referral')
  ) then
    raise exception 'discount must be 0, 5 %% referral or 15 %% returning'
      using errcode = 'check_violation';
  end if;
  perform public.assert_subscription_price(p_price);

  -- Serialize concurrent enrollments of one student (discount eligibility below).
  select * into v_student from public.students s where s.id = p_student_id for update;
  if not found then
    raise exception 'student % not found', p_student_id using errcode = 'foreign_key_violation';
  end if;

  select * into v_group from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  if p_start_date < v_group.start_date
     or (v_group.end_date is not null and p_start_date > v_group.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.group_id = p_group_id and e.status = 'active'
  ) then
    raise exception 'student is already enrolled in this group' using errcode = 'unique_violation';
  end if;

  perform public.assert_discount(p_student_id, p_discount_pct, p_discount_reason);

  -- Tariff in effect on the start date — same rule as tariffFor() in src/features/tariffs/current.ts.
  select * into v_tariff from public.tariffs t
  where t.group_type = v_group.group_type and t.valid_from <= p_start_date
  order by t.valid_from desc
  limit 1;
  if not found then
    raise exception 'no tariff for % on %', v_group.group_type, p_start_date
      using errcode = 'check_violation';
  end if;

  if v_group.group_type = 'afterschool' then
    v_plan := coalesce(p_plan, public.afterschool_default_plan(p_group_id, p_start_date));
    if not public.afterschool_hours_valid(v_plan) then
      raise exception 'hours must be 7 values of 0 … 4 h, step 0.5' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from unnest(v_plan) x where x > 0) then
      raise exception 'plan has no hours' using errcode = 'check_violation';
    end if;
  elsif p_plan is not null then
    raise exception 'a plan is for after-school groups only' using errcode = 'check_violation';
  end if;

  insert into public.enrollments (student_id, group_id, start_date)
  values (p_student_id, p_group_id, p_start_date)
  returning id into v_enrollment_id;

  if v_group.group_type = 'afterschool' then
    insert into public.afterschool_plans (enrollment_id, valid_from, hours)
    values (v_enrollment_id, p_start_date, v_plan);
  end if;

  v_lessons := coalesce(p_lessons, public.subscription_default_lessons(v_tariff.id, p_group_id));
  v_price := public.subscription_default_price(v_tariff.id, p_group_id, v_lessons);
  v_price := coalesce(p_price, v_price);

  insert into public.subscriptions (
    enrollment_id, tariff_id, lessons_total, price_full,
    discount_percent, discount_reason, price_final, started_at
  )
  values (
    v_enrollment_id, v_tariff.id, v_lessons, v_price,
    p_discount_pct, p_discount_reason,
    round(v_price * (100 - p_discount_pct) / 100.0)::integer,
    p_start_date
  )
  returning id into v_subscription_id;

  return query select v_enrollment_id, v_subscription_id;
end;
$$;

-- ─── 1. buy_subscription: an after-school package of days ───────────────────

-- Same as 0033; after-school — a package like every type (no next-month hour bill).
create or replace function public.buy_subscription(
  p_enrollment_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_paid_on date default null,
  p_comment text default null,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_lessons integer default null,
  p_price integer default null
)
returns table (subscription_id uuid, payment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_student public.students%rowtype;
  v_group public.groups%rowtype;
  v_tariff public.tariffs%rowtype;
  v_start date;
  v_subscription_id uuid;
  v_lessons integer;
  v_price integer;
begin
  perform public.assert_payment_admin();

  if not (
    (p_discount_pct = 0 and p_discount_reason = 'none')
    or (p_discount_pct = 15 and p_discount_reason = 'returning')
    or (p_discount_pct = 5 and p_discount_reason = 'referral')
  ) then
    raise exception 'discount must be 0, 5 %% referral or 15 %% returning' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;
  perform public.assert_subscription_price(p_price);

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  if v_enrollment.status <> 'active' then
    raise exception 'enrollment is finished' using errcode = 'check_violation';
  end if;
  -- Serialize purchases of one student (discount eligibility below), as enroll_student does.
  select * into v_student from public.students s where s.id = v_enrollment.student_id for update;
  select * into v_group from public.groups g where g.id = v_enrollment.group_id;

  perform public.assert_discount(v_student.id, p_discount_pct, p_discount_reason);

  v_start := greatest(
    public.bishkek_today(),
    v_enrollment.start_date,
    coalesce((select max(s.started_at) from public.subscriptions s where s.enrollment_id = p_enrollment_id),
             v_enrollment.start_date)
  );

  select * into v_tariff from public.tariffs t
  where t.group_type = v_group.group_type and t.valid_from <= v_start
  order by t.valid_from desc
  limit 1;
  if not found then
    raise exception 'no tariff for % on %', v_group.group_type, v_start using errcode = 'check_violation';
  end if;

  v_lessons := coalesce(p_lessons, public.subscription_default_lessons(v_tariff.id, v_group.id));
  v_price := public.subscription_default_price(v_tariff.id, v_group.id, v_lessons);
  v_price := coalesce(p_price, v_price);

  insert into public.subscriptions (
    enrollment_id, tariff_id, lessons_total, price_full,
    discount_percent, discount_reason, price_final, started_at
  )
  values (
    p_enrollment_id, v_tariff.id, v_lessons, v_price,
    p_discount_pct, p_discount_reason,
    round(v_price * (100 - p_discount_pct) / 100.0)::integer,
    v_start
  )
  returning id into v_subscription_id;

  return query
  select v_subscription_id,
         public.record_payment(v_subscription_id, p_amount, p_method, p_paid_on, p_comment);
end;
$$;

-- ─── 2. The month hour bill is off ──────────────────────────────────────────

create or replace function public.issue_afterschool_invoice(
  p_enrollment_id uuid,
  p_month date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_from date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'afterschool invoices are disabled (К13)' using errcode = 'check_violation';
end;
$$;

create or replace function public.afterschool_bill_from(p_enrollment_id uuid, p_month date)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  raise exception 'afterschool invoices are disabled (К13)' using errcode = 'check_violation';
end;
$$;

-- Same columns as 0025, no rows: marks without a subscription are «нет абонемента» like every package.
create or replace view public.v_afterschool_unbilled
with (security_invoker = true)
as
select
  e.id as enrollment_id,
  e.student_id,
  e.group_id,
  date_trunc('month', l.lesson_date)::date as month,
  min(l.lesson_date) as first_date,
  count(*)::integer as marks,
  sum(a.hours) as hours,
  ceil(sum(a.hours * coalesce(public.afterschool_hour_price_on(l.lesson_date), 0)))::integer as amount,
  e.status = 'active' as active
from public.attendance a
join public.lessons l on l.id = a.lesson_id
join public.enrollments e
  on e.group_id = l.group_id and e.student_id = a.student_id
  and l.lesson_date >= e.start_date
  and (l.lesson_date <= e.end_date or (e.end_date is null and e.status = 'active'))
where false
group by e.id, date_trunc('month', l.lesson_date);

comment on view public.v_afterschool_unbilled is
  'Switched off by К13 (#111): always empty. Was: after-school hours charged with no invoice (И69).';

-- Same as 0025 without the unbilled branch: no subscription — no pay (calc.ts markPay()).
create or replace function public.mark_pay(
  p_price_full integer,
  p_lessons_total integer,
  p_hours_total numeric,
  p_percent numeric,
  p_hours numeric,
  p_hour_price integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price_full is not null and p_hours_total is null
      then p_price_full * p_percent / (p_lessons_total * 100.0)
    when p_price_full is not null
      then p_price_full * p_percent * coalesce(p_hours, 0) / (p_hours_total * 100.0)
  end;
$$;

-- Same as 0025; no_subscription — every consumed mark without a subscription (no unbilled hours now).
create or replace view public.v_payroll_preview
with (security_invoker = true)
as
with held as (
  select
    l.teacher_id,
    date_trunc('month', l.lesson_date)::date as month,
    l.duration_min,
    m.student_lessons,
    m.no_subscription,
    m.amount,
    m.student_hours
  from public.lessons l
  left join lateral (
    select r.percent
    from public.teacher_rates r
    where r.teacher_id = l.teacher_id and r.valid_from <= l.lesson_date
    order by r.valid_from desc
    limit 1
  ) r on true
  cross join lateral (
    select
      count(*)::integer as student_lessons,
      (count(*) filter (where s.id is null))::integer as no_subscription,
      sum(public.mark_pay(
        s.price_full, s.lessons_total, s.hours_total, r.percent, a.hours,
        public.afterschool_hour_price_on(l.lesson_date)
      )) as amount,
      coalesce(sum(a.hours) filter (where s.hours_total is not null), 0) as student_hours
    from public.attendance a
    left join public.subscriptions s on s.id = a.subscription_id
    where a.lesson_id = l.id and a.consumes_credit
  ) m
  where l.status = 'held'
),
accrued as (
  select
    h.teacher_id,
    h.month,
    count(*)::integer as lessons_held,
    round(sum(h.duration_min) / 60.0, 2) as hours,
    sum(h.student_lessons)::integer as student_lessons,
    round(coalesce(sum(h.amount), 0))::integer as base_amount,
    sum(h.no_subscription)::integer as no_subscription,
    sum(h.student_hours) as student_hours
  from held h
  group by h.teacher_id, h.month
),
adjusted as (
  select
    a.teacher_id,
    a.month,
    (coalesce(sum(a.amount) filter (where a.kind = 'advance'), 0))::integer as advances
  from public.payroll_adjustments a
  group by a.teacher_id, a.month
)
select
  coalesce(ac.teacher_id, ad.teacher_id) as teacher_id,
  coalesce(ac.month, ad.month) as month,
  coalesce(ac.lessons_held, 0) as lessons_held,
  coalesce(ac.hours, 0) as hours,
  coalesce(ac.student_lessons, 0) as student_lessons,
  coalesce(ac.base_amount, 0) as base_amount,
  coalesce(ac.no_subscription, 0) as no_subscription,
  coalesce(ad.advances, 0) as advances,
  coalesce(ac.base_amount, 0) - coalesce(ad.advances, 0) as to_pay,
  coalesce(ac.student_hours, 0) as student_hours
from accrued ac
full join adjusted ad on ad.teacher_id = ac.teacher_id and ad.month = ac.month;

comment on view public.v_payroll_preview is
  'Preliminary payroll per teacher (lessons.teacher_id) and month: accrual priced by subscription (К6; after-school days — a package, К13), legacy hour bills by hours (#82), advances, to_pay = base − advances (#83). Same rules as src/features/payroll/calc.ts.';

-- ─── 3. attendance_subscription: packages for after-school ──────────────────

-- Same as 0025; the month hour bill is taken only where one exists for the lesson's month (legacy),
-- else the package rule: the oldest active package with lessons left, else the last one «в долг».
create or replace function public.attendance_subscription(p_lesson_id uuid, p_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with lesson as (
    select l.id, l.group_id, l.lesson_date from public.lessons l where l.id = p_lesson_id
  ),
  subs as (
    select
      s.id,
      s.status,
      s.started_at,
      s.created_at,
      s.hours_total,
      s.period_month,
      s.lessons_total - (
        select count(*) from public.attendance a
        where a.subscription_id = s.id and a.consumes_credit and a.lesson_id <> p_lesson_id
      ) as lessons_left
    from lesson
    join public.enrollments e on e.group_id = lesson.group_id and e.student_id = p_student_id
    join public.subscriptions s on s.enrollment_id = e.id
    where s.status <> 'refunded'
  )
  select coalesce(
    (select id from subs
     where hours_total is not null
       and period_month = date_trunc('month', lesson.lesson_date)::date
       and started_at <= lesson.lesson_date
     order by created_at desc, id desc
     limit 1),
    (select id from subs where hours_total is null and status = 'active' and lessons_left > 0
     order by started_at, created_at, id limit 1),
    (select id from subs where hours_total is null
     order by started_at desc, created_at desc, id desc limit 1)
  )
  from lesson;
$$;

-- ─── 5. A plan changed from a date: marks of the 0 h days go ────────────────

-- Same as 0025; after the plan is saved, the marks of the enrollment's days from p_valid_from that
-- have 0 h by it are deleted (the journal row of each — the reason of the change); the rest are
-- re-read as before (afterschool_reprice).
create or replace function public.set_afterschool_plan(
  p_enrollment_id uuid,
  p_valid_from date,
  p_hours numeric[],
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_type public.group_type;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may change the plan' using errcode = 'insufficient_privilege';
  end if;
  if not public.afterschool_hours_valid(p_hours) then
    raise exception 'hours must be 7 values of 0 … 4 h, step 0.5' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from unnest(p_hours) x where x > 0) then
    raise exception 'plan has no hours' using errcode = 'check_violation';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reason is too long' using errcode = 'check_violation';
  end if;

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  select g.group_type into v_type from public.groups g where g.id = v_enrollment.group_id;
  if v_type <> 'afterschool' then
    raise exception 'not an after-school group' using errcode = 'check_violation';
  end if;
  if p_valid_from is null or p_valid_from < v_enrollment.start_date
     or (v_enrollment.end_date is not null and p_valid_from > v_enrollment.end_date) then
    raise exception 'date is outside the enrollment' using errcode = 'check_violation';
  end if;
  if p_valid_from < public.bishkek_today() and v_reason = '' then
    raise exception 'reason is required for a date in the past' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.lessons l
    where l.group_id = v_enrollment.group_id
      and l.lesson_date >= p_valid_from
      and l.is_locked
  ) then
    raise exception 'marks from this date are in a closed period' using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', coalesce(nullif(v_reason, ''), 'afterschool_plan'), true);

  insert into public.afterschool_plans (enrollment_id, valid_from, hours)
  values (p_enrollment_id, p_valid_from, p_hours)
  on conflict (enrollment_id, valid_from) do update set hours = excluded.hours
  returning id into v_id;

  delete from public.attendance a
  where a.id in (select m.id from public.afterschool_plan_zero_marks(p_enrollment_id, p_valid_from) m);

  perform public.afterschool_reprice(p_enrollment_id, p_valid_from);

  perform set_config('iqup.audit_reason', '', true);
  return v_id;
end;
$$;

-- Marks of the enrollment from p_valid_from on days with 0 h by the plan in effect (the plan just
-- saved) — the ones set_afterschool_plan deletes. p_hours given — by that plan instead (the preview,
-- before saving; later plan versions still win, afterschool_plan_mark_hours).
create or replace function public.afterschool_plan_zero_marks(
  p_enrollment_id uuid,
  p_valid_from date,
  p_hours numeric[] default null
)
returns table (id uuid, lesson_date date)
language sql
stable
set search_path = ''
as $$
  select a.id, l.lesson_date
  from public.enrollments e
  join public.lessons l on l.group_id = e.group_id
  join public.attendance a on a.lesson_id = l.id and a.student_id = e.student_id
  where e.id = p_enrollment_id
    and l.lesson_date >= p_valid_from
    and l.lesson_date >= e.start_date
    and (e.end_date is null or l.lesson_date <= e.end_date)
    and case
      when p_hours is null then public.afterschool_lesson_hours(l.id, a.student_id)
      else public.afterschool_plan_mark_hours(p_enrollment_id, p_valid_from, p_hours, l.id, a.student_id)
    end = 0;
$$;

revoke execute on function public.afterschool_plan_zero_marks(uuid, date, numeric[]) from public, anon, authenticated;

-- «Изменить с даты» preview (К13): the marks that would be deleted, their ISO weekdays and the
-- teacher's payroll Δ per month (marks_payroll_drop: round(month) − round(month − marks), negative —
-- the teacher loses it). The money of the remaining marks does not depend on hours any more.
drop function public.afterschool_plan_preview(uuid, date, numeric[]);
create function public.afterschool_plan_preview(p_enrollment_id uuid, p_valid_from date, p_hours numeric[])
returns table (marks integer, weekdays integer[], payroll jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform public.assert_admin();
  if not public.afterschool_hours_valid(p_hours) then
    raise exception 'hours must be 7 values of 0 … 4 h, step 0.5' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.enrollments e where e.id = p_enrollment_id) then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;

  select coalesce(array_agg(z.id), '{}') into v_ids
  from public.afterschool_plan_zero_marks(p_enrollment_id, p_valid_from, p_hours) z;

  return query
  select
    cardinality(v_ids),
    coalesce((
      select array_agg(distinct extract(isodow from z.lesson_date)::integer order by extract(isodow from z.lesson_date)::integer)
      from public.afterschool_plan_zero_marks(p_enrollment_id, p_valid_from, p_hours) z
    ), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'teacher_id', d.teacher_id, 'teacher_name', d.teacher_name, 'month', d.month,
        'marks', d.marks, 'amount', -d.amount))
      from public.marks_payroll_drop(v_ids) d
    ), '[]'::jsonb);
end;
$$;

revoke execute on function public.afterschool_plan_preview(uuid, date, numeric[]) from public, anon;
grant execute on function public.afterschool_plan_preview(uuid, date, numeric[]) to authenticated;
