-- 0025 — Продлёнка по часам (issue #82): гибкий график ученика по дням недели, помесячный абонемент
-- в часах (счёт = часы месяца × цена часа, скидки В5), списание часов по графику, ЗП учителя по часам.
-- Docs: 05-decisions И58–И63, 01-domain-model §3, §5.2, §6.
--
-- Production-safe and idempotent (prod has real data, 14.10):
--   * only additive DDL (new nullable columns, new table, new functions); nothing is deleted;
--   * existing subscriptions (incl. after-school 20-lesson ones) keep their lesson math — the new
--     hour math applies only to subscriptions with hours_total (created by this migration's RPCs);
--   * v_payroll_preview: lesson subscriptions are priced by the very same expression as 0020/0022, so
--     the seed sums (Гульзат 38 160, all 47 546) do not move;
--   * every create or replace starts from the latest body (0023 confirm_lesson / audit_search_text /
--     attendance_presets_guard, 0021 assert_correction_marks, 0022 v_payroll_preview, 0024
--     v_student_balance / settlement / payroll impact / transfer) — requires 0022 (#83), 0023 (#84)
--     and 0024 (#81);
--   * #81 × hours: «Ушёл» / «Записан по ошибке» count hours at the hour price, a transfer from or to
--     an after-school group refuses («Ушёл» with a refund + a new enrollment);
--   * tariffs are not updated (tariffs_guard forbids it): the hour price falls back to
--     package_price / (lessons × duration h) — 7 400 / 60 h = 123 сом/ч — until А9 plans a version
--     with hour_price;
--   * every current after-school enrollment without a plan gets the default one: group weekdays ×
--     tariff duration (3 h), valid from the enrollment start (afterschool_backfill_plans()).
-- enroll_student gets one more argument with a default (p_plan) — old calls keep working.

-- ─── 1. Tariff: price per hour ──────────────────────────────────────────────

alter table public.tariffs add column if not exists hour_price integer check (hour_price > 0);

comment on column public.tariffs.hour_price is
  'After-school price per hour (сом), И58. Null — package_price / (lessons_in_package × duration h).';

-- Price of one after-school hour of a tariff version (И58).
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
  'After-school plan of an enrollment (И59): hours[ISO weekday], in effect from valid_from until the next version.';

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

-- Default plan (И59, prod backfill): the group's weekdays on the date × the tariff duration (3 h);
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
  'After-school monthly subscription (И60): hours billed for period_month (planned − credit_hours). Null — a lesson package.';
comment on column public.subscriptions.credit_hours is
  'Frozen hours of earlier months taken off this invoice (И61).';

-- ─── 4. Attendance: hours charged by the plan ───────────────────────────────

alter table public.attendance add column if not exists hours numeric(3, 1);

comment on column public.attendance.hours is
  'After-school: planned hours of the student that day (И60), set by attendance_hours from the plan; null — not after-school / no plan.';

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

-- Hours of an enrollment in a month (И60): every non-cancelled lesson day of the group in the month
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
-- (И61). Security invoker.
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
-- Invoices already issued stay as they are (И60).
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

-- Same as 0023 (#84: the admin's presets fill unmarked students); after-school students whose plan
-- has no hours on the lesson's weekday are not expected (И59) — no mark, no preset, nothing charged.
create or replace function public.confirm_lesson(p_lesson_id uuid, p_marks jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_marks jsonb;
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

  -- #84: the admin's «Заморозка» set in advance for whoever is left unmarked.
  v_marks := p_marks || coalesce((
    select jsonb_agg(jsonb_build_object('student_id', p.student_id, 'status', p.status))
    from public.attendance_presets p
    where p.lesson_id = p_lesson_id
      and p.student_id = any (v_roster)
      and p.student_id <> all (v_seen)
  ), '[]'::jsonb);
  v_seen := v_seen || array(
    select p.student_id from public.attendance_presets p
    where p.lesson_id = p_lesson_id and p.student_id = any (v_roster) and p.student_id <> all (v_seen)
  );

  select r into v_missing from unnest(v_roster) r where r <> all (v_seen) limit 1;
  if v_missing is not null then
    raise exception 'student % is not marked', v_missing using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'confirm_lesson', true);

  delete from public.attendance a
  where a.lesson_id = p_lesson_id and a.student_id <> all (v_seen);

  for v_mark in select * from jsonb_array_elements(v_marks) loop
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

-- ─── 11b. Freeze in advance (#84, 0023): the same roster rule ──────────────

-- Same as 0023; a preset for an after-school student also needs hours that day by the plan
-- (confirm_lesson would ignore it, and the day is not charged anyway). A plan changed later to 0 h
-- leaves the preset in place — confirm_lesson skips the student, nothing is written.
create or replace function public.attendance_presets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_sub uuid;
  v_limit integer;
  v_used integer;
begin
  -- a deleted lesson / student takes its presets along: the FK cascade runs after the parent row
  -- is gone, so a missing parent means a cascade — before the role check (the admin deletes a
  -- student, the service role a lesson)
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.lessons l where l.id = old.lesson_id)
    or not exists (select 1 from public.students s where s.id = old.student_id)
  ) then
    return old;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may set a freeze in advance' using errcode = 'insufficient_privilege';
  end if;

  -- «Снять»: until the lesson is held (a held lesson keeps its history), a cancelled one too;
  -- never in a closed period (invariant 2)
  if tg_op = 'DELETE' then
    select * into v_lesson from public.lessons l where l.id = old.lesson_id;
    if v_lesson.is_locked then
      raise exception 'lesson % is in a closed period', old.lesson_id using errcode = 'check_violation';
    end if;
    if v_lesson.status = 'held' then
      raise exception 'lesson % is held — the preset stays', old.lesson_id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into v_lesson from public.lessons l where l.id = new.lesson_id;
  if not found then
    raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
  end if;
  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', new.lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'planned' then
    raise exception 'lesson % is not planned', new.lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.lesson_date < public.bishkek_today() then
    raise exception 'lesson % is in the past', new.lesson_id using errcode = 'check_violation';
  end if;
  -- after the planned start it is not «in advance» anymore — the teacher marks (И56)
  if now() >= (v_lesson.lesson_date + v_lesson.planned_start) at time zone 'Asia/Bishkek' then
    raise exception 'lesson % has already started', new.lesson_id using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.lesson_id <> old.lesson_id or new.student_id <> old.student_id) then
    raise exception 'a preset cannot move to another lesson or student' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.group_id = v_lesson.group_id and e.student_id = new.student_id
      and e.start_date <= v_lesson.lesson_date
      and (e.end_date >= v_lesson.lesson_date or (e.end_date is null and e.status = 'active'))
  ) then
    raise exception 'student % is not enrolled in the group on %', new.student_id, v_lesson.lesson_date
      using errcode = 'check_violation';
  end if;
  -- #82: an after-school student with 0 h by the plan that day is not on the roster (confirm_lesson)
  -- — nothing to freeze (И63)
  if coalesce(public.afterschool_day_hours(v_lesson.group_id, new.student_id, v_lesson.lesson_date), 1) = 0 then
    raise exception 'student % has no after-school hours on %', new.student_id, v_lesson.lesson_date
      using errcode = 'check_violation';
  end if;

  -- В2: frozen marks of the subscription this lesson goes to + presets of other planned lessons that
  -- go to the same one. Same message as enforce_freeze_limit (0001) — the client maps it.
  v_sub := public.attendance_subscription(new.lesson_id, new.student_id);
  if v_sub is not null then
    select t.freeze_limit into v_limit
    from public.subscriptions s
    join public.tariffs t on t.id = s.tariff_id
    where s.id = v_sub
    for update of s;

    select
      (select count(*) from public.attendance a
       where a.subscription_id = v_sub and a.status = 'absent_frozen' and a.lesson_id <> new.lesson_id)
      + (select count(*) from public.attendance_presets p
         join public.lessons l on l.id = p.lesson_id
         where p.student_id = new.student_id
           and p.lesson_id <> new.lesson_id
           and l.status = 'planned'
           and public.attendance_subscription(p.lesson_id, p.student_id) = v_sub)
    into v_used;

    if v_used >= v_limit then
      raise exception 'freeze limit (%) exceeded for subscription %', v_limit, v_sub
        using errcode = 'check_violation', hint = 'mark as absent_burned';
    end if;
  end if;

  new.status := 'absent_frozen';
  new.comment := nullif(btrim(new.comment), '');
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- ─── 11a. Corrections (#74, 0021): the same roster rule ─────────────────────

-- Same as 0021; a new mark for an after-school student also needs hours that day (confirm_lesson).
-- correct_attendance itself is unchanged: attendance.hours comes from the plan (attendance_hours on
-- every insert/update), so a fixed mark charges / gives back the day's hours, and the teacher's pay
-- by hours follows from v_payroll_preview; frozen hours go to the credit (afterschool_credit_hours).
create or replace function public.assert_correction_marks(p_lesson_id uuid, p_marks jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_mark jsonb;
  v_student uuid;
  v_status public.attendance_status;
  v_seen uuid[] := '{}';
begin
  select * into v_lesson from public.lessons l where l.id = p_lesson_id;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'foreign_key_violation';
  end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    raise exception 'marks must be a non-empty json array' using errcode = 'check_violation';
  end if;

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
    if not exists (
      select 1 from public.attendance a where a.lesson_id = p_lesson_id and a.student_id = v_student
    ) and not exists (
      select 1 from public.enrollments e
      where e.group_id = v_lesson.group_id and e.student_id = v_student
        and e.start_date <= v_lesson.lesson_date
        and (e.end_date >= v_lesson.lesson_date or (e.end_date is null and e.status = 'active'))
        and coalesce(public.afterschool_day_hours(v_lesson.group_id, v_student, v_lesson.lesson_date), 1) > 0
    ) then
      raise exception 'student % is not enrolled in the group on %', v_student, v_lesson.lesson_date
        using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_student;
  end loop;
end;
$$;

-- ─── 12. v_payroll_preview: hour subscriptions priced by hours ──────────────

-- Same as 0022 (#83: advances, to_pay; a teacher with advances only — a row with zeros). A mark on an
-- hour subscription pays price_full × hours / hours_total × percent (И62: the hour price of the
-- subscription, not of the tariff on the lesson date — К6); lesson subscriptions — the very same
-- expression as before. student_hours — Σ hours of those marks, appended last (create or replace
-- keeps the column order). Same rules as calcMonth() + toPay() in src/features/payroll/calc.ts —
-- tests/integration/payroll.test.ts.
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
  'Preliminary payroll per teacher (lessons.teacher_id) and month: accrual priced by subscription, hour subscriptions by hours (#82), advances, to_pay = base − advances (#83). Same rules as src/features/payroll/calc.ts.';

revoke all on public.v_payroll_preview from anon;

-- ─── 13. v_student_balance: units (lessons or hours) ────────────────────────

-- Same as 0024 (#81: a carried debt floors paid_lessons below 0, exhausted suggests no refund) in
-- «units»: lessons of a package, hours of a monthly after-school subscription (paid hours floor to 0,5 h). Debt carries only between subscriptions of the same unit
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
      -- floor, not truncation: a debt carried in by a transfer (paid_som < 0) is lessons owed
      when unit = 'hour' then floor(paid_som::numeric * lessons_total * 2 / price_final) / 2
      else floor(paid_som::numeric * lessons_total / price_final)
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
    when status in ('refunded', 'exhausted') then 0 -- exhausted: closed by a transfer / «ушёл» (#81)
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
  'Per subscription: paid / used / debt / refund (В7, В7.1, В8, И37, #81) in units — lessons, or hours of an after-school month (#82). Same as src/features/payments/balance.ts.';

revoke all on public.v_student_balance from anon;
revoke insert, update, delete on public.v_student_balance from authenticated;
grant select on public.v_student_balance to authenticated;

-- ─── 14. Journal search: plans ──────────────────────────────────────────────

-- Same as 0023 (0022 + attendance_presets) plus afterschool_plans (found by the student and the group).
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
    when 'attendance', 'attendance_presets' then
      v_student := (p_row ->> 'student_id')::uuid;
      select l.group_id into v_group from public.lessons l where l.id = (p_row ->> 'lesson_id')::uuid;
    when 'attendance_correction_requests' then
      v_teacher := (p_row ->> 'teacher_id')::uuid;
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
    when 'teacher_rates', 'payroll_adjustments' then
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

-- ─── 14b. #81 × hours: settlement, payroll impact, no transfer ──────────────

-- Same as 0024; lessons_used is numeric — an hour subscription counts hours (v_student_balance
-- lessons_total / lessons_used are hours there, so used_som = used hours × its hour price). The
-- return type changes — drop and create.
drop function if exists public.subscription_settlement(uuid);
create function public.subscription_settlement(p_enrollment_id uuid)
returns table (
  subscription_id uuid,
  started_at date,
  created_at timestamptz,
  paid_som integer,
  lessons_used numeric,
  used_som integer,
  remainder integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.subscription_id,
    s.started_at,
    s.created_at,
    b.paid_som,
    b.lessons_used,
    ceil(b.lessons_used::numeric * b.price_final / b.lessons_total)::integer,
    b.paid_som - ceil(b.lessons_used::numeric * b.price_final / b.lessons_total)::integer
  from public.v_student_balance b
  join public.subscriptions s on s.id = b.subscription_id
  where b.enrollment_id = p_enrollment_id and b.status <> 'refunded';
$$;

-- Same as 0024 except: lessons_used is numeric (hours of an hour subscription), lesson_price of an
-- hour subscription is its paid hour price (price_final / hours_total), unit — of the newest live
-- subscription ('lesson' / 'hour'), appended last. The return type changes — drop and create.
drop function if exists public.enrollment_settlement(uuid);
create function public.enrollment_settlement(p_enrollment_id uuid)
returns table (
  present_marks integer,
  burned_marks integer,
  frozen_marks integer,
  locked_marks integer,
  last_mark_date date,
  payments integer,
  money_som integer,
  paid_som integer,
  lessons_used numeric,
  used_som integer,
  remainder integer,
  lesson_price numeric,
  has_trial boolean,
  unit text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.enrollments e where e.id = p_enrollment_id) then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;

  return query
  with marks as (
    select a.status, a.consumes_credit, l.lesson_date, l.is_locked
    from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
  ),
  money as (
    select count(p.id)::integer as payments, coalesce(sum(p.amount), 0)::integer as money_som
    from public.subscriptions s
    join public.payments p on p.subscription_id = s.id
    where s.enrollment_id = p_enrollment_id
  ),
  settled as (
    select
      coalesce(sum(x.paid_som), 0)::integer as paid_som,
      coalesce(sum(x.lessons_used), 0)::numeric as lessons_used,
      coalesce(sum(x.used_som), 0)::integer as used_som,
      coalesce(sum(x.remainder), 0)::integer as remainder
    from public.subscription_settlement(p_enrollment_id) x
  ),
  newest as (
    select s.price_final, s.lessons_total, s.hours_total
    from public.subscriptions s
    where s.enrollment_id = p_enrollment_id and s.status <> 'refunded'
    order by s.started_at desc, s.created_at desc, s.id desc
    limit 1
  )
  select
    (select count(*)::integer from marks where status = 'present'),
    (select count(*)::integer from marks where status = 'absent_burned'),
    (select count(*)::integer from marks where status = 'absent_frozen'),
    (select count(*)::integer from marks where is_locked),
    (select max(lesson_date) from marks where consumes_credit),
    money.payments,
    money.money_som,
    settled.paid_som,
    settled.lessons_used,
    settled.used_som,
    settled.remainder,
    (select n.price_final::numeric / coalesce(n.hours_total, n.lessons_total) from newest n),
    exists (select 1 from public.trials t where t.enrollment_id = p_enrollment_id),
    coalesce((select case when n.hours_total is null then 'lesson' else 'hour' end from newest n), 'lesson')
  from money, settled;
end;
$$;

-- Same as 0024 except: a mark on an hour subscription pays price_full × hours / hours_total × percent
-- — the very expression of v_payroll_preview (И62), so «Записан по ошибке» shows the real payroll drop.
create or replace function public.enrollment_payroll_impact(p_enrollment_id uuid)
returns table (teacher_id uuid, teacher_name text, lessons integer, amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
  select
    l.teacher_id,
    t.full_name,
    count(*)::integer,
    round(coalesce(sum(
      case
        when s.hours_total is null then s.price_full * r.percent / (s.lessons_total * 100.0)
        else s.price_full * r.percent * coalesce(a.hours, 0) / (s.hours_total * 100.0)
      end
    ), 0))::integer
  from public.enrollment_attendance(p_enrollment_id) a
  join public.lessons l on l.id = a.lesson_id
  join public.teachers t on t.id = l.teacher_id
  left join public.subscriptions s on s.id = a.subscription_id
  left join lateral (
    select tr.percent
    from public.teacher_rates tr
    where tr.teacher_id = l.teacher_id and tr.valid_from <= l.lesson_date
    order by tr.valid_from desc
    limit 1
  ) r on true
  where a.consumes_credit and l.status = 'held'
  group by l.teacher_id, t.full_name
  order by t.full_name;
end;
$$;

-- Same as 0024 plus: an after-school (hours) group on either side refuses — the month bill and the
-- plan do not move to a lesson package and back; «Ушёл» with a refund and a new enrollment instead.
create or replace function public.transfer_preview(
  p_enrollment_id uuid,
  p_group_id uuid,
  p_start_date date default null
)
returns table (
  start_date date,
  whole_move boolean,
  lessons_total integer,
  price integer,
  remainder integer,
  to_pay integer,
  surplus integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_to public.groups%rowtype;
  v_from_type public.group_type;
  v_start date;
  v_whole boolean;
  v_tariff public.tariffs%rowtype;
  v_remainder integer;
begin
  perform public.assert_admin();
  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  select * into v_to from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  select g.group_type into v_from_type from public.groups g where g.id = v_enrollment.group_id;
  if v_from_type = 'afterschool' or v_to.group_type = 'afterschool' then
    -- hours are billed by month and plan (И60): «ушёл» with a refund, then a new enrollment (#82)
    raise exception 'after-school by hours: no transfer — withdraw and enroll anew'
      using errcode = 'check_violation';
  end if;

  v_whole := v_to.group_type = v_from_type and not exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a where a.consumes_credit
  );
  v_start := coalesce(p_start_date, public.transfer_default_start(p_enrollment_id, p_group_id));
  select * into v_tariff from public.tariffs t
  where t.group_type = v_to.group_type and t.valid_from <= v_start
  order by t.valid_from desc
  limit 1;
  select coalesce(sum(x.remainder), 0)::integer into v_remainder
  from public.subscription_settlement(p_enrollment_id) x;

  return query select
    v_start,
    v_whole,
    v_tariff.lessons_in_package,
    v_tariff.package_price,
    v_remainder,
    case when v_whole then 0 else greatest(0, v_tariff.package_price - v_remainder) end,
    case when v_whole then 0 else greatest(0, v_remainder - v_tariff.package_price) end;
end;
$$;


-- Same as 0024 plus the after-school refusal of transfer_preview.
create or replace function public.transfer_student(
  p_enrollment_id uuid,
  p_group_id uuid,
  p_start_date date default null,
  p_refund_surplus boolean default false,
  p_method public.payment_method default null,
  p_paid_on date default null
)
returns table (
  enrollment_id uuid,
  subscription_id uuid,
  start_date date,
  transferred integer,
  refunded integer,
  whole_move boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.enrollments%rowtype;
  v_from public.groups%rowtype;
  v_to public.groups%rowtype;
  v_start date;
  v_tariff public.tariffs%rowtype;
  v_enrollment_id uuid;
  v_subscription_id uuid;
  v_remainder integer;
  v_refund integer := 0;
  v_left integer;
  v_take integer;
  v_out integer;
  v_moved integer := 0;
  v_transfer uuid := gen_random_uuid();
  r record;
begin
  perform public.assert_admin();

  select * into v_old from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  -- the subscriptions too, as record_payment does: no payment / refund lands between the settlement
  -- read below and the rows written from it
  perform 1 from public.subscriptions s where s.enrollment_id = p_enrollment_id for update;
  if v_old.status <> 'active' then
    raise exception 'enrollment is finished' using errcode = 'check_violation';
  end if;
  select * into v_to from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_to.id = v_old.group_id then
    raise exception 'the enrollment is already in this group' using errcode = 'check_violation';
  end if;
  if v_to.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  select * into v_from from public.groups g where g.id = v_old.group_id;
  if v_from.group_type = 'afterschool' or v_to.group_type = 'afterschool' then
    -- hours are billed by month and plan (И60): «ушёл» with a refund, then a new enrollment (#82)
    raise exception 'after-school by hours: no transfer — withdraw and enroll anew'
      using errcode = 'check_violation';
  end if;

  v_start := coalesce(p_start_date, public.transfer_default_start(p_enrollment_id, p_group_id));

  if v_to.group_type = v_from.group_type and not exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a where a.consumes_credit
  ) then
    v_start := public.transfer_enrollment(p_enrollment_id, p_group_id, v_start);
    return query
    select p_enrollment_id,
           (select s.id from public.subscriptions s where s.enrollment_id = p_enrollment_id
            order by s.started_at desc, s.created_at desc, s.id desc limit 1),
           v_start, 0, 0, true;
    return;
  end if;

  if v_start < v_to.start_date or (v_to.end_date is not null and v_start > v_to.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;
  if v_start <= v_old.start_date then
    raise exception 'transfer date must be after the enrollment start' using errcode = 'check_violation';
  end if;
  if v_old.end_date is not null and v_start > v_old.end_date + 1 then
    raise exception 'start date is after the enrollment end' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
    where a.consumes_credit and l.lesson_date >= v_start
  ) then
    raise exception 'the enrollment has present or burned marks on or after %', v_start
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
    where l.is_locked and l.lesson_date >= v_start
  ) then
    raise exception 'the enrollment has marks in a closed period' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_old.student_id and e.group_id = p_group_id
      and (e.status = 'active' or e.end_date >= v_start)
  ) then
    raise exception 'the student is already enrolled in the target group' using errcode = 'unique_violation';
  end if;

  select * into v_tariff from public.tariffs t
  where t.group_type = v_to.group_type and t.valid_from <= v_start
  order by t.valid_from desc
  limit 1;
  if not found then
    raise exception 'no tariff for % on %', v_to.group_type, v_start using errcode = 'check_violation';
  end if;

  select coalesce(sum(x.remainder), 0)::integer into v_remainder
  from public.subscription_settlement(p_enrollment_id) x;
  if p_refund_surplus and v_remainder > v_tariff.package_price then
    v_refund := v_remainder - v_tariff.package_price;
    if p_method is null then
      raise exception 'payment method is required for a refund' using errcode = 'check_violation';
    end if;
  end if;

  perform set_config('iqup.audit_reason', 'transfer_student', true);

  delete from public.attendance a
  where a.id in (
    select m.id from public.enrollment_attendance(p_enrollment_id) m
    join public.lessons l on l.id = m.lesson_id
    where l.lesson_date >= v_start
  )
    and a.status = 'absent_frozen';

  update public.enrollments set end_date = v_start - 1, status = 'finished' where id = p_enrollment_id;

  insert into public.enrollments (student_id, group_id, start_date)
  values (v_old.student_id, p_group_id, v_start)
  returning id into v_enrollment_id;
  insert into public.subscriptions (
    enrollment_id, tariff_id, lessons_total, price_full, discount_percent, discount_reason, price_final, started_at
  )
  values (
    v_enrollment_id, v_tariff.id, v_tariff.lessons_in_package, v_tariff.package_price, 0, 'none',
    v_tariff.package_price, v_start
  )
  returning id into v_subscription_id;

  -- the refund comes from the newest subscriptions with money left; the rest moves
  v_left := v_refund;
  for r in
    select * from public.subscription_settlement(p_enrollment_id) x
    order by x.started_at desc, x.created_at desc, x.subscription_id desc
  loop
    v_take := least(v_left, greatest(r.remainder, 0));
    if v_take > 0 then
      insert into public.payments (subscription_id, amount, method, paid_at, kind, reason)
      values (r.subscription_id, -v_take, p_method, public.payment_time(p_paid_on), 'refund',
              'излишек при переводе в ' || public.group_title(p_group_id));
      v_left := v_left - v_take;
    end if;
    v_out := r.remainder - v_take;
    if v_out <> 0 then
      insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id)
      values (r.subscription_id, -v_out, null, 'transfer',
              'перенос в ' || public.group_title(p_group_id), v_transfer);
      v_moved := v_moved + v_out;
    end if;
  end loop;
  if v_moved <> 0 then
    insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id)
    values (v_subscription_id, v_moved, null, 'transfer',
            'перенос из ' || public.group_title(v_old.group_id), v_transfer);
  end if;
  -- the old subscriptions are closed on their used lessons: the money left them, and a later
  -- enrollment in the old group must not charge its marks to them (attendance_subscription)
  update public.subscriptions s set status = 'exhausted'
  where s.enrollment_id = p_enrollment_id and s.status = 'active';

  perform set_config('iqup.audit_reason', '', true);
  return query select v_enrollment_id, v_subscription_id, v_start, v_moved, v_refund, false;
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

revoke execute on function public.subscription_settlement(uuid) from public, anon, authenticated;
revoke execute on function public.enrollment_settlement(uuid) from public, anon;
grant execute on function public.enrollment_settlement(uuid) to authenticated;

-- ─── 16. Prod: default plans for current after-school students ──────────────

select public.afterschool_backfill_plans();
