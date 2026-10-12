-- 0012 — ЗП по цене абонемента; новый тариф для типов с абонементами — с 1-го следующего месяца
-- (issue #35, R2). Docs: 05-decisions К3, К6, А1.1, И5, И8; 01-domain-model.md §3, §6.
--
-- 1. v_payroll_preview: a consumed mark is priced by the subscription it was written off
--    (attendance.subscription_id → price_full / lessons_total), not by the tariff on the lesson date —
--    a tariff changed after the purchase never reprices lessons already paid for (К6). Full price,
--    the discount never matters (А1.1, К3). The teacher's percent is still the one on the lesson date.
--    A consumed mark without a subscription (И5 breach) counts as a student-lesson, pays 0 and is
--    counted in the new column no_subscription («нет абонемента» on Б1).
--    Same rules as calcMonth() in src/features/payroll/calc.ts — tests/integration/payroll.test.ts.
-- 2. tariffs_guard: if the group type already has subscriptions, an admin's new tariff starts on the
--    1st of next month at the earliest (bought subscriptions keep their price, new ones follow the
--    new tariff from that day); with no subscriptions of the type — from today (was: after today).
--    Service role / migrations / seed / import (#14) are not limited, as before.

-- ─── 1. v_payroll_preview ───────────────────────────────────────────────────

create or replace view public.v_payroll_preview
with (security_invoker = true)
as
with held as (
  select
    g.teacher_id,
    date_trunc('month', l.lesson_date)::date as month,
    l.duration_min,
    m.student_lessons,
    m.no_subscription,
    m.amount
  from public.lessons l
  join public.groups g on g.id = l.group_id
  left join lateral (
    select r.percent
    from public.teacher_rates r
    where r.teacher_id = g.teacher_id and r.valid_from <= l.lesson_date
    order by r.valid_from desc
    limit 1
  ) r on true
  cross join lateral (
    select
      count(*)::integer as student_lessons,
      (count(*) - count(s.id))::integer as no_subscription,
      sum(s.price_full * r.percent / (s.lessons_total * 100.0)) as amount
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
  sum(h.no_subscription)::integer as no_subscription
from held h
group by h.teacher_id, h.month;

comment on view public.v_payroll_preview is
  'Preliminary payroll per teacher and month (R1-9, R2: priced by subscription). Same rules as src/features/payroll/calc.ts.';

revoke all on public.v_payroll_preview from anon;

-- ─── 2. tariffs guard ───────────────────────────────────────────────────────

-- 1st of next month (Asia/Bishkek) if the type already has subscriptions, else today (К6).
create function public.tariff_min_valid_from(p_group_type public.group_type)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.subscriptions s
      join public.tariffs t on t.id = s.tariff_id
      where t.group_type = p_group_type
    )
    then (date_trunc('month', public.bishkek_today()) + interval '1 month')::date
    else public.bishkek_today()
  end;
$$;

-- Used by the guard only; the form (А9) derives the same date from the subscriptions it loads.
revoke execute on function public.tariff_min_valid_from(public.group_type)
from public, anon, authenticated;

create or replace function public.tariffs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min date;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.valid_from <= public.bishkek_today() then
    raise exception 'tariff in effect since % cannot be changed — plan a new version', old.valid_from
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Admin from the app (others never get past RLS; the check runs before it, so keep their 42501).
  if public.is_admin() then
    v_min := public.tariff_min_valid_from(new.group_type);
    if new.valid_from < v_min then
      if v_min > public.bishkek_today() then
        raise exception 'group type % has subscriptions — a new tariff starts on % at the earliest',
          new.group_type, v_min
          using errcode = 'check_violation';
      end if;
      raise exception 'a new tariff cannot start in the past' using errcode = 'check_violation';
    end if;
    -- author is the signed-in user, not a client-supplied value
    new.created_by := case when tg_op = 'INSERT' then auth.uid() else old.created_by end;
  end if;
  return new;
end;
$$;
