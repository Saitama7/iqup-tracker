-- #47 · Оплаты (А7 + balance on А5/А6/У4/У5/УД3). Docs: 05-decisions В5, В7, В7.1, В8, Г1–Г4, Д3;
-- 01-domain-model.md §5 and PAYMENT.
--
-- payments: N payments per subscription (Г3), cash | mbank (Г2). A refund is a negative payment with
-- a reason (В8); refund_subscription() writes it and marks the subscription refunded in one call.
-- The admin writes through the RPCs below, the accountant reads (Г1), a teacher reads payments of own
-- students (Д3). Payments are immutable: no write policy, payments_guard rejects UPDATE/DELETE — a
-- mistake is fixed by a reversing entry (И41).
-- Every change goes to audit_log (invariant 4); v_audit_feed (0014) already files them as 'payment'.
--
-- v_student_balance — one row per subscription, the same numbers as balance.ts
-- (src/features/payments/balance.ts; tests/integration/balance.test.ts reconciles them on the seed):
--   paid_lessons = floor(paid_som × lessons_total / price_final)               (В7.1)
--   «в долг» lessons charged beyond a subscription (attendance_subscription, 0010, charges the newest
--   one) move to the next subscription of the same student and group once it is bought: the
--   capacity of a subscription that is not the last one is max(lessons_total, paid_lessons), the rest
--   is carried (И37). The last one keeps everything.
--   debt_lessons = max(0, lessons_used − paid_lessons); debt_som = what those lessons cost beyond the
--   money paid, lessons_used × price_final / lessons_total − paid_som, rounded UP (ceil) — paying it
--   opens every debt lesson again, since paid_lessons floors (И37).
--   refund_suggested = (min(paid_lessons, lessons_total) − lessons_used) × price_final / lessons_total
--   (В8: remaining lessons at the discounted price; the admin may correct it).
--   A refunded subscription is closed: it carries nothing and owes nothing.
--
-- Also (cheap link of А11 «привёл друг» to В5): trials.referred_by_student_id — enroll_trial copies it
-- to the new student, so the friend who brought them gets the 5 % (enroll_student / buy_subscription).

create type public.payment_method as enum ('cash', 'mbank');
create type public.payment_kind as enum ('payment', 'refund');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id),
  amount integer not null,
  method public.payment_method not null,
  paid_at timestamptz not null default now(),
  kind public.payment_kind not null default 'payment',
  reason text, -- comment of a payment; required for a refund
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (
    (kind = 'payment' and amount > 0)
    or (kind = 'refund' and amount < 0 and length(btrim(coalesce(reason, ''))) > 0)
  )
);
create index on public.payments (subscription_id);
create index on public.payments (paid_at);

-- ─── payments_guard ─────────────────────────────────────────────────────────

-- A payment is never changed or deleted (И41); created_by is the signed-in user; created_at is DB time;
-- a payment is never dated in the future.
create function public.payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'payments are immutable — record a reversing entry' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  if new.paid_at > now() + interval '1 minute' then
    raise exception 'payment date is in the future' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payments_guard
before insert or update or delete on public.payments
for each row execute function public.payments_guard();

create trigger audit_log after insert or update or delete on public.payments
for each row execute function public.write_audit_log();

revoke execute on function public.payments_guard() from public, anon, authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────

create function public.teaches_subscription(p_subscription_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.id = p_subscription_id and public.teaches_enrollment(s.enrollment_id)
  );
$$;

alter table public.payments enable row level security;

create policy payments_select on public.payments for select to authenticated
  using (public.teaches_subscription(subscription_id) or public.is_staff());
-- No write policy: payments are written only by the security definer RPCs below (И41).

alter publication supabase_realtime add table public.payments;

