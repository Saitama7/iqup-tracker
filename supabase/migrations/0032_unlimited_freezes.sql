-- #108 · Заморозки без лимита (К9). Docs: 05-decisions К9, 01-domain-model «Заморозка».
--
-- tariffs.freeze_limit becomes nullable: null — no limit (every version now). The value stays in the
-- table in case the centre brings a limit back: a number there limits again, nothing else to change.
--   1. tariffs.freeze_limit: drop not null, default null; every version → null.
--   2. enforce_freeze_limit (attendance trigger: confirm_lesson, correct_attendance, any write):
--      no limit — no check, no lock.
--   3. attendance_presets_guard (the soft check, И55–И56): its `v_used >= v_limit` is unknown for a
--      null limit, so it never raises — left as in 0025.
--   4. plan_tariffs_from_today: a row with no freeze_limit — no limit (was 2).
--   5. v_student_balance: freeze_limit of an unbilled after-school month is the tariff's (null), not 0.

-- ─── 1. tariffs.freeze_limit ────────────────────────────────────────────────

alter table public.tariffs alter column freeze_limit drop not null;
alter table public.tariffs alter column freeze_limit set default null;

comment on column public.tariffs.freeze_limit is
  'Frozen marks per subscription (after-school: per month); null — no limit (К9, #108).';

-- versions in effect too: through the admin-edit flag of tariffs_guard (0028), with an audit reason
select set_config('iqup.admin_edit', 'on', true), set_config('iqup.audit_reason', 'unlimited_freezes', true);
update public.tariffs set freeze_limit = null where freeze_limit is not null;
select set_config('iqup.admin_edit', '', true), set_config('iqup.audit_reason', '', true);

-- ─── 2. enforce_freeze_limit ────────────────────────────────────────────────

-- Same as 0025; a null limit (К9) lets any number of frozen marks through.
create or replace function public.enforce_freeze_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used integer;
begin
  if new.status <> 'absent_frozen' then
    return new;
  end if;

  if new.subscription_id is null then
    select t.freeze_limit into v_limit
    from public.lessons l
    join public.tariffs t on t.group_type = 'afterschool' and t.valid_from <= l.lesson_date
    where l.id = new.lesson_id
    order by t.valid_from desc
    limit 1;
    if v_limit is null then
      return new;
    end if;
    v_used := public.afterschool_unbilled_freezes(new.lesson_id, new.student_id, new.lesson_id, false);
    if v_used is null then
      return new;
    end if;
    if v_used >= v_limit then
      raise exception 'freeze limit (%) exceeded for the month', v_limit
        using errcode = 'check_violation', hint = 'mark as absent_burned';
    end if;
    return new;
  end if;

  select t.freeze_limit into v_limit
  from public.subscriptions s
  join public.tariffs t on t.id = s.tariff_id
  where s.id = new.subscription_id;
  if v_limit is null then
    return new;
  end if;

  -- Serialize concurrent marks on the same subscription.
  perform 1 from public.subscriptions s where s.id = new.subscription_id for update;

  select count(*) into v_used
  from public.attendance a
  where a.subscription_id = new.subscription_id
    and a.status = 'absent_frozen'
    and a.id <> new.id;

  if v_used >= v_limit then
    raise exception 'freeze limit (%) exceeded for subscription %', v_limit, new.subscription_id
      using errcode = 'check_violation', hint = 'mark as absent_burned';
  end if;

  return new;
end;
$$;

-- ─── 4. plan_tariffs_from_today ─────────────────────────────────────────────

-- Same as 0028; freeze_limit of a row is taken as is — none means no limit (К9).
create or replace function public.plan_tariffs_from_today(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  perform public.assert_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'tariff rows are required' using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'tariff_from_today', true);
  perform set_config('iqup.admin_edit', 'on', true);
  with added as (
    insert into public.tariffs (
      group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit,
      hour_price, valid_from
    )
    select x.group_type, x.lessons_in_package, x.package_price, x.max_students, x.lesson_duration_min,
           x.freeze_limit, x.hour_price, public.bishkek_today()
    from jsonb_to_recordset(p_rows) as x(
      group_type public.group_type,
      lessons_in_package integer,
      package_price integer,
      max_students integer,
      lesson_duration_min integer,
      freeze_limit integer,
      hour_price integer
    )
    returning 1
  )
  select count(*)::integer into v_inserted from added;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_inserted;
