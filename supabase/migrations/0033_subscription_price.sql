-- #109 · Subscription price of its own; individual = 12 hours for 7 200; «Изменить абонемент» (К11, К12, И90).
--
--   1. subscription_default_lessons / subscription_default_price — the defaults of a new package:
--      individual (К11): the tariff's package is lessons_in_package HOURS (12 h for 7 200); a lesson of
--      the group lasts group_lesson_duration(group, today) (И88), so it costs
--      package_price / lessons_in_package × duration / 60 (1,5 h → 900) and the default size is
--      round(lessons_in_package × 60 / duration) (90 min → 8, 120 → 6, 60 → 12); other types — И89
--      (round(package_price × N / lessons_in_package), N = lessons_in_package).
--   2. buy_subscription / enroll_student / enroll_trial / transfer_student (+ transfer_preview) take
--      p_price (1 … 1 000 000; null — the default): price_full = coalesce(p_price, default), the
--      В5 discount — from it; p_lessons null — the default size above. After-school by hours — no price
--      (its month bill is priced per hour, #111).
--   3. update_subscription(id, lessons, price, reason) — admin, a reason: a live package's lessons_total
--      and price_full (price_final with the same discount). Refused: a mark of it in a closed period
--      (invariant 2), an after-school hour bill, a refunded one. A size below the lessons used gives a
--      debt (И37). Payroll follows by К6 (price_full / lessons_total) — views and calc.ts, nothing stored.
--   4. subscription_update_preview / subscription_balance_preview — «было → станет»: the teacher's
--      payroll by month (v_payroll_preview.base_amount) and the student's balance (v_student_balance) of
--      the edit, computed by applying it in a rolled back subtransaction — the same numbers as after it.
--   5. subscriptions_guard — the terms (size, price, discount, tariff, enrollment) change only inside
--      update_subscription (iqup.admin_edit, Г9); status / started_at — as before.
--   6. audit_kind — the edit of a subscription's size / price is «Правки задним числом».
-- Production-safe: functions replaced with one extra trailing parameter (old calls work), a trigger,
-- no data rows change.

-- ─── 1. Defaults ────────────────────────────────────────────────────────────

-- Default size of a new package: individual — the tariff's hours in lessons of the group (К11).
create or replace function public.subscription_default_lessons(p_tariff_id uuid, p_group_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tariff public.tariffs%rowtype;
  v_duration integer;
begin
  select * into v_tariff from public.tariffs t where t.id = p_tariff_id;
  if v_tariff.group_type <> 'individual' then
    return v_tariff.lessons_in_package;
  end if;
  v_duration := coalesce(public.group_lesson_duration(p_group_id, public.bishkek_today()),
                         v_tariff.lesson_duration_min);
  return least(2 * v_tariff.lessons_in_package,
               greatest(1, round(v_tariff.lessons_in_package * 60.0 / v_duration)::integer));
end;
$$;

-- Default price of p_lessons lessons (null — the default size); refuses a size out of
-- 1 … 2 × lessons_in_package. Individual: the hour price × the group's lesson length (К11).
create or replace function public.subscription_default_price(
  p_tariff_id uuid,
  p_group_id uuid,
  p_lessons integer default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tariff public.tariffs%rowtype;
  v_lessons integer;
  v_duration integer;
begin
  select * into v_tariff from public.tariffs t where t.id = p_tariff_id;
  v_lessons := coalesce(p_lessons, public.subscription_default_lessons(p_tariff_id, p_group_id));
  if v_tariff.group_type <> 'individual' then
    return public.subscription_size_price(p_tariff_id, v_lessons);
  end if;
  if v_lessons < 1 or v_lessons > 2 * v_tariff.lessons_in_package then
    raise exception 'lessons must be 1 … %', 2 * v_tariff.lessons_in_package using errcode = 'check_violation';
  end if;
  v_duration := coalesce(public.group_lesson_duration(p_group_id, public.bishkek_today()),
                         v_tariff.lesson_duration_min);
  return round(v_tariff.package_price::numeric * v_duration * v_lessons
               / (v_tariff.lessons_in_package * 60))::integer;
end;
$$;

-- A price typed by the admin (К12): a whole 1 … 1 000 000 сом.
create or replace function public.assert_subscription_price(p_price integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_price is not null and (p_price < 1 or p_price > 1000000) then
    raise exception 'price must be 1 … 1000000' using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.subscription_default_lessons(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.subscription_default_price(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.assert_subscription_price(integer) from public, anon, authenticated;

-- ─── 2. enroll_student ──────────────────────────────────────────────────────

drop function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[], integer);

-- Same as 0030 plus p_price; p_lessons null — subscription_default_lessons.
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
    if p_price is not null then
      raise exception 'a price is for lesson packages only' using errcode = 'check_violation';
    end if;
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
  end if;

  return query select v_enrollment_id, v_subscription_id;
end;
$$;

revoke execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[], integer, integer)
from public, anon;
grant execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[], integer, integer)
to authenticated;

-- ─── 3. buy_subscription ────────────────────────────────────────────────────

drop function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason, integer);

-- Same as 0030 plus p_price; p_lessons null — subscription_default_lessons.
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
  v_month date;
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

  if v_group.group_type = 'afterschool' then
    if p_price is not null then
      raise exception 'a price is for lesson packages only' using errcode = 'check_violation';
    end if;
    v_month := (select (max(s.period_month) + interval '1 month')::date from public.subscriptions s
                where s.enrollment_id = p_enrollment_id and s.status <> 'refunded');
    if v_month is not null then
      v_subscription_id := public.afterschool_invoice_insert(
        p_enrollment_id, v_month, p_discount_pct, p_discount_reason, true);
    else
      -- the first invoice: this month from the day after the old package (afterschool_bill_from);
      -- the package covers the month — the next one
      v_month := date_trunc('month', greatest(public.bishkek_today(), v_enrollment.start_date))::date;
      v_subscription_id := public.afterschool_invoice_insert(
        p_enrollment_id, v_month, p_discount_pct, p_discount_reason, false);
      if v_subscription_id is null then
        v_subscription_id := public.afterschool_invoice_insert(
          p_enrollment_id, (v_month + interval '1 month')::date, p_discount_pct, p_discount_reason, true);
      end if;
    end if;
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
  end if;

  return query
  select v_subscription_id,
         public.record_payment(v_subscription_id, p_amount, p_method, p_paid_on, p_comment);
end;
$$;

revoke execute on function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason, integer, integer)
from public, anon;
grant execute on function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason, integer, integer)
to authenticated;

