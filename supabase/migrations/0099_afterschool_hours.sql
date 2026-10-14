-- 0099 — Продлёнка по часам (issue #82): гибкий график ученика по дням недели, помесячный абонемент
-- в часах (счёт = часы месяца × цена часа, скидки В5), списание часов по графику, ЗП учителя по часам.
-- Docs: 05-decisions И52–И56, 01-domain-model §3, §5.2, §6.
--
-- Production-safe and idempotent (prod has real data, 14.10):
--   * only additive DDL (new nullable columns, new table, new functions); nothing is deleted;
--   * existing subscriptions (incl. after-school 20-lesson ones) keep their lesson math — the new
--     hour math applies only to subscriptions with hours_total (created by this migration's RPCs);
--   * v_payroll_preview: lesson subscriptions are priced by the very same expression as 0020, so the
--     seed sums (Гульзат 38 160, all 47 546) do not move;
--   * tariffs are not updated (tariffs_guard forbids it): the hour price falls back to
--     package_price / (lessons × duration h) — 7 400 / 60 h = 123 сом/ч — until А9 plans a version
--     with hour_price;
--   * every current after-school enrollment without a plan gets the default one: group weekdays ×
--     tariff duration (3 h), valid from the enrollment start (afterschool_backfill_plans()).
-- enroll_student gets one more argument with a default (p_plan) — old calls keep working.

-- ─── 1. Tariff: price per hour ──────────────────────────────────────────────

alter table public.tariffs add column if not exists hour_price integer check (hour_price > 0);

comment on column public.tariffs.hour_price is
  'After-school price per hour (сом), И52. Null — package_price / (lessons_in_package × duration h).';

-- Price of one after-school hour of a tariff version (И52).
create or replace function public.tariff_hour_price(p_tariff_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    t.hour_price,
    round(t.package_price::numeric * 60 / (t.lessons_in_package * t.lesson_duration_min))::integer
  )
  from public.tariffs t
  where t.id = p_tariff_id;
$$;

-- ─── 2. Student's after-school plan (hours per weekday, from a date) ───────

-- hours[1..7] = ISO weekday (1 = Mon … 7 = Sun): 0 (does not come) or 0,5 … 4 h, step 0,5.
create or replace function public.afterschool_hours_valid(p_hours numeric[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_ndims(p_hours) = 1
    and array_lower(p_hours, 1) = 1
    and array_length(p_hours, 1) = 7
    and not exists (
      select 1 from unnest(p_hours) x
      where x is null or x < 0 or x > 4 or x * 2 <> trunc(x * 2)
    ),
    false
  );
$$;

create table if not exists public.afterschool_plans (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  valid_from date not null,
  hours numeric(3, 1)[] not null check (public.afterschool_hours_valid(hours)),
  created_at timestamptz not null default now(),
  unique (enrollment_id, valid_from)
);

comment on table public.afterschool_plans is
  'After-school plan of an enrollment (И53): hours[ISO weekday], in effect from valid_from until the next version.';

alter table public.afterschool_plans enable row level security;

drop policy if exists afterschool_plans_select on public.afterschool_plans;
create policy afterschool_plans_select on public.afterschool_plans for select to authenticated
  using (public.teaches_enrollment(enrollment_id) or public.is_staff());
-- No write policy: written only by enroll_student / set_afterschool_plan (security definer).

drop trigger if exists audit_log on public.afterschool_plans;
create trigger audit_log after insert or update or delete on public.afterschool_plans
for each row execute function public.write_audit_log();

-- The plan of an enrollment on a date: the latest version with valid_from ≤ date; a date before the
-- first version (enrollment start moved earlier, И45) — the first version.
create or replace function public.afterschool_plan_on(p_enrollment_id uuid, p_date date)
returns numeric[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select p.hours from public.afterschool_plans p
     where p.enrollment_id = p_enrollment_id and p.valid_from <= p_date
     order by p.valid_from desc limit 1),
    (select p.hours from public.afterschool_plans p
     where p.enrollment_id = p_enrollment_id
     order by p.valid_from limit 1)
  );
$$;

-- Planned hours of a student in an after-school group on a date (same enrollment rule as the roster
-- of confirm_lesson). Null — not an after-school group or no plan (lessons as before).
create or replace function public.afterschool_day_hours(p_group_id uuid, p_student_id uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (public.afterschool_plan_on(e.id, p_date))[extract(isodow from p_date)::integer]
  from public.enrollments e
  join public.groups g on g.id = e.group_id
  where e.group_id = p_group_id
    and e.student_id = p_student_id
    and g.group_type = 'afterschool'
    and e.start_date <= p_date
    and (e.end_date >= p_date or (e.end_date is null and e.status = 'active'))
  order by e.start_date desc
  limit 1;
$$;

-- Default plan (И53, prod backfill): the group's weekdays on the date × the tariff duration (3 h);
-- no schedule — Mon–Fri.
create or replace function public.afterschool_default_plan(p_group_id uuid, p_date date)
returns numeric[]
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select coalesce(public.tariff_duration('afterschool', p_date), 180) / 60.0 as hours
  ),
  days as (
    select distinct r.weekday
    from public.schedule_rules r
    where r.group_id = p_group_id
      and r.valid_from <= p_date
      and (r.valid_to is null or r.valid_to >= p_date)
  )
  select array_agg(
    case
      when exists (select 1 from days) then
        case when exists (select 1 from days where days.weekday = d) then least(h.hours, 4) else 0 end
      else case when d <= 5 then least(h.hours, 4) else 0 end
    end
    order by d
  )::numeric[]
  from generate_series(1, 7) d, h
  group by h.hours;
$$;

-- Every after-school enrollment without a plan gets the default one from its start (idempotent).
create or replace function public.afterschool_backfill_plans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.afterschool_plans (enrollment_id, valid_from, hours)
  select e.id, e.start_date, public.afterschool_default_plan(e.group_id, e.start_date)
  from public.enrollments e
  join public.groups g on g.id = e.group_id
  where g.group_type = 'afterschool'
    and not exists (select 1 from public.afterschool_plans p where p.enrollment_id = e.id)
  on conflict (enrollment_id, valid_from) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─── 3. Subscription: monthly invoice in hours ──────────────────────────────

alter table public.subscriptions add column if not exists hours_total numeric(5, 1) check (hours_total > 0);
alter table public.subscriptions add column if not exists period_month date
  check (period_month = date_trunc('month', period_month)::date);
alter table public.subscriptions add column if not exists credit_hours numeric(5, 1) not null default 0
  check (credit_hours >= 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_hours_period_check'
  ) then
    alter table public.subscriptions add constraint subscriptions_hours_period_check
      check ((hours_total is null) = (period_month is null));
  end if;
end;
$$;

-- One live invoice per enrollment and month.
create unique index if not exists subscriptions_enrollment_month_key
  on public.subscriptions (enrollment_id, period_month)
  where period_month is not null and status <> 'refunded';

comment on column public.subscriptions.hours_total is
  'After-school monthly subscription (И54): hours billed for period_month (planned − credit_hours). Null — a lesson package.';
comment on column public.subscriptions.credit_hours is
  'Frozen hours of earlier months taken off this invoice (И55).';

-- ─── 4. Attendance: hours charged by the plan ───────────────────────────────

alter table public.attendance add column if not exists hours numeric(3, 1);

comment on column public.attendance.hours is
  'After-school: planned hours of the student that day (И54), set by attendance_hours from the plan; null — not after-school / no plan.';

-- Always from the plan (insert and any update): neither a teacher nor a client can set it.
create or replace function public.attendance_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select public.afterschool_day_hours(l.group_id, new.student_id, l.lesson_date) into new.hours
  from public.lessons l
  where l.id = new.lesson_id;
  return new;
end;
$$;

drop trigger if exists attendance_hours on public.attendance;
create trigger attendance_hours
before insert or update on public.attendance
for each row execute function public.attendance_hours();

revoke execute on function public.attendance_hours() from public, anon, authenticated;

-- ─── 5. Month quote, credit ─────────────────────────────────────────────────

-- Hours of an enrollment in a month (И54): every non-cancelled lesson day of the group in the month
-- within the enrollment (holidays have no lessons), × the plan hours of that weekday on that day.
-- One row per (weekday, hours): «ПН 2 ч × 4». Security invoker — the caller's RLS.
create or replace function public.afterschool_month_quote(p_enrollment_id uuid, p_month date)
returns table (weekday integer, hours numeric, days integer)
language sql
stable
set search_path = ''
as $$
  with e as (
    select * from public.enrollments where id = p_enrollment_id
  ),
  m as (
    select date_trunc('month', p_month)::date as first_day
  ),
  d as (
    select distinct l.lesson_date
    from e, m, public.lessons l
    where l.group_id = e.group_id
      and l.status <> 'cancelled'
      and l.lesson_date >= greatest(m.first_day, e.start_date)
      and l.lesson_date < (m.first_day + interval '1 month')::date
      and (e.end_date is null or l.lesson_date <= e.end_date)
  ),
  h as (
    select
      d.lesson_date,
      (public.afterschool_plan_on(p_enrollment_id, d.lesson_date))[extract(isodow from d.lesson_date)::integer]
        as hours
    from d
  )
  select extract(isodow from h.lesson_date)::integer, h.hours, count(*)::integer
  from h
  where h.hours > 0
  group by 1, 2
  order by 1, 2;
$$;

-- Frozen hours (absent_frozen on hour subscriptions of the enrollment) not yet taken off an invoice
-- (И55). Security invoker.
create or replace function public.afterschool_credit_hours(p_enrollment_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select greatest(0,
    coalesce((
      select sum(a.hours)
      from public.attendance a
      join public.subscriptions s on s.id = a.subscription_id
      where s.enrollment_id = p_enrollment_id
        and s.hours_total is not null
        and s.status <> 'refunded'
        and a.status = 'absent_frozen'
    ), 0)
    - coalesce((
      select sum(s.credit_hours)
      from public.subscriptions s
      where s.enrollment_id = p_enrollment_id and s.status <> 'refunded'
    ), 0)
  );
$$;

-- ─── 6. Discounts (В5) — the same checks as enroll_student / buy_subscription ─

create or replace function public.assert_discount(
  p_student_id uuid,
  p_discount_pct integer,
  p_discount_reason public.discount_reason
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    (p_discount_pct = 0 and p_discount_reason = 'none')
    or (p_discount_pct = 15 and p_discount_reason = 'returning')
    or (p_discount_pct = 5 and p_discount_reason = 'referral')
  ) then
    raise exception 'discount must be 0, 5 %% referral or 15 %% returning' using errcode = 'check_violation';
  end if;

  if p_discount_reason = 'returning' and (
    not coalesce((select s.is_returning from public.students s where s.id = p_student_id), false)
    or exists (
      select 1 from public.subscriptions s
      join public.enrollments e on e.id = s.enrollment_id
      where e.student_id = p_student_id
    )
  ) then
    raise exception '15 %% applies only to the first subscription of a returning student'
      using errcode = 'check_violation';
  end if;

  if p_discount_reason = 'referral' and (
    select count(*) from public.students f where f.referred_by_student_id = p_student_id
  ) <= (
    select count(*) from public.subscriptions s
    join public.enrollments e on e.id = s.enrollment_id
    where e.student_id = p_student_id and s.discount_reason = 'referral'
  ) then
    raise exception '5 %% applies once per friend brought' using errcode = 'check_violation';
  end if;
end;
$$;

-- ─── 7. Invoice of a month ──────────────────────────────────────────────────

-- Core (no role check — callers check): the hour subscription of p_month for an after-school
-- enrollment. hours = planned hours of the month − credit (frozen hours of earlier months); price
-- = hours × hour price of the tariff on the first billed day; discount as В5. Null when the month has
-- no planned hours and p_strict is false.
create or replace function public.afterschool_invoice_insert(
  p_enrollment_id uuid,
  p_month date,
  p_discount_pct integer,
  p_discount_reason public.discount_reason,
  p_strict boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_group public.groups%rowtype;
  v_tariff public.tariffs%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_start date;
  v_planned numeric;
  v_days integer;
  v_credit numeric;
  v_hours numeric;
  v_price integer;
  v_id uuid;
begin
  if p_month is null then
    raise exception 'month is required' using errcode = 'check_violation';
  end if;

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  if v_enrollment.status <> 'active' then
    raise exception 'enrollment is finished' using errcode = 'check_violation';
  end if;
  select * into v_group from public.groups g where g.id = v_enrollment.group_id;
  if v_group.group_type <> 'afterschool' then
    raise exception 'not an after-school group' using errcode = 'check_violation';
  end if;
  if v_month < date_trunc('month', v_enrollment.start_date)::date
     or (v_enrollment.end_date is not null and v_month > v_enrollment.end_date) then
    raise exception 'month is outside the enrollment' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.afterschool_plans p where p.enrollment_id = p_enrollment_id) then
    raise exception 'no after-school plan' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.subscriptions s
    where s.enrollment_id = p_enrollment_id and s.status <> 'refunded' and s.period_month = v_month
  ) then
    raise exception 'month % is already invoiced', to_char(v_month, 'YYYY-MM') using errcode = 'unique_violation';
  end if;
  if exists (
    select 1 from public.subscriptions s
    where s.enrollment_id = p_enrollment_id and s.status <> 'refunded' and s.period_month > v_month
  ) then
    raise exception 'a later month is already invoiced' using errcode = 'check_violation';
  end if;

  perform public.assert_discount(v_enrollment.student_id, p_discount_pct, p_discount_reason);

  -- the month's lessons must exist to be counted (the generator is idempotent)
  perform public.generate_lessons(v_group.id, (v_month + interval '1 month' - interval '1 day')::date);

  select coalesce(sum(q.hours * q.days), 0), coalesce(sum(q.days), 0)::integer
  into v_planned, v_days
  from public.afterschool_month_quote(p_enrollment_id, v_month) q;
  if v_planned <= 0 then
    if not p_strict then
      return null;
    end if;
    raise exception 'no planned hours in %', to_char(v_month, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  v_credit := least(public.afterschool_credit_hours(p_enrollment_id), v_planned);
  v_hours := v_planned - v_credit;
  if v_hours <= 0 then
    raise exception 'credit covers the month' using errcode = 'check_violation';
  end if;

  v_start := greatest(v_month, v_enrollment.start_date);
  select * into v_tariff from public.tariffs t
  where t.group_type = 'afterschool' and t.valid_from <= v_start
  order by t.valid_from desc
  limit 1;
  if not found then
    raise exception 'no tariff for afterschool on %', v_start using errcode = 'check_violation';
  end if;

  v_price := round(v_hours * public.tariff_hour_price(v_tariff.id))::integer;

  insert into public.subscriptions (
    enrollment_id, tariff_id, lessons_total, price_full,
    discount_percent, discount_reason, price_final, started_at,
    hours_total, period_month, credit_hours
  )
  values (
    p_enrollment_id, v_tariff.id, v_days, v_price,
    p_discount_pct, p_discount_reason,
    round(v_price * (100 - p_discount_pct) / 100.0)::integer,
    v_start, v_hours, v_month, v_credit
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- «Выставить счёт за ноябрь» (А6): admin only, no payment — paid with record_payment.
create or replace function public.issue_afterschool_invoice(
  p_enrollment_id uuid,
  p_month date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_payment_admin();
  -- serialize with other purchases of the student (discount eligibility)
  perform 1 from public.students s
  join public.enrollments e on e.student_id = s.id
  where e.id = p_enrollment_id
  for update of s;
  return public.afterschool_invoice_insert(p_enrollment_id, p_month, p_discount_pct, p_discount_reason, true);
end;
$$;

-- «Изменить с даты» (А6): a plan version from p_valid_from (same date — replaced). Marks from that
-- date are re-priced by the new plan (attendance_hours); not in a closed period (invariant 2).
-- Invoices already issued stay as they are (И56).
create or replace function public.set_afterschool_plan(
  p_enrollment_id uuid,
  p_valid_from date,
  p_hours numeric[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_type public.group_type;
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
  if exists (
    select 1 from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    where l.group_id = v_enrollment.group_id and a.student_id = v_enrollment.student_id
      and l.lesson_date >= p_valid_from and l.is_locked
  ) then
    raise exception 'marks from this date are in a closed period' using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'afterschool_plan', true);

  insert into public.afterschool_plans (enrollment_id, valid_from, hours)
  values (p_enrollment_id, p_valid_from, p_hours)
  on conflict (enrollment_id, valid_from) do update set hours = excluded.hours
  returning id into v_id;

  -- re-price the marks from that date (the trigger recomputes hours from the plan)
  update public.attendance a set hours = null
  from public.lessons l
  where l.id = a.lesson_id
    and l.group_id = v_enrollment.group_id
    and a.student_id = v_enrollment.student_id
    and l.lesson_date >= p_valid_from
    and a.hours is distinct from public.afterschool_day_hours(l.group_id, a.student_id, l.lesson_date);

  perform set_config('iqup.audit_reason', '', true);
  return v_id;
end;
$$;

-- ─── 8. enroll_student: after-school — plan + the first monthly invoice ─────

-- Same as 0007 plus p_plan (hours[ISO weekday], null — the default plan). After-school: the plan from
-- the start date and the hour subscription of the start month (or the next one, when the start month
-- has no planned hours left) instead of a 20-lesson package; the discount goes to that invoice.
drop function if exists public.enroll_student(uuid, uuid, date, integer, public.discount_reason);

create or replace function public.enroll_student(
  p_student_id uuid,
  p_group_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_plan numeric[] default null
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

    v_subscription_id := public.afterschool_invoice_insert(
      v_enrollment_id, p_start_date, p_discount_pct, p_discount_reason, false);
    if v_subscription_id is null then
      v_subscription_id := public.afterschool_invoice_insert(
        v_enrollment_id, (date_trunc('month', p_start_date) + interval '1 month')::date,
        p_discount_pct, p_discount_reason, true);
    end if;
  else
    insert into public.subscriptions (
      enrollment_id, tariff_id, lessons_total, price_full,
      discount_percent, discount_reason, price_final, started_at
    )
    values (
      v_enrollment_id, v_tariff.id, v_tariff.lessons_in_package, v_tariff.package_price,
      p_discount_pct, p_discount_reason,
      round(v_tariff.package_price * (100 - p_discount_pct) / 100.0)::integer,
      p_start_date
    )
    returning id into v_subscription_id;
  end if;

  return query select v_enrollment_id, v_subscription_id;
end;
$$;

-- ─── 9. buy_subscription: after-school — the next month's invoice ───────────

-- Same as 0016; an after-school enrollment gets the invoice of the month after the last invoiced one
-- (none yet — the current month or the enrollment's first) instead of a 20-lesson package.
create or replace function public.buy_subscription(
  p_enrollment_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_paid_on date default null,
  p_comment text default null,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none'
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
  v_month date;
  v_subscription_id uuid;
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

  if v_group.group_type = 'afterschool' then
    v_month := coalesce(
      (select (max(s.period_month) + interval '1 month')::date from public.subscriptions s
       where s.enrollment_id = p_enrollment_id and s.status <> 'refunded'),
      date_trunc('month', greatest(public.bishkek_today(), v_enrollment.start_date))::date
    );
    v_subscription_id := public.afterschool_invoice_insert(
      p_enrollment_id, v_month, p_discount_pct, p_discount_reason, true);
  else
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

    insert into public.subscriptions (
      enrollment_id, tariff_id, lessons_total, price_full,
      discount_percent, discount_reason, price_final, started_at
    )
    values (
      p_enrollment_id, v_tariff.id, v_tariff.lessons_in_package, v_tariff.package_price,
      p_discount_pct, p_discount_reason,
      round(v_tariff.package_price * (100 - p_discount_pct) / 100.0)::integer,
      v_start
    )
    returning id into v_subscription_id;
  end if;

  return query
  select v_subscription_id,
         public.record_payment(v_subscription_id, p_amount, p_method, p_paid_on, p_comment);
end;
$$;

-- ─── 10. Which subscription a mark goes to: units ───────────────────────────

-- Same as 0010, «left» in the subscription's units: lessons, or hours for an hour subscription.
create or replace function public.attendance_subscription(p_lesson_id uuid, p_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with lesson as (
    select l.id, l.group_id from public.lessons l where l.id = p_lesson_id
  ),
  subs as (
    select
      s.id,
      s.status,
      s.started_at,
      s.created_at,
      coalesce(s.hours_total, s.lessons_total) - (
        select case when s.hours_total is null then count(*) else coalesce(sum(a.hours), 0) end
        from public.attendance a
        where a.subscription_id = s.id and a.consumes_credit and a.lesson_id <> p_lesson_id
      ) as lessons_left
    from lesson
    join public.enrollments e on e.group_id = lesson.group_id and e.student_id = p_student_id
    join public.subscriptions s on s.enrollment_id = e.id
    where s.status <> 'refunded'
  )
  select coalesce(
    (select id from subs where status = 'active' and lessons_left > 0
     order by started_at, created_at, id limit 1),
    (select id from subs order by started_at desc, created_at desc, id desc limit 1)
  );
$$;

-- ─── 11. confirm_lesson: a student with 0 h that day is not on the roster ───

-- Same as 0020; after-school students whose plan has no hours on the lesson's weekday are not
-- expected (И53) — no mark, nothing charged.
create or replace function public.confirm_lesson(p_lesson_id uuid, p_marks jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_mark jsonb;
  v_student uuid;
  v_status public.attendance_status;
  v_roster uuid[];
  v_seen uuid[] := '{}';
  v_missing uuid;
  v_confirmed_at timestamptz;
begin
  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;

  if auth.uid() is not null and not public.is_admin() and not public.teaches_lesson(p_lesson_id) then
    raise exception 'only the lesson''s teacher or an admin may confirm a lesson'
      using errcode = 'insufficient_privilege';
  end if;

  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status = 'held' then
    raise exception 'lesson % is already confirmed', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'planned' then
    raise exception 'lesson % is cancelled', p_lesson_id using errcode = 'check_violation';
  end if;

  if p_marks is null or jsonb_typeof(p_marks) <> 'array' then
    raise exception 'marks must be a json array' using errcode = 'check_violation';
  end if;

  -- Enrolled on the lesson date; an enrollment finished without end_date is not; after-school —
  -- with hours that day (no plan — as before).
  v_roster := array(
    select distinct e.student_id
    from public.enrollments e
    where e.group_id = v_lesson.group_id
      and e.start_date <= v_lesson.lesson_date
      and (e.end_date >= v_lesson.lesson_date or (e.end_date is null and e.status = 'active'))
      and coalesce(public.afterschool_day_hours(v_lesson.group_id, e.student_id, v_lesson.lesson_date), 1) > 0
  );

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    begin
      v_student := (v_mark ->> 'student_id')::uuid;
      v_status := (v_mark ->> 'status')::public.attendance_status;
    exception when invalid_text_representation then
      raise exception 'invalid mark %', v_mark using errcode = 'check_violation';
    end;
    if v_student is null or v_status is null then
      raise exception 'invalid mark %', v_mark using errcode = 'check_violation';
    end if;
    if v_student = any (v_seen) then
      raise exception 'student % is marked twice', v_student using errcode = 'check_violation';
    end if;
    if not v_student = any (v_roster) then
      raise exception 'student % is not enrolled in the group on %', v_student, v_lesson.lesson_date
        using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_student;
  end loop;

  select r into v_missing from unnest(v_roster) r where r <> all (v_seen) limit 1;
  if v_missing is not null then
    raise exception 'student % is not marked', v_missing using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'confirm_lesson', true);

  delete from public.attendance a
  where a.lesson_id = p_lesson_id and a.student_id <> all (v_seen);

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    v_student := (v_mark ->> 'student_id')::uuid;
    v_status := (v_mark ->> 'status')::public.attendance_status;
    insert into public.attendance (lesson_id, student_id, subscription_id, status)
    values (p_lesson_id, v_student, public.attendance_subscription(p_lesson_id, v_student), v_status)
    on conflict (lesson_id, student_id) do update
      set status = excluded.status, subscription_id = excluded.subscription_id;
  end loop;

  update public.lessons set status = 'held' where id = p_lesson_id
  returning confirmed_at into v_confirmed_at;

  perform set_config('iqup.audit_reason', '', true);
  return v_confirmed_at;
end;
$$;

-- ─── 12. v_payroll_preview: hour subscriptions priced by hours ──────────────

-- Same as 0020. A mark on an hour subscription pays price_full × hours / hours_total × percent
-- (И56: the hour price of the subscription, not of the tariff on the lesson date — К6); lesson
-- subscriptions — the very same expression as before. student_hours — Σ hours of those marks.
-- Same rules as calcMonth() in src/features/payroll/calc.ts — tests/integration/payroll.test.ts.
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
      (count(*) - count(s.id))::integer as no_subscription,
      sum(
        case
          when s.hours_total is null then s.price_full * r.percent / (s.lessons_total * 100.0)
          else s.price_full * r.percent * coalesce(a.hours, 0) / (s.hours_total * 100.0)
        end
      ) as amount,
      coalesce(sum(a.hours) filter (where s.hours_total is not null), 0) as student_hours
    from public.attendance a
    left join public.subscriptions s on s.id = a.subscription_id
    where a.lesson_id = l.id and a.consumes_credit
  ) m
  where l.status = 'held'
)
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
group by h.teacher_id, h.month;

comment on view public.v_payroll_preview is
  'Preliminary payroll per teacher (lessons.teacher_id) and month: priced by subscription, hour subscriptions by hours (#82). Same rules as src/features/payroll/calc.ts.';

revoke all on public.v_payroll_preview from anon;

-- ─── 13. v_student_balance: units (lessons or hours) ────────────────────────

-- Same as 0016 in «units»: lessons of a package, hours of a monthly after-school subscription
-- (paid hours floor to 0,5 h). Debt carries only between subscriptions of the same unit
-- (an old 20-lesson package does not carry into hours); is_current — the newest live one of the
-- student in the group. Column types widen to numeric (hours have halves) — drop and create.
drop view if exists public.v_student_balance;

create view public.v_student_balance
with (security_invoker = true)
as
with subs as (
  select
    s.id as subscription_id,
    s.enrollment_id,
    e.student_id,
    e.group_id,
    s.status,
    s.started_at,
    s.created_at,
    case when s.hours_total is null then 'lesson' else 'hour' end as unit,
    coalesce(s.hours_total, s.lessons_total)::numeric as lessons_total,
    s.price_full,
    s.price_final,
    t.freeze_limit,
    case
      when s.hours_total is null then
        (select count(*) from public.attendance a
         where a.subscription_id = s.id and a.consumes_credit)::numeric
      else
        coalesce((select sum(a.hours) from public.attendance a
         where a.subscription_id = s.id and a.consumes_credit), 0)
    end as used_own,
    (select count(*) from public.attendance a
     where a.subscription_id = s.id and a.status = 'absent_frozen')::integer as freezes_used,
    coalesce((select sum(p.amount) from public.payments p where p.subscription_id = s.id), 0)::integer
      as paid_som,
    s.hours_total,
    s.period_month,
    s.credit_hours
  from public.subscriptions s
  join public.enrollments e on e.id = s.enrollment_id
  join public.tariffs t on t.id = s.tariff_id
),
paid as (
  select
    subs.*,
    case
      when price_final = 0 then lessons_total
      when unit = 'hour' then floor(greatest(paid_som, 0) * lessons_total * 2 / price_final) / 2
      else (greatest(paid_som, 0)::bigint * lessons_total::bigint / price_final)::numeric
    end as paid_lessons
  from subs
),
chain as (
  -- prefix = Σ (used_own − capacity) of the earlier subscriptions of the same unit in the group
  select
    paid.*,
    coalesce(sum(used_own - greatest(lessons_total, paid_lessons)) over (
      partition by student_id, group_id, unit order by started_at, created_at, subscription_id
      rows between unbounded preceding and 1 preceding
    ), 0) as prefix,
    row_number() over (
      partition by student_id, group_id, unit order by started_at desc, created_at desc, subscription_id desc
    ) = 1 as is_last,
    row_number() over (
      partition by student_id, group_id order by started_at desc, created_at desc, subscription_id desc
    ) = 1 as is_newest
  from paid
  where status <> 'refunded'
),
carried as (
  -- Lindley: carry_k = max(0, carry_{k-1} + used_{k-1} − capacity_{k-1}) = prefix_k − min(prefix_0..k)
  select
    chain.*,
    prefix - min(prefix) over (
      partition by student_id, group_id, unit order by started_at, created_at, subscription_id
      rows between unbounded preceding and current row
    ) as carried_in
  from chain
),
used as (
  select
    carried.subscription_id, carried.carried_in, carried.is_newest,
    case
      when is_last then used_own + carried_in
      else least(used_own + carried_in, greatest(lessons_total, paid_lessons))
    end as lessons_used
  from carried
),
balance as (
  select
    paid.*,
    coalesce(used.carried_in, 0) as carried_in,
    coalesce(used.is_newest, false) as is_current,
    coalesce(used.lessons_used, paid.used_own) as lessons_used
  from paid
  left join used on used.subscription_id = paid.subscription_id
)
select
  subscription_id,
  enrollment_id,
  student_id,
  group_id,
  status,
  started_at,
  lessons_total,
  price_full,
  price_final,
  paid_som,
  paid_lessons,
  used_own,
  carried_in,
  lessons_used,
  lessons_total - lessons_used as lessons_left,
  case when status = 'refunded' then 0 else greatest(0, lessons_used - paid_lessons) end
    as debt_lessons,
  case
    when status = 'refunded' or lessons_used <= paid_lessons then 0
    else greatest(0, ceil(
      (lessons_used * price_final - paid_som::numeric * lessons_total) / lessons_total
    ))::integer
  end as debt_som,
  case
    when status = 'refunded' then 0
    else round(
      greatest(0, least(paid_lessons, lessons_total) - lessons_used) * price_final / lessons_total
    )::integer
  end as refund_suggested,
  freezes_used,
  freeze_limit,
  is_current,
  unit,
  hours_total,
  period_month,
  credit_hours
from balance;

comment on view public.v_student_balance is
  'Per subscription: paid / used / debt / refund (В7, В7.1, В8, И37) in units — lessons, or hours of an after-school month (#82). Same as src/features/payments/balance.ts.';

revoke all on public.v_student_balance from anon;
revoke insert, update, delete on public.v_student_balance from authenticated;
grant select on public.v_student_balance to authenticated;

-- ─── 14. Journal search: plans ──────────────────────────────────────────────

-- Same as 0019 plus afterschool_plans (found by the student and the group).
create or replace function public.audit_search_text(p_entity text, p_entity_id uuid, p_row jsonb)
returns text
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  v_student uuid;
  v_group uuid;
  v_teacher uuid;
  v_enrollment uuid;
  v_lead text;
begin
  case p_entity
    when 'attendance' then
      v_student := (p_row ->> 'student_id')::uuid;
      select l.group_id into v_group from public.lessons l where l.id = (p_row ->> 'lesson_id')::uuid;
    when 'lessons' then
      v_group := (p_row ->> 'group_id')::uuid;
      v_teacher := (p_row ->> 'substitute_teacher_id')::uuid;
    when 'enrollments' then
      v_student := (p_row ->> 'student_id')::uuid;
      v_group := (p_row ->> 'group_id')::uuid;
    when 'subscriptions' then
      v_enrollment := (p_row ->> 'enrollment_id')::uuid;
    when 'afterschool_plans' then
      v_enrollment := (p_row ->> 'enrollment_id')::uuid;
    when 'payments' then
      select s.enrollment_id into v_enrollment
      from public.subscriptions s where s.id = (p_row ->> 'subscription_id')::uuid;
    when 'teacher_rates' then
      v_teacher := (p_row ->> 'teacher_id')::uuid;
    when 'trials' then
      v_student := (p_row ->> 'student_id')::uuid;
      v_group := (p_row ->> 'group_id')::uuid;
      v_lead := p_row ->> 'full_name';
    when 'groups' then
      v_group := p_entity_id;
    else
      return null;
  end case;

  if v_enrollment is not null then
    select e.student_id, e.group_id into v_student, v_group
    from public.enrollments e where e.id = v_enrollment;
  end if;

  return nullif(public.person_name_key(concat_ws(' | ',
    (select s.full_name from public.students s where s.id = v_student),
    v_lead,
    (select concat_ws(' | ', g.name, sj.name, t.full_name)
     from public.groups g
     left join public.subjects sj on sj.id = g.subject_id
     left join public.teachers t on t.id = g.teacher_id
     where g.id = v_group),
    (select t.full_name from public.teachers t where t.id = v_teacher)
  )), '');
end;
$$;

-- ─── 15. Grants ─────────────────────────────────────────────────────────────

revoke execute on function public.afterschool_backfill_plans() from public, anon, authenticated;
revoke execute on function public.afterschool_invoice_insert(uuid, date, integer, public.discount_reason, boolean)
from public, anon, authenticated;
revoke execute on function public.assert_discount(uuid, integer, public.discount_reason)
from public, anon, authenticated;
revoke execute on function public.afterschool_default_plan(uuid, date) from public, anon;
grant execute on function public.afterschool_default_plan(uuid, date) to authenticated;
revoke execute on function public.afterschool_day_hours(uuid, uuid, date) from public, anon;
grant execute on function public.afterschool_day_hours(uuid, uuid, date) to authenticated;

revoke execute on function public.tariff_hour_price(uuid) from public, anon;
grant execute on function public.tariff_hour_price(uuid) to authenticated;
revoke execute on function public.afterschool_hours_valid(numeric[]) from public, anon;
grant execute on function public.afterschool_hours_valid(numeric[]) to authenticated;
revoke execute on function public.afterschool_plan_on(uuid, date) from public, anon;
grant execute on function public.afterschool_plan_on(uuid, date) to authenticated;
revoke execute on function public.afterschool_month_quote(uuid, date) from public, anon;
grant execute on function public.afterschool_month_quote(uuid, date) to authenticated;
revoke execute on function public.afterschool_credit_hours(uuid) from public, anon;
grant execute on function public.afterschool_credit_hours(uuid) to authenticated;

revoke execute on function public.issue_afterschool_invoice(uuid, date, integer, public.discount_reason)
from public, anon;
grant execute on function public.issue_afterschool_invoice(uuid, date, integer, public.discount_reason)
to authenticated;
revoke execute on function public.set_afterschool_plan(uuid, date, numeric[]) from public, anon;
grant execute on function public.set_afterschool_plan(uuid, date, numeric[]) to authenticated;
revoke execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[])
from public, anon;
grant execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[])
to authenticated;

-- ─── 16. Prod: default plans for current after-school students ──────────────

select public.afterschool_backfill_plans();