end;
$$;

-- ─── 5. v_student_balance ───────────────────────────────────────────────────

-- Same as 0025; an unbilled after-school month takes the tariff's limit as is (null — none).
create or replace view public.v_student_balance
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
    -- capacity: an hour invoice also holds its credit hours (paid on earlier invoices, И61)
    coalesce(s.hours_total + s.credit_hours, s.lessons_total)::numeric as lessons_total,
    -- units the price is for: billed hours / lessons
    coalesce(s.hours_total, s.lessons_total)::numeric as priced_total,
    coalesce(s.credit_hours, 0) as credit,
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
    s.credit_hours,
    -- hours of it that went into the credit of later invoices (И72): spent here, paid there
    public.credit_out_hours(s) as credit_out
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
      when unit = 'hour' then credit + floor(paid_som::numeric * priced_total * 2 / price_final) / 2
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
  lessons_total - lessons_used - credit_out as lessons_left,
  case when status = 'refunded' then 0 else greatest(0, lessons_used + credit_out - paid_lessons) end
    as debt_lessons,
  case
    when status = 'refunded' or lessons_used + credit_out <= paid_lessons then 0
    else greatest(0, ceil(
      ((lessons_used - credit + credit_out) * price_final - paid_som::numeric * priced_total) / priced_total
    ))::integer
  end as debt_som,
  case
    when status in ('refunded', 'exhausted') then 0 -- exhausted: closed by a transfer / «ушёл» (#81)
    -- an hour invoice: the money paid beyond its billed hours spent (И72) — exactly the
    -- subscription_settlement remainder, so debt − refund sums to −remainder
    when unit = 'hour' then greatest(0,
      paid_som - ceil((lessons_used - credit + credit_out) * price_final / priced_total)::integer)
    else round(
      greatest(0, least(paid_lessons, lessons_total) - lessons_used) * price_final / priced_total
    )::integer
  end as refund_suggested,
  freezes_used,
  freeze_limit,
  is_current,
  unit,
  hours_total,
  period_month,
  credit_hours,
  false as unbilled,
  credit_out
from balance
union all
-- a month not invoiced (И69): no subscription, its hours owed at the hour price on the date — like an
-- unpaid invoice of exactly those hours; out of the chain and never current
select
  null::uuid,
  u.enrollment_id,
  u.student_id,
  u.group_id,
  'active'::public.subscription_status,
  u.first_date,
  u.hours,
  u.amount,
  u.amount,
  0,
  0::numeric,
  u.hours,
  0::numeric,
  u.hours,
  0::numeric,
  u.hours,
  u.amount,
  0,
  (select count(*)::integer from public.attendance a
   join public.lessons l on l.id = a.lesson_id
   where l.group_id = u.group_id and a.student_id = u.student_id
     and a.subscription_id is null and a.status = 'absent_frozen'
     and date_trunc('month', l.lesson_date)::date = u.month),
  (select t.freeze_limit from public.tariffs t
   where t.group_type = 'afterschool' and t.valid_from <= u.first_date
   order by t.valid_from desc limit 1),
  false,
  'hour',
  u.hours,
  u.month,
  0::numeric,
  true,
  0::numeric
from public.v_afterschool_unbilled u;

comment on view public.v_student_balance is
  'Per subscription: paid / used / debt / refund (В7, В7.1, В8, И37, #81) in units — lessons, or hours of an after-school month (#82); unbilled — an after-school month not invoiced (subscription_id null, И69). Same as src/features/payments/balance.ts.';

revoke all on public.v_student_balance from anon;
revoke insert, update, delete on public.v_student_balance from authenticated;
grant select on public.v_student_balance to authenticated;