-- ─── 4. enroll_trial ────────────────────────────────────────────────────────

drop function public.enroll_trial(uuid, date, integer, public.discount_reason, integer);

-- Same as 0030 plus p_price, passed to enroll_student.
create or replace function public.enroll_trial(
  p_trial_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_lessons integer default null,
  p_price integer default null
)
returns table (enrollment_id uuid, subscription_id uuid, student_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial public.trials%rowtype;
  v_lesson_date date;
  v_student_id uuid;
  v_matches uuid[];
  v_enrollment_id uuid;
  v_subscription_id uuid;
begin
  perform public.assert_admin();

  select * into v_trial from public.trials t where t.id = p_trial_id for update;
  if not found then
    raise exception 'trial % not found', p_trial_id using errcode = 'foreign_key_violation';
  end if;
  if v_trial.status <> 'attended' then
    raise exception 'only an attended trial can be enrolled' using errcode = 'check_violation';
  end if;

  select l.lesson_date into v_lesson_date from public.lessons l where l.id = v_trial.lesson_id;
  if p_start_date is null or p_start_date <= v_lesson_date then
    raise exception 'the subscription starts after the trial lesson' using errcode = 'check_violation';
  end if;

  v_student_id := v_trial.student_id;
  if v_student_id is null and v_trial.parent_phone is not null then
    perform pg_advisory_xact_lock(hashtext(v_trial.parent_phone));
    select array_agg(s.id) into v_matches
    from public.students s
    where s.parent_phone = v_trial.parent_phone
      and public.person_name_key(s.full_name) = public.person_name_key(v_trial.full_name);
    if cardinality(v_matches) > 1 then
      raise exception 'several students match the trial name and phone' using errcode = 'unique_violation';
    end if;
    v_student_id := v_matches[1];
    if v_student_id is not null then
      -- the lead's «привёл друг» (И40, 5 % to the friend) and class are not lost on the existing student
      update public.students s
      set referred_by_student_id = coalesce(s.referred_by_student_id,
                                            nullif(v_trial.referred_by_student_id, s.id)),
          grade = coalesce(v_trial.grade, s.grade)
      where s.id = v_student_id;
    end if;
  end if;
  if v_student_id is null then
    insert into public.students (full_name, grade, parent_phone, notes, referred_by_student_id)
    values (btrim(v_trial.full_name), v_trial.grade, v_trial.parent_phone,
            nullif(btrim(coalesce(v_trial.note, '')), ''), v_trial.referred_by_student_id)
    returning id into v_student_id;
  end if;

  select e.enrollment_id, e.subscription_id into v_enrollment_id, v_subscription_id
  from public.enroll_student(v_student_id, v_trial.group_id, p_start_date, p_discount_pct, p_discount_reason,
                             null, p_lessons, p_price) e;

  update public.trials
  set status = 'enrolled', enrollment_id = v_enrollment_id, student_id = v_student_id
  where id = p_trial_id;

  return query select v_enrollment_id, v_subscription_id, v_student_id;
end;
$$;

revoke execute on function public.enroll_trial(uuid, date, integer, public.discount_reason, integer, integer) from public, anon;
grant execute on function public.enroll_trial(uuid, date, integer, public.discount_reason, integer, integer) to authenticated;

-- ─── 5. transfer_preview / transfer_student ─────────────────────────────────

drop function public.transfer_preview(uuid, uuid, date);

-- Same as 0025; the new package — the target group's default size and price (К11) or p_price.
create or replace function public.transfer_preview(
  p_enrollment_id uuid,
  p_group_id uuid,
  p_start_date date default null,
  p_price integer default null
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
  v_lessons integer;
  v_price integer;
begin
  perform public.assert_admin();
  perform public.assert_subscription_price(p_price);
  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  select * into v_to from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  select g.group_type into v_from_type from public.groups g where g.id = v_enrollment.group_id;
  if public.enrollment_on_hours(p_enrollment_id) or v_to.group_type = 'afterschool' then
    -- hours are billed by month and plan (И60): «ушёл» with a refund, then a new enrollment (#82);
    -- an after-school enrollment still on the old 20-lesson packages moves as in 0024
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
  if found then
    v_lessons := public.subscription_default_lessons(v_tariff.id, p_group_id);
    v_price := coalesce(p_price, public.subscription_default_price(v_tariff.id, p_group_id, v_lessons));
  end if;
  select coalesce(sum(x.remainder), 0)::integer into v_remainder
  from public.subscription_settlement(p_enrollment_id) x;

  return query select
    v_start,
    v_whole,
    v_lessons,
    v_price,
    v_remainder,
    case when v_whole then 0 else greatest(0, v_price - v_remainder) end,
    case when v_whole then 0 else greatest(0, v_remainder - v_price) end;
end;
$$;

drop function public.transfer_student(uuid, uuid, date, boolean, public.payment_method, date);

-- Same as 0025; the new package — the target group's default size and price (К11) or p_price; the
-- surplus to refund — over that price.
create or replace function public.transfer_student(
  p_enrollment_id uuid,
  p_group_id uuid,
  p_start_date date default null,
  p_refund_surplus boolean default false,
  p_method public.payment_method default null,
  p_paid_on date default null,
  p_price integer default null
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
  v_lessons integer;
  v_price integer;
  r record;
begin
  perform public.assert_admin();
  perform public.assert_subscription_price(p_price);

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
  if public.enrollment_on_hours(p_enrollment_id) or v_to.group_type = 'afterschool' then
    -- hours are billed by month and plan (И60): «ушёл» with a refund, then a new enrollment (#82);
    -- an after-school enrollment still on the old 20-lesson packages moves as in 0024
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
  v_lessons := public.subscription_default_lessons(v_tariff.id, p_group_id);
  v_price := coalesce(p_price, public.subscription_default_price(v_tariff.id, p_group_id, v_lessons));

  select coalesce(sum(x.remainder), 0)::integer into v_remainder
  from public.subscription_settlement(p_enrollment_id) x;
  if p_refund_surplus and v_remainder > v_price then
    v_refund := v_remainder - v_price;
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
  values (v_enrollment_id, v_tariff.id, v_lessons, v_price, 0, 'none', v_price, v_start)
  returning id into v_subscription_id;

  -- the refund comes from the newest subscriptions with money left; the rest moves
  v_left := v_refund;
  for r in
    select * from public.subscription_settlement(p_enrollment_id) x
    where x.subscription_id is not null
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

revoke execute on function public.transfer_preview(uuid, uuid, date, integer) from public, anon;
grant execute on function public.transfer_preview(uuid, uuid, date, integer) to authenticated;
revoke execute on function public.transfer_student(uuid, uuid, date, boolean, public.payment_method, date, integer)
from public, anon;
grant execute on function public.transfer_student(uuid, uuid, date, boolean, public.payment_method, date, integer)
to authenticated;

-- ─── 6. subscriptions_guard ─────────────────────────────────────────────────

-- The terms of a subscription are fixed at purchase (К6); only update_subscription (iqup.admin_edit)
-- changes them. Status and started_at stay writable by their RPCs (exit, start date); the seed and
-- the service role (auth.uid() null) — as before.
create or replace function public.subscriptions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('iqup.admin_edit', true), '') <> 'on'
     and (new.enrollment_id, new.tariff_id, new.lessons_total, new.price_full, new.price_final,
          new.discount_percent, new.discount_reason, new.hours_total, new.credit_hours, new.period_month)
         is distinct from
         (old.enrollment_id, old.tariff_id, old.lessons_total, old.price_full, old.price_final,
          old.discount_percent, old.discount_reason, old.hours_total, old.credit_hours, old.period_month)
  then
    raise exception 'a subscription''s size and price change only by update_subscription'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.subscriptions_guard() from public, anon, authenticated;

drop trigger if exists subscriptions_guard on public.subscriptions;
create trigger subscriptions_guard
before update on public.subscriptions
for each row execute function public.subscriptions_guard();

-- ─── 7. update_subscription ─────────────────────────────────────────────────

-- The checks of an edit; returns the locked row. p_lessons / p_price null — unchanged.
create or replace function public.subscription_edit_target(p_id uuid, p_lessons integer, p_price integer)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_tariff public.tariffs%rowtype;
begin
  perform public.assert_admin();
  perform public.assert_subscription_price(p_price);
  select * into v_sub from public.subscriptions s where s.id = p_id for update;
  if not found then
    raise exception 'subscription % not found', p_id using errcode = 'no_data_found';
  end if;
  if v_sub.status = 'refunded' then
    raise exception 'the subscription is refunded' using errcode = 'check_violation';
  end if;
  if v_sub.hours_total is not null then
    raise exception 'an after-school month bill is priced by hours' using errcode = 'check_violation';
  end if;
  select * into v_tariff from public.tariffs t where t.id = v_sub.tariff_id;
  if p_lessons is not null and (p_lessons < 1 or p_lessons > 2 * v_tariff.lessons_in_package) then
    raise exception 'lessons must be 1 … %', 2 * v_tariff.lessons_in_package using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    where a.subscription_id = p_id and (l.is_locked or public.payroll_month_closed(l.lesson_date))
  ) then
    raise exception 'the subscription has marks in a closed period' using errcode = 'check_violation';
  end if;
  return v_sub;
end;
$$;

-- Writes the new terms (inside the flag); the caller has checked them.
create or replace function public.subscription_apply_terms(p_id uuid, p_lessons integer, p_price integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('iqup.admin_edit', 'on', true);
  update public.subscriptions s
  set lessons_total = p_lessons,
      price_full = p_price,
      price_final = round(p_price * (100 - s.discount_percent) / 100.0)::integer
  where s.id = p_id;
  perform set_config('iqup.admin_edit', '', true);
end;
$$;

create or replace function public.update_subscription(
  p_id uuid,
  p_lessons integer,
  p_price integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_sub public.subscriptions%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may edit a subscription' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);
  v_sub := public.subscription_edit_target(p_id, p_lessons, p_price);
  if coalesce(p_lessons, v_sub.lessons_total) = v_sub.lessons_total
     and coalesce(p_price, v_sub.price_full) = v_sub.price_full then
    raise exception 'nothing to change' using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform public.subscription_apply_terms(
    p_id, coalesce(p_lessons, v_sub.lessons_total), coalesce(p_price, v_sub.price_full));
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

-- ─── 8. Previews ────────────────────────────────────────────────────────────

-- «было → станет» of the teacher's payroll: per teacher and month of the held lessons with this
-- subscription's consumed marks — the marks, one mark's pay (rounded, the percent on the lesson date)
-- and the month's v_payroll_preview.base_amount before and after the edit (applied and rolled back).
create or replace function public.subscription_update_preview(
  p_id uuid,
  p_lessons integer,
  p_price integer
)
returns table (
  teacher_id uuid,
  teacher_name text,
  month date,
  marks integer,
  mark_before integer,
  mark_after integer,
  amount_before integer,
  amount_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_lessons integer;
  v_price integer;
  v_after jsonb := '{}';
begin
  v_sub := public.subscription_edit_target(p_id, p_lessons, p_price);
  v_lessons := coalesce(p_lessons, v_sub.lessons_total);
  v_price := coalesce(p_price, v_sub.price_full);

  begin
    perform public.subscription_apply_terms(p_id, v_lessons, v_price);
    select coalesce(jsonb_object_agg(v.teacher_id::text || '|' || v.month::text, v.base_amount), '{}')
    into v_after
    from public.v_payroll_preview v;
    raise exception using errcode = 'P0001', message = 'iqup preview rollback';
  exception when raise_exception then
    if sqlerrm <> 'iqup preview rollback' then
      raise;
    end if;
  end;

  return query
  with marks as (
    select
      l.teacher_id,
      date_trunc('month', l.lesson_date)::date as month,
      r.percent
    from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    left join lateral (
      select tr.percent from public.teacher_rates tr
      where tr.teacher_id = l.teacher_id and tr.valid_from <= l.lesson_date
      order by tr.valid_from desc
      limit 1
    ) r on true
    where a.subscription_id = p_id and a.consumes_credit and l.status = 'held'
  )
  select
    m.teacher_id,
    t.full_name,
    m.month,
    count(*)::integer,
    round(avg(coalesce(m.percent, 0) * v_sub.price_full / (v_sub.lessons_total * 100.0)))::integer,
    round(avg(coalesce(m.percent, 0) * v_price / (v_lessons * 100.0)))::integer,
    coalesce(max(p.base_amount), 0)::integer,
    coalesce((v_after ->> (m.teacher_id::text || '|' || m.month::text))::integer, 0)
  from marks m
  join public.teachers t on t.id = m.teacher_id
  left join public.v_payroll_preview p on p.teacher_id = m.teacher_id and p.month = m.month
  group by m.teacher_id, t.full_name, m.month
  order by m.month, t.full_name;
end;
$$;

-- «было → станет» of the student's balance on this subscription (v_student_balance).
create or replace function public.subscription_balance_preview(
  p_id uuid,
  p_lessons integer,
  p_price integer
)
returns table (
  phase text,
  lessons_total integer,
  price_full integer,
  price_final integer,
  paid_som integer,
  lessons_used integer,
  paid_lessons integer,
  lessons_left integer,
  debt_lessons integer,
  debt_som integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_after record;
begin
  v_sub := public.subscription_edit_target(p_id, p_lessons, p_price);

  begin
    perform public.subscription_apply_terms(
      p_id, coalesce(p_lessons, v_sub.lessons_total), coalesce(p_price, v_sub.price_full));
    select b.lessons_total, b.price_full, b.price_final, b.paid_som, b.lessons_used, b.paid_lessons,
           b.lessons_left, b.debt_lessons, b.debt_som
    into v_after
    from public.v_student_balance b where b.subscription_id = p_id;
    raise exception using errcode = 'P0001', message = 'iqup preview rollback';
  exception when raise_exception then
    if sqlerrm <> 'iqup preview rollback' then
      raise;
    end if;
  end;

  return query
  select 'before', b.lessons_total::integer, b.price_full::integer, b.price_final::integer,
         b.paid_som::integer, b.lessons_used::integer, b.paid_lessons::integer,
         b.lessons_left::integer, b.debt_lessons::integer, b.debt_som::integer
  from public.v_student_balance b where b.subscription_id = p_id
  union all
  select 'after', v_after.lessons_total::integer, v_after.price_full::integer,
         v_after.price_final::integer, v_after.paid_som::integer, v_after.lessons_used::integer,
         v_after.paid_lessons::integer, v_after.lessons_left::integer,
         v_after.debt_lessons::integer, v_after.debt_som::integer;
end;
$$;

revoke execute on function public.subscription_edit_target(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.subscription_apply_terms(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.update_subscription(uuid, integer, integer, text) from public, anon;
grant execute on function public.update_subscription(uuid, integer, integer, text) to authenticated;
revoke execute on function public.subscription_update_preview(uuid, integer, integer) from public, anon;
grant execute on function public.subscription_update_preview(uuid, integer, integer) to authenticated;
revoke execute on function public.subscription_balance_preview(uuid, integer, integer) from public, anon;
grant execute on function public.subscription_balance_preview(uuid, integer, integer) to authenticated;

-- ─── 9. journal ─────────────────────────────────────────────────────────────

-- Same as 0028 plus: a subscription whose size or price changed (update_subscription) —
-- «Правки задним числом».
create or replace function public.audit_kind(
  p_entity text,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_at timestamptz
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_entity = 'lessons' and p_action = 'update'
         and p_before ->> 'status' = 'planned' and p_after ->> 'status' = 'held'
         and coalesce((p_after ->> 'confirmed_late')::boolean, false)
      then 'late'
    when p_entity = 'attendance'
      or (p_entity = 'lessons' and p_before ->> 'status' = 'held'
          and (p_action = 'delete' or p_after ->> 'status' <> 'held'))
      or (p_entity = 'lessons' and p_action = 'update'
          and p_before ->> 'status' = 'held' and p_after ->> 'status' = 'held'
          and (p_before -> 'lesson_date' is distinct from p_after -> 'lesson_date'
               or p_before -> 'planned_start' is distinct from p_after -> 'planned_start'
               or p_before -> 'duration_min' is distinct from p_after -> 'duration_min'
               or p_before -> 'teacher_id' is distinct from p_after -> 'teacher_id'))
      or (p_entity = 'teacher_rates' and p_action <> 'insert'
          and (p_before ->> 'valid_from')::date <= (p_at at time zone 'Asia/Bishkek')::date)
      or (p_entity = 'teacher_rates' and p_action = 'insert'
          and (p_after ->> 'valid_from')::date < (p_at at time zone 'Asia/Bishkek')::date)
      or (p_entity = 'trials' and p_action = 'insert' and p_after ->> 'status' <> 'scheduled')
      or (p_entity = 'holidays'
          and (coalesce(p_after, p_before) ->> 'day')::date < (p_at at time zone 'Asia/Bishkek')::date)
      or (p_entity = 'subscriptions' and p_action = 'update'
          and (p_before -> 'lessons_total' is distinct from p_after -> 'lessons_total'
               or p_before -> 'price_full' is distinct from p_after -> 'price_full'))
      then 'retro'
    when p_entity in ('subscriptions', 'payments', 'payroll_adjustments', 'payroll_periods')
      then 'payment'
    when p_entity = 'lessons' and p_action = 'update'
         and p_before ->> 'status' = 'planned' and p_after ->> 'status' = 'held'
      then 'attendance'
    else 'other'
  end
$$;