-- ─── v_student_balance ──────────────────────────────────────────────────────

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
    s.lessons_total,
    s.price_full,
    s.price_final,
    t.freeze_limit,
    (select count(*) from public.attendance a
     where a.subscription_id = s.id and a.consumes_credit)::integer as used_own,
    (select count(*) from public.attendance a
     where a.subscription_id = s.id and a.status = 'absent_frozen')::integer as freezes_used,
    coalesce((select sum(p.amount) from public.payments p where p.subscription_id = s.id), 0)::integer
      as paid_som
  from public.subscriptions s
  join public.enrollments e on e.id = s.enrollment_id
  join public.tariffs t on t.id = s.tariff_id
),
paid as (
  select
    subs.*,
    case
      when price_final = 0 then lessons_total
      else (greatest(paid_som, 0)::bigint * lessons_total / price_final)::integer
    end as paid_lessons
  from subs
),
chain as (
  -- prefix = Σ (used_own − capacity) of the earlier subscriptions of the student in the group
  select
    paid.*,
    coalesce(sum(used_own - greatest(lessons_total, paid_lessons)) over (
      partition by student_id, group_id order by started_at, created_at, subscription_id
      rows between unbounded preceding and 1 preceding
    ), 0) as prefix,
    row_number() over (
      partition by student_id, group_id order by started_at desc, created_at desc, subscription_id desc
    ) = 1 as is_last
  from paid
  where status <> 'refunded'
),
carried as (
  -- Lindley: carry_k = max(0, carry_{k-1} + used_{k-1} − capacity_{k-1}) = prefix_k − min(prefix_0..k)
  select
    chain.*,
    (prefix - min(prefix) over (
      partition by student_id, group_id order by started_at, created_at, subscription_id
      rows between unbounded preceding and current row
    ))::integer as carried_in
  from chain
),
used as (
  select
    carried.subscription_id, carried.carried_in, carried.is_last,
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
    coalesce(used.is_last, false) as is_current,
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
      (lessons_used::numeric * price_final - paid_som::numeric * lessons_total) / lessons_total
    ))::integer
  end as debt_som,
  case
    when status = 'refunded' then 0
    else round(
      greatest(0, least(paid_lessons, lessons_total) - lessons_used)::numeric * price_final / lessons_total
    )::integer
  end as refund_suggested,
  freezes_used,
  freeze_limit,
  is_current
from balance;

comment on view public.v_student_balance is
  'Per subscription: paid / used / debt / refund (В7, В7.1, В8, И37) — same as src/features/payments/balance.ts.';

revoke all on public.v_student_balance from anon;
revoke insert, update, delete on public.v_student_balance from authenticated;

-- ─── RPC ────────────────────────────────────────────────────────────────────

-- The payment date from the form: today → now(); an earlier day → noon of that day in Bishkek.
create function public.payment_time(p_paid_on date)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_paid_on is null or p_paid_on = public.bishkek_today() then
    return now();
  end if;
  if p_paid_on > public.bishkek_today() then
    raise exception 'payment date is in the future' using errcode = 'check_violation';
  end if;
  return (p_paid_on + time '12:00') at time zone 'Asia/Bishkek';
end;
$$;

