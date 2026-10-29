-- #119 · Перенос оплаты на другой абонемент того же зачисления (Г10). Docs: 05-decisions Г10, И94.
--
-- A payment recorded as «новый абонемент» while an older package stayed unpaid left the debt on the
-- older one with no way to pay it off (Ясмин, Айдин, Гусев). update_payment gets p_subscription_id:
-- the admin moves the payment to another subscription of the same enrollment, with a reason.
--   p_subscription_id — null or the payment's own subscription: it stays. Another one: a subscription
--     of the same enrollment, not refunded; a payment only (a refund belongs to its refunded package,
--     a transfer — undone only by undoing it); the source must not be left paying out more than it
--     got (a refund on it).
-- payments_guard unchanged: UPDATE only inside the RPC (iqup.payment_edit); audit_log by the trigger,
-- describeAuditRow — «оплата перенесена на абонемент с 07.09».
-- Production-safe: replaces update_payment (a new trailing param with a default); no data is touched.

drop function public.update_payment(uuid, integer, public.payment_method, date, text, text);

-- p_amount — the money of the row, > 0 (a refund is stored negative). Null date — keep it.
create function public.update_payment(
  p_payment_id uuid,
  p_amount integer,
  p_method public.payment_method,
  p_paid_on date,
  p_comment text,
  p_reason text,
  p_subscription_id uuid default null
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
  v_sub uuid;
  v_from public.subscriptions%rowtype;
  v_to public.subscriptions%rowtype;
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

  select * into v_from from public.subscriptions s where s.id = v_pay.subscription_id for update;
  v_sub := coalesce(p_subscription_id, v_pay.subscription_id);
  if v_sub <> v_pay.subscription_id then
    if v_pay.kind = 'refund' then
      raise exception 'a refund stays on its subscription' using errcode = 'check_violation';
    end if;
    select * into v_to from public.subscriptions s where s.id = v_sub for update;
    if not found or v_to.enrollment_id <> v_from.enrollment_id then
      raise exception 'the payment moves only to a subscription of the same enrollment'
        using errcode = 'check_violation';
    end if;
    if v_to.status = 'refunded' then
      raise exception 'the subscription is refunded' using errcode = 'check_violation';
    end if;
  end if;

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
    -- moved away, the source keeps nothing of this payment
    if v_rest + (case when v_sub = v_pay.subscription_id then p_amount else 0 end) < 0 and exists (
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
     and v_comment is not distinct from v_pay.reason and v_sub = v_pay.subscription_id then
    return;
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.payment_edit', 'on', true);
  update public.payments
  set amount = v_amount, method = p_method, paid_at = v_paid_at, reason = v_comment,
      subscription_id = v_sub
  where id = v_pay.id;
  perform set_config('iqup.payment_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.update_payment(uuid, integer, public.payment_method, date, text, text, uuid)
  from public, anon;
grant execute on function public.update_payment(uuid, integer, public.payment_method, date, text, text, uuid)
  to authenticated;
