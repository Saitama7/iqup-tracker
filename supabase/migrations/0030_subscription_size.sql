-- #101 · Subscription size at purchase (И89, by К5/К6).
-- buy_subscription / enroll_student / enroll_trial take p_lessons (null — the tariff's lessons_in_package;
-- otherwise 1 … 2 × lessons_in_package): lessons_total = p_lessons,
-- price_full = round(package_price × p_lessons / lessons_in_package) — the same lesson price
-- (7 200 / 12 × 8 = 4 800). The discount (В5) is from that price_full; payroll is by
-- price_full / lessons_total of the subscription (К6) — unchanged. After-school (hours_total) ignores it.
-- The old calls (without p_lessons) work as before: the new parameter is last and defaults to null.

-- Price of a package of p_lessons lessons by the tariff; refuses a size out of 1 … 2 × lessons_in_package.
create function public.subscription_size_price(p_tariff_id uuid, p_lessons integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tariff public.tariffs%rowtype;
begin
  select * into v_tariff from public.tariffs t where t.id = p_tariff_id;
  if p_lessons is null or p_lessons < 1 or p_lessons > 2 * v_tariff.lessons_in_package then
    raise exception 'lessons must be 1 … %', 2 * v_tariff.lessons_in_package using errcode = 'check_violation';
  end if;
  return round(v_tariff.package_price::numeric * p_lessons / v_tariff.lessons_in_package)::integer;
end;
$$;

revoke execute on function public.subscription_size_price(uuid, integer) from public, anon, authenticated;

-- ─── enroll_student ─────────────────────────────────────────────────────────

drop function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[]);

-- Same as 0025 plus p_lessons (package groups only).
create or replace function public.enroll_student(
  p_student_id uuid,
  p_group_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_plan numeric[] default null,
  p_lessons integer default null
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
    v_lessons := coalesce(p_lessons, v_tariff.lessons_in_package);
    v_price := public.subscription_size_price(v_tariff.id, v_lessons);

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

revoke execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[], integer)
from public, anon;
grant execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason, numeric[], integer)
to authenticated;

-- ─── buy_subscription ───────────────────────────────────────────────────────

drop function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason);

-- Same as 0025 plus p_lessons (package groups only).
create or replace function public.buy_subscription(
  p_enrollment_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_paid_on date default null,
  p_comment text default null,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_lessons integer default null
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

    v_lessons := coalesce(p_lessons, v_tariff.lessons_in_package);
    v_price := public.subscription_size_price(v_tariff.id, v_lessons);

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

revoke execute on function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason, integer)
from public, anon;
grant execute on function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason, integer)
to authenticated;

-- ─── enroll_trial ───────────────────────────────────────────────────────────

drop function public.enroll_trial(uuid, date, integer, public.discount_reason);

-- Same as 0018 plus p_lessons, passed to enroll_student.
create or replace function public.enroll_trial(
  p_trial_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none',
  p_lessons integer default null
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
                             null, p_lessons) e;

  update public.trials
  set status = 'enrolled', enrollment_id = v_enrollment_id, student_id = v_student_id
  where id = p_trial_id;

  return query select v_enrollment_id, v_subscription_id, v_student_id;
end;
$$;

revoke execute on function public.enroll_trial(uuid, date, integer, public.discount_reason, integer) from public, anon;
grant execute on function public.enroll_trial(uuid, date, integer, public.discount_reason, integer) to authenticated;