create function public.assert_payment_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin records payments' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- «Записать оплату» on an existing subscription (first payment, the rest, or closing a debt).
create function public.record_payment(
  p_subscription_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_paid_on date default null,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.subscription_status;
  v_id uuid;
begin
  perform public.assert_payment_admin();
  select s.status into v_status from public.subscriptions s where s.id = p_subscription_id for update;
  if not found then
    raise exception 'subscription % not found', p_subscription_id using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'refunded' then
    raise exception 'subscription is refunded' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  insert into public.payments (subscription_id, amount, method, paid_at, kind, reason, created_by)
  values (p_subscription_id, p_amount, p_method, public.payment_time(p_paid_on), 'payment',
          nullif(btrim(coalesce(p_comment, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- «Новый абонемент» + its (first) payment in one transaction: tariff of the group on the start day,
-- discounts as in enroll_student (В5). Starts today (or on the enrollment start if that is later), never
-- before the newest subscription of the enrollment — so attendance_subscription() keeps the order.
create function public.buy_subscription(
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

  if p_discount_reason = 'returning' and (
    not v_student.is_returning
    or exists (
      select 1 from public.subscriptions s
      join public.enrollments e on e.id = s.enrollment_id
      where e.student_id = v_student.id
    )
  ) then
    raise exception '15 %% applies only to the first subscription of a returning student'
      using errcode = 'check_violation';
  end if;
  if p_discount_reason = 'referral' and (
    select count(*) from public.students f where f.referred_by_student_id = v_student.id
  ) <= (
    select count(*) from public.subscriptions s
    join public.enrollments e on e.id = s.enrollment_id
    where e.student_id = v_student.id and s.discount_reason = 'referral'
  ) then
    raise exception '5 %% applies once per friend brought' using errcode = 'check_violation';
  end if;

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

  return query
  select v_subscription_id,
         public.record_payment(v_subscription_id, p_amount, p_method, p_paid_on, p_comment);
end;
$$;

-- «Возврат» (В8): a negative payment with a reason, the subscription → refunded. The amount comes from
-- the form (suggested from v_student_balance.refund_suggested, the admin may correct it), at most what
-- was paid. The enrollment stays as it is (И42): В8 is only about the money — if the student leaves,
-- the admin finishes the enrollment on А6.
create function public.refund_subscription(
  p_subscription_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_reason text,
  p_paid_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_paid integer;
  v_id uuid;
begin
  perform public.assert_payment_admin();
  select * into v_sub from public.subscriptions s where s.id = p_subscription_id for update;
  if not found then
    raise exception 'subscription % not found', p_subscription_id using errcode = 'foreign_key_violation';
  end if;
  if v_sub.status = 'refunded' then
    raise exception 'subscription is already refunded' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'refund reason is required' using errcode = 'check_violation';
  end if;
  select coalesce(sum(p.amount), 0) into v_paid from public.payments p where p.subscription_id = p_subscription_id;
  if p_amount is null or p_amount < 0 or p_amount > v_paid then
    raise exception 'refund must be between 0 and the amount paid' using errcode = 'check_violation';
  end if;

  if p_amount > 0 then
    insert into public.payments (subscription_id, amount, method, paid_at, kind, reason, created_by)
    values (p_subscription_id, -p_amount, p_method, public.payment_time(p_paid_on), 'refund',
            btrim(p_reason), auth.uid())
    returning id into v_id;
  end if;

  update public.subscriptions set status = 'refunded' where id = p_subscription_id;

  return v_id;
end;
$$;

revoke execute on function public.assert_payment_admin() from public, anon, authenticated;
revoke execute on function public.payment_time(date) from public, anon;
grant execute on function public.payment_time(date) to authenticated;
revoke execute on function public.teaches_subscription(uuid) from public, anon;
grant execute on function public.teaches_subscription(uuid) to authenticated;
revoke execute on function public.record_payment(uuid, integer, public.payment_method, date, text)
from public, anon;
grant execute on function public.record_payment(uuid, integer, public.payment_method, date, text)
to authenticated;
revoke execute on function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason)
from public, anon;
grant execute on function public.buy_subscription(uuid, integer, public.payment_method, date, text, integer, public.discount_reason)
to authenticated;
revoke execute on function public.refund_subscription(uuid, integer, public.payment_method, text, date)
from public, anon;
grant execute on function public.refund_subscription(uuid, integer, public.payment_method, text, date)
to authenticated;

-- ─── А11 «привёл друг» → В5 ─────────────────────────────────────────────────

alter table public.trials add column referred_by_student_id uuid references public.students (id);

-- Same as 0015, plus: a new student made from a lead brought by a friend gets referred_by_student_id —
-- the friend's 5 % (В5) becomes available.
create or replace function public.enroll_trial(
  p_trial_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none'
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
  if v_student_id is null then
    insert into public.students (full_name, grade, parent_phone, notes, referred_by_student_id)
    values (btrim(v_trial.full_name), v_trial.grade, v_trial.parent_phone,
            nullif(btrim(coalesce(v_trial.note, '')), ''), v_trial.referred_by_student_id)
    returning id into v_student_id;
  end if;

  select e.enrollment_id, e.subscription_id into v_enrollment_id, v_subscription_id
  from public.enroll_student(v_student_id, v_trial.group_id, p_start_date, p_discount_pct, p_discount_reason) e;

  update public.trials
  set status = 'enrolled', enrollment_id = v_enrollment_id, student_id = v_student_id
  where id = p_trial_id;

  return query select v_enrollment_id, v_subscription_id, v_student_id;
end;
$$;
