-- #95 · «Отменить проведение» — админ возвращает проведённое занятие в запланированные, с причиной и
-- предпросмотром ЗП. Docs: 05-decisions И52 (пересмотрено), И74; 01-domain-model LESSON; CLAUDE.md
-- invariant 1. Part of #94 («админ может всё»).
--
-- unconfirm_lesson(lesson, reason) — admin only (42501), a reason 1…500 (assert_edit_reason, 0026).
-- One transaction: every attendance mark of the lesson is deleted (as on cancelling a planned lesson,
-- И12) — the teacher's payroll and the students' balances are views and follow; pending correction
-- requests of the lesson → rejected «занятие возвращено в запланированные: <причина>»; the lesson
-- held → planned with confirmed_at / confirmed_by / confirmed_late reset. Presets and trials stay.
-- A closed period (is_locked) refuses — reopen the period first (#94); a planned / cancelled lesson
-- refuses. confirm_lesson afterwards works as for any planned lesson (a new confirmed_at).
-- lessons_guard resets confirmed_* and lets held → planned through only inside unconfirm_lesson
-- (iqup.admin_edit = 'on', set local and cleared right after — the #92 payment_edit pattern); a direct
-- update still fails «confirmed_at … cannot be changed».
-- lesson_payroll_impact(lesson) — what the lesson's teacher loses: the drop of v_payroll_preview
-- .base_amount of that month (by subscription price, К6; hours, И62/И69 — mark_pay).
-- v_audit_feed: the lesson row of an unconfirm (held → planned) gets marks = statuses of the marks
-- deleted with it and, appended, amount = the teacher's pay of those marks («учителю … −1 050 сом»).
-- audit_kind already files held → planned and attendance as 'retro' (0022).
-- Production-safe: replaces lessons_guard and v_audit_feed keeping their columns, adds two functions.

-- ─── lessons_guard ──────────────────────────────────────────────────────────

-- Same as 0020 plus: held → planned only inside unconfirm_lesson (iqup.admin_edit), which also resets
-- confirmed_*; anywhere else held → planned and any change of confirmed_* fail.
create or replace function public.lessons_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mutable constant text[] := array['status', 'comment', 'confirmed_at', 'confirmed_by', 'confirmed_late'];
  v_unconfirm boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_locked then
      raise exception 'lesson % is in a closed period', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- payroll owner (0020): the group's teacher; an admin / service role may name another one
    if new.teacher_id is null or (auth.uid() is not null and not public.is_admin()) then
      select g.teacher_id into new.teacher_id from public.groups g where g.id = new.group_id;
    end if;
    new.is_locked := false;
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.confirmed_late := false;
    if new.status = 'held' then
      new.confirmed_at := now();
      new.confirmed_by := auth.uid();
      new.confirmed_late := new.lesson_date <> public.bishkek_today();
    end if;
    return new;
  end if;

  -- UPDATE
  if old.is_locked then
    -- Only an admin may reopen a period, and only by flipping is_locked (design Б1б).
    if public.is_admin() and not new.is_locked
       and (to_jsonb(new) - 'is_locked') = (to_jsonb(old) - 'is_locked') then
      return new;
    end if;
    raise exception 'lesson % is in a closed period', old.id using errcode = 'check_violation';
  end if;

  v_unconfirm := old.status = 'held' and new.status = 'planned';
  if v_unconfirm and coalesce(current_setting('iqup.admin_edit', true), '') <> 'on' then
    raise exception 'a held lesson goes back to planned only by unconfirm_lesson'
      using errcode = 'check_violation';
  end if;

  if v_unconfirm then
    -- unconfirm_lesson (#95): the confirmation is gone, confirm_lesson sets a new one
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.confirmed_late := false;
  elsif old.confirmed_at is not null then
    if new.confirmed_at is distinct from old.confirmed_at
       or new.confirmed_by is distinct from old.confirmed_by
       or new.confirmed_late is distinct from old.confirmed_late then
      raise exception 'confirmed_at of lesson % cannot be changed', old.id using errcode = 'check_violation';
    end if;
  elsif new.status = 'held' then
    -- First confirmation: DB time only, client values are ignored.
    new.confirmed_at := now();
    new.confirmed_by := auth.uid();
    new.confirmed_late := new.lesson_date <> public.bishkek_today();
  else
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.confirmed_late := false;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    -- Teacher (RLS already limits updates to admin/teacher): planned → held and comment only (matrix §5).
    -- Service role / migrations (no auth.uid()) are not restricted here.
    if (to_jsonb(new) - v_mutable) <> (to_jsonb(old) - v_mutable) then
      raise exception 'teacher may change only status and comment' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> old.status and not (old.status = 'planned' and new.status = 'held') then
      raise exception 'teacher may only mark a planned lesson as held' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'held' and old.status = 'planned'
       and now() < ((new.lesson_date + new.planned_start) at time zone 'Asia/Bishkek') then
      raise exception 'lesson has not started yet' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ─── lesson_payroll_impact ──────────────────────────────────────────────────

-- Exact teacher's pay of a held lesson's consumed marks (not rounded) — the expression of
-- v_payroll_preview (mark_pay, the percent on the lesson date). 0 — not held, nothing consumed.
create or replace function public.lesson_pay_exact(p_lesson_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(public.mark_pay(
    s.price_full, s.lessons_total, s.hours_total, r.percent, a.hours,
    public.afterschool_hour_price_on(l.lesson_date)
  )), 0)
  from public.lessons l
  left join lateral (
    select tr.percent
    from public.teacher_rates tr
    where tr.teacher_id = l.teacher_id and tr.valid_from <= l.lesson_date
    order by tr.valid_from desc
    limit 1
  ) r on true
  join public.attendance a on a.lesson_id = l.id and a.consumes_credit
  left join public.subscriptions s on s.id = a.subscription_id
  where l.id = p_lesson_id and l.status = 'held';
$$;

-- «Отменить проведение»: the lesson's teacher (lessons.teacher_id), the consumed marks and what the
-- month's base_amount of v_payroll_preview drops by (it rounds the month sum, so the drop is
-- round(month) − round(month − lesson), not the lesson rounded alone). Admin only.
create or replace function public.lesson_payroll_impact(p_lesson_id uuid)
returns table (
  teacher_id uuid,
  teacher_name text,
  marks integer,
  amount integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_lesson_pay numeric;
  v_month_pay numeric;
begin
  perform public.assert_admin();
  select * into v_lesson from public.lessons l where l.id = p_lesson_id;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'no_data_found';
  end if;

  v_lesson_pay := public.lesson_pay_exact(p_lesson_id);
  select coalesce(sum(public.lesson_pay_exact(l.id)), 0) into v_month_pay
  from public.lessons l
  where l.teacher_id = v_lesson.teacher_id and l.status = 'held'
    and date_trunc('month', l.lesson_date) = date_trunc('month', v_lesson.lesson_date);

  return query
  select
    v_lesson.teacher_id,
    t.full_name,
    case when v_lesson.status = 'held' then (
      select count(*)::integer from public.attendance a
      where a.lesson_id = p_lesson_id and a.consumes_credit
    ) else 0 end,
    (round(v_month_pay) - round(v_month_pay - v_lesson_pay))::integer
  from public.teachers t
  where t.id = v_lesson.teacher_id;
end;
$$;

-- ─── unconfirm_lesson ───────────────────────────────────────────────────────

create or replace function public.unconfirm_lesson(p_lesson_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_lesson public.lessons%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may unconfirm a lesson' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);

  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'no_data_found';
  end if;
  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status <> 'held' then
    raise exception 'lesson % is not held', p_lesson_id using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);

  delete from public.attendance a where a.lesson_id = p_lesson_id;

  update public.attendance_correction_requests
  set status = 'rejected',
      decision_comment = left('занятие возвращено в запланированные: ' || v_reason, 500)
  where lesson_id = p_lesson_id and status = 'pending';

  perform set_config('iqup.admin_edit', 'on', true);
  update public.lessons set status = 'planned' where id = p_lesson_id;
  perform set_config('iqup.admin_edit', '', true);

  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.lesson_pay_exact(uuid) from public, anon, authenticated;
revoke execute on function public.lesson_payroll_impact(uuid) from public, anon;
grant execute on function public.lesson_payroll_impact(uuid) to authenticated;
revoke execute on function public.unconfirm_lesson(uuid, text) from public, anon;
grant execute on function public.unconfirm_lesson(uuid, text) to authenticated;

-- ─── v_audit_feed ───────────────────────────────────────────────────────────

-- Same as 0019 plus: the lesson row of unconfirm_lesson (held → planned) carries marks = statuses of
-- the marks deleted in the same transaction, and amount (appended) = the teacher's pay of those
-- marks, priced as v_payroll_preview (subscription price, К6; hours, И62) — «−1 050 сом».
create or replace view public.v_audit_feed
with (security_invoker = true)
as
select
  a.id,
  a.actor_id,
  a.entity,
  a.entity_id,
  a.action,
  a.before,
  a.after,
  a.reason,
  a.at,
  a.kind,
  case
    when a.entity = 'lessons' and a.reason = 'confirm_lesson' then (
      select coalesce(jsonb_agg(m.after ->> 'status' order by m.after ->> 'status'), '[]'::jsonb)
      from public.audit_log m
      where m.entity = 'attendance'
        and m.reason = 'confirm_lesson'
        and m.at = a.at
        and m.after ->> 'lesson_id' = a.entity_id::text
    )
    when a.entity = 'lessons' and a.action = 'update'
         and a.before ->> 'status' = 'held' and a.after ->> 'status' = 'planned' then (
      select coalesce(jsonb_agg(m.before ->> 'status' order by m.before ->> 'status'), '[]'::jsonb)
      from public.audit_log m
      where m.entity = 'attendance'
        and m.action = 'delete'
        and m.at = a.at
        and m.before ->> 'lesson_id' = a.entity_id::text
    )
  end as marks,
  public.audit_search_text(a.entity, a.entity_id, coalesce(a.after, a.before)) as search,
  case
    when a.entity = 'lessons' and a.action = 'update'
         and a.before ->> 'status' = 'held' and a.after ->> 'status' = 'planned' then (
      select round(coalesce(sum(public.mark_pay(
        s.price_full, s.lessons_total, s.hours_total, r.percent, (m.before ->> 'hours')::numeric,
        public.afterschool_hour_price_on((a.before ->> 'lesson_date')::date)
      )), 0))::integer
      from public.audit_log m
      left join public.subscriptions s on s.id = (m.before ->> 'subscription_id')::uuid
      left join lateral (
        select tr.percent
        from public.teacher_rates tr
        where tr.teacher_id = (a.before ->> 'teacher_id')::uuid
          and tr.valid_from <= (a.before ->> 'lesson_date')::date
        order by tr.valid_from desc
        limit 1
      ) r on true
      where m.entity = 'attendance'
        and m.action = 'delete'
        and m.at = a.at
        and m.before ->> 'lesson_id' = a.entity_id::text
        and m.before ->> 'status' in ('present', 'absent_burned')
    )
  end as amount
from public.audit_log a
where not (a.entity = 'attendance' and a.reason is not distinct from 'confirm_lesson');

comment on view public.v_audit_feed is
  'А10 journal: audit_log + kind (late/retro/payment/attendance/other, stored); confirm_lesson marks folded into the lesson row; unconfirm_lesson — deleted marks and the teacher''s pay of them (amount); search — current names (person_name_key).';

revoke all on public.v_audit_feed from anon, authenticated;
grant select on public.v_audit_feed to authenticated;
