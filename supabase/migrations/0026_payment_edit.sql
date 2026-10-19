-- #92 · Удаление и правка оплаты админом (дубль оплаты на проде). Docs: 05-decisions Г9, Г10, И41
-- (пересмотрено); 01-domain-model PAYMENT.
--
-- The admin is a superadmin (Г9): a mistaken payment is deleted or fixed (Г10), not reversed.
--   delete_payment(id, reason) — a payment or a refund (a transfer — only by undoing the transfer /
--     «ушёл», И41). A deleted refund opens its subscription again (refunded → active). A deleted
--     payment of a lesson package that leaves it with no payment and no mark, while the enrollment
--     has another subscription, takes the package with it: the duplicate «новый абонемент» goes
--     whole. The first package of an enrollment (enroll_student, bought unpaid) stays unpaid, as it
--     was before the payment; an after-school invoice in hours lives without a payment (И60) — only
--     the payment goes. A package with marks stays: it owes (v_student_balance, И37), nothing moves.
--   update_payment(id, amount, method, paid_on, comment, reason) — amount (> 0; a refund — at most
--     what the other rows paid in), method, date (as record_payment, И39; the same day keeps the
--     time), comment (a refund's reason). Student and subscription never change (delete, record anew).
-- Both: admin only (42501), a reason 1…500 chars → audit_log.reason (iqup.audit_reason); no check of
-- closed periods — payments do not move payroll (К6: price_full of the subscription), and a
-- subscription deleted with its payment has no marks.
-- payments_guard lets UPDATE / DELETE through only inside these RPCs (iqup.payment_edit = 'on', set
-- local in their body and cleared right after); there is still no write policy on payments, so a
-- direct update / delete through PostgREST touches nothing. created_at / created_by never change.
-- audit_search_text: a payment row of a deleted subscription still finds its student and group (the
-- subscription's delete snapshot in audit_log).
-- Production-safe: replaces two functions keeping their signatures, adds two; no data is touched.

-- ─── payments_guard ─────────────────────────────────────────────────────────

create or replace function public.payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if coalesce(current_setting('iqup.payment_edit', true), '') <> 'on' then
      raise exception 'payments are changed only by update_payment / delete_payment'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  else
    new.created_at := now();
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  end if;
  if new.paid_at > now() + interval '1 minute' then
    raise exception 'payment date is in the future' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.payments_guard() from public, anon, authenticated;

-- ─── RPC ────────────────────────────────────────────────────────────────────

create or replace function public.assert_edit_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason is required' using errcode = 'check_violation';
  end if;
  if length(btrim(p_reason)) > 500 then
    raise exception 'reason is too long' using errcode = 'check_violation';
  end if;
  return btrim(p_reason);
end;
$$;

-- Returns what happened: 'deleted' | 'subscription_deleted' (the package went with it) |
-- 'reactivated' (a refund deleted, the subscription is active again).
create or replace function public.delete_payment(p_payment_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_pay public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_enr public.enrollments%rowtype;
  v_outcome text := 'deleted';
begin
  perform public.assert_payment_admin();
  v_reason := public.assert_edit_reason(p_reason);

  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;
  if v_pay.kind::text = 'transfer' then
    raise exception 'a transfer is undone only by undoing the transfer or the withdrawal'
      using errcode = 'check_violation';
  end if;
  select * into v_sub from public.subscriptions s where s.id = v_pay.subscription_id for update;
  select * into v_enr from public.enrollments e where e.id = v_sub.enrollment_id;

  if v_pay.kind = 'refund' and v_sub.status = 'refunded' then
    if v_enr.status = 'finished' and v_enr.end_date is null then
      -- a void record of «Записан по ошибке» (0024): its subscriptions stay closed
      raise exception 'a refund of an enrollment deleted by mistake is not deleted'
        using errcode = 'check_violation';
    end if;
    if v_sub.period_month is not null and exists (
      select 1 from public.subscriptions s
      where s.enrollment_id = v_sub.enrollment_id and s.period_month = v_sub.period_month
        and s.status <> 'refunded' and s.id <> v_sub.id
    ) then
      raise exception 'the month already has another invoice' using errcode = 'check_violation';
    end if;
  end if;
  if v_pay.kind = 'payment' and exists (
    select 1 from public.payments p where p.subscription_id = v_sub.id and p.kind = 'refund'
  ) and (
    select coalesce(sum(p.amount), 0) from public.payments p
    where p.subscription_id = v_sub.id and p.id <> v_pay.id
  ) < 0 then
    raise exception 'the refund is more than the rest paid — delete the refund first'
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.payment_edit', 'on', true);
  delete from public.payments where id = v_pay.id;
  perform set_config('iqup.payment_edit', '', true);

  if v_pay.kind = 'refund' and v_sub.status = 'refunded' then
    update public.subscriptions set status = 'active' where id = v_sub.id;
    v_outcome := 'reactivated';
  elsif v_pay.kind = 'payment'
    and v_sub.hours_total is null
    and not exists (select 1 from public.payments p where p.subscription_id = v_sub.id)
    and not exists (select 1 from public.attendance a where a.subscription_id = v_sub.id)
    and exists (
      select 1 from public.subscriptions s
      where s.enrollment_id = v_sub.enrollment_id and s.id <> v_sub.id
    )
  then
    delete from public.subscriptions where id = v_sub.id;
    v_outcome := 'subscription_deleted';
  end if;

  perform set_config('iqup.audit_reason', '', true);
  return v_outcome;
end;
$$;

-- p_amount — the money of the row, > 0 (a refund is stored negative). Null date — keep it.
create or replace function public.update_payment(
  p_payment_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_paid_on date,
  p_comment text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_pay public.payments%rowtype;
  v_amount integer;
  v_paid_at timestamptz;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_rest integer;
begin
  perform public.assert_payment_admin();
  v_reason := public.assert_edit_reason(p_reason);

  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;
  if v_pay.kind::text = 'transfer' then
    raise exception 'a transfer is undone only by undoing the transfer or the withdrawal'
      using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;
  if p_method is null then
    raise exception 'method is required' using errcode = 'check_violation';
  end if;
  if v_comment is not null and length(v_comment) > 500 then
    raise exception 'comment is too long' using errcode = 'check_violation';
  end if;

  perform 1 from public.subscriptions s where s.id = v_pay.subscription_id for update;
  select coalesce(sum(p.amount), 0) into v_rest
  from public.payments p where p.subscription_id = v_pay.subscription_id and p.id <> v_pay.id;

  if v_pay.kind = 'refund' then
    if v_comment is null then
      raise exception 'refund reason is required' using errcode = 'check_violation';
    end if;
    if p_amount > v_rest then
      raise exception 'refund must be between 0 and the amount paid' using errcode = 'check_violation';
    end if;
    v_amount := -p_amount;
  else
    if v_rest + p_amount < 0 and exists (
      select 1 from public.payments p
      where p.subscription_id = v_pay.subscription_id and p.kind = 'refund'
    ) then
      raise exception 'refund must be between 0 and the amount paid' using errcode = 'check_violation';
    end if;
    v_amount := p_amount;
  end if;

  v_paid_at := case
    when p_paid_on is null or p_paid_on = (v_pay.paid_at at time zone 'Asia/Bishkek')::date
      then v_pay.paid_at
    else public.payment_time(p_paid_on)
  end;

  if v_amount = v_pay.amount and p_method = v_pay.method and v_paid_at = v_pay.paid_at
     and v_comment is not distinct from v_pay.reason then
    return;
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.payment_edit', 'on', true);
  update public.payments
  set amount = v_amount, method = p_method, paid_at = v_paid_at, reason = v_comment
  where id = v_pay.id;
  perform set_config('iqup.payment_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.assert_edit_reason(text) from public, anon, authenticated;
revoke execute on function public.delete_payment(uuid, text) from public, anon;
grant execute on function public.delete_payment(uuid, text) to authenticated;
revoke execute on function public.update_payment(uuid, integer, public.payment_method, date, text, text)
  from public, anon;
grant execute on function public.update_payment(uuid, integer, public.payment_method, date, text, text)
  to authenticated;

-- ─── audit_search_text ──────────────────────────────────────────────────────

-- The enrollment of a subscription deleted with its payment (delete_payment): from the
-- subscription's delete snapshot. Security definer + a partial index — v_audit_feed.search calls it
-- for every payment row whose subscription is gone, RLS of audit_log per row would time out; staff
-- only (the journal is theirs, Д-RLS of audit_log).
create index if not exists audit_log_subscription_delete_idx
  on public.audit_log (entity_id) where entity = 'subscriptions' and action = 'delete';

create or replace function public.deleted_subscription_enrollment(p_subscription_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (a.before ->> 'enrollment_id')::uuid
  from public.audit_log a
  where a.entity = 'subscriptions' and a.action = 'delete' and a.entity_id = p_subscription_id
    and public.is_staff()
  limit 1;
$$;

revoke execute on function public.deleted_subscription_enrollment(uuid) from public, anon;
grant execute on function public.deleted_subscription_enrollment(uuid) to authenticated;

-- Same as 0025; a payment of a subscription deleted with it (delete_payment) finds the enrollment in
-- the subscription's delete snapshot.
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
      if v_enrollment is null then
        v_enrollment := public.deleted_subscription_enrollment((p_row ->> 'subscription_id')::uuid);
      end if;
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
