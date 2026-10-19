-- #94 · «Админ может всё»: правка и удаление любых записей — ревизия гардов. Docs: 05-decisions Г9,
-- И77–И87 (И8, И21, И51, И52, И53 — пересмотрены); 01-domain-model; CLAUDE.md invariants 1–2, 4.
--
-- The admin is a superadmin (Г9): nothing is «impossible», but every destructive change goes through a
-- security definer RPC with an admin check, a reason 1…500 (assert_edit_reason, 0026) and a row in
-- audit_log (invariant 4); what moves accrued payroll shows «before → after» first. Guards let such a
-- change through only inside its RPC: set_config('iqup.admin_edit', 'on', true), cleared right after
-- (the #92 / #95 pattern). No RLS write policy is added. The one wall left — a closed period (Кайрат
-- 19.10, вопрос 1): nothing changes in it; the admin reopens it with a reason first.
--
--   1. payroll_periods (И77) — a closed month. close_payroll_period (admin, accountant) locks every
--      lesson of the month (lessons.is_locked — every guard already refuses locked rows),
--      reopen_payroll_period (admin, reason) unlocks them. No lesson is inserted into / moved into a
--      closed month; payroll_month_locked (advances) is true for a closed month.
--   2. update_payroll_adjustment (И78) — amount, issue date, payroll month, comment of an advance.
--   3. update_lesson (И79) — date, time, duration, teacher, substitute of a planned or held lesson;
--      lesson_edit_payroll_impact — who gains / loses what. A held lesson's date / time / duration /
--      teacher change only inside update_lesson or change_group_teacher (lessons_guard).
--   4. Tariffs (И80): update_tariff_version / delete_tariff_version — a version in effect too, with a
--      reason; plan_tariffs_from_today — «Применить с сегодняшнего дня» (К6 stays the default).
--   5. Holidays (И81): save_holiday / delete_holidays — a past day too, with a reason; planned lessons
--      of the day are cancelled (holiday) / restored and generated back; held ones stay. holidays get
--      an id and the audit trigger. A direct write of a signed-in user is refused.
--   6. Trials (И82): update_trial (name, class, phone, source, note, lesson) in any status,
--      reopen_trial — «Вернуть в воронку» from closed.
--   7. delete_correction_request (И83) — a mistaken request, with a reason (audit on delete).
--   8. delete_group(id, reason) + group_delete_preview / group_payroll_impact (И84, И51 revised): any
--      group without money and outside a closed period — the lot with its marks; with payments —
--      refused (transfer the students, И57, or archive).
--   9. delete_student + student_delete_preview / student_payroll_impact (И85).
--  10. delete_subject (И86) — a subject no group uses.
--  The journal (audit_log) stays read-only forever.
-- Production-safe: additive DDL (a table, a column with a default, functions, triggers); replaced
-- functions keep their signatures (delete_group gets an overload, the old one stays); no data rows
-- change except the stored audit_log.kind recomputed for held lesson updates.

-- ─── 0. payroll_periods ─────────────────────────────────────────────────────

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  comment text check (comment is null or length(comment) between 1 and 500),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz not null default now()
);

comment on table public.payroll_periods is
  'Closed payroll months (#94, И77): a row = the month is closed, its lessons are locked. Written only by close_ / reopen_payroll_period.';

-- A date in a closed payroll month.
create or replace function public.payroll_month_closed(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payroll_periods p where p.month = date_trunc('month', p_date)::date
  );
$$;

revoke execute on function public.payroll_month_closed(date) from public, anon, authenticated;

-- Insert / delete only inside close_ / reopen_payroll_period; never edited; author and time — the DB's.
create or replace function public.payroll_periods_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a payroll period is not edited — reopen it and close again'
      using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() is not null and coalesce(current_setting('iqup.admin_edit', true), '') <> 'on' then
    raise exception 'payroll periods are changed only by close_payroll_period / reopen_payroll_period'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.closed_at := now();
  new.closed_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.payroll_periods_guard() from public, anon, authenticated;

drop trigger if exists payroll_periods_guard on public.payroll_periods;
create trigger payroll_periods_guard
before insert or update or delete on public.payroll_periods
for each row execute function public.payroll_periods_guard();

drop trigger if exists audit_log on public.payroll_periods;
create trigger audit_log after insert or update or delete on public.payroll_periods
for each row execute function public.write_audit_log();

alter table public.payroll_periods enable row level security;

-- Everyone signed in reads (a teacher's «Мой месяц» may say «период закрыт»); no write policy.
drop policy if exists payroll_periods_select on public.payroll_periods;
create policy payroll_periods_select on public.payroll_periods for select to authenticated
  using (true);

revoke all on public.payroll_periods from anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'payroll_periods') then
    alter publication supabase_realtime add table public.payroll_periods;
  end if;
end;
$$;

-- Advances (0022): a month is closed for them when it is a closed period too.
create or replace function public.payroll_month_locked(p_teacher_id uuid, p_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.payroll_month_closed(p_month) or exists (
    select 1 from public.lessons l
    where l.teacher_id = p_teacher_id
      and l.is_locked
      and l.lesson_date >= p_month
      and l.lesson_date < (p_month + interval '1 month')::date
  );
$$;

revoke execute on function public.payroll_month_locked(uuid, date) from public, anon, authenticated;

-- ─── 1. lessons_guard ───────────────────────────────────────────────────────

-- Same as 0027 plus (#94):
--   * no lesson is inserted into a closed payroll month, none moves into one;
--   * close_payroll_period (iqup.admin_edit) may lock a lesson — is_locked only, an accountant too;
--   * a held lesson's date / time / duration / teacher change only with iqup.admin_edit
--     (update_lesson, change_group_teacher); the service role (no auth.uid()) is not restricted.
create or replace function public.lessons_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mutable constant text[] := array['status', 'comment', 'confirmed_at', 'confirmed_by', 'confirmed_late'];
  v_admin_edit constant boolean := coalesce(current_setting('iqup.admin_edit', true), '') = 'on';
  v_unconfirm boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_locked then
      raise exception 'lesson % is in a closed period', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if public.payroll_month_closed(new.lesson_date) then
      raise exception 'payroll month % is closed', to_char(new.lesson_date, 'YYYY-MM')
        using errcode = 'check_violation';
    end if;
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

  -- close_payroll_period (#94): the month's lessons are locked — is_locked only
  if v_admin_edit and new.is_locked
     and (to_jsonb(new) - 'is_locked') = (to_jsonb(old) - 'is_locked') then
    return new;
  end if;

  if new.lesson_date <> old.lesson_date and public.payroll_month_closed(new.lesson_date) then
    raise exception 'payroll month % is closed', to_char(new.lesson_date, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;

  if old.status = 'held' and auth.uid() is not null and not v_admin_edit and (
    new.lesson_date <> old.lesson_date
    or new.planned_start <> old.planned_start
    or new.duration_min <> old.duration_min
    or new.teacher_id is distinct from old.teacher_id
  ) then
    raise exception 'a held lesson is changed only by update_lesson' using errcode = 'check_violation';
  end if;

  v_unconfirm := old.status = 'held' and new.status = 'planned';
  if v_unconfirm and not v_admin_edit then
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

-- Locking a month touches every lesson of it: those rows (is_locked only) stay out of the journal —
-- the payroll_periods row says it once.
drop trigger if exists audit_log on public.lessons;
drop trigger if exists audit_log_update on public.lessons;
create trigger audit_log after insert or delete on public.lessons
for each row execute function public.write_audit_log();
create trigger audit_log_update after update on public.lessons
for each row
when ((to_jsonb(old) - 'is_locked') is distinct from (to_jsonb(new) - 'is_locked'))
execute function public.write_audit_log();

-- change_group_teacher (0020): the same, the held lessons move under iqup.admin_edit.
create or replace function public.change_group_teacher(
  p_group_id uuid,
  p_teacher_id uuid,
  p_from date default null
)
returns table (lessons_moved integer, lessons_held integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_from date;
  v_moved integer;
  v_held integer;
begin
  perform public.assert_admin();

  select * into v_group from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if p_teacher_id is null or not exists (select 1 from public.teachers t where t.id = p_teacher_id) then
    raise exception 'teacher % not found', p_teacher_id using errcode = 'foreign_key_violation';
  end if;
  v_from := coalesce(p_from, v_group.start_date);

  -- groups.teacher_id switches at once, so a future date would hand lessons regenerated before it
  -- (reschedule / extra lesson / earlier start) to the new teacher — only today or earlier.
  if v_from > public.bishkek_today() then
    raise exception 'teacher change date % is in the future', v_from using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.lessons l
    where l.group_id = p_group_id and l.lesson_date >= v_from and l.is_locked
      and l.teacher_id is distinct from p_teacher_id
  ) then
    raise exception 'lessons from % are in a closed period', v_from using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'change_group_teacher:' || v_from::text, true);
  perform set_config('iqup.admin_edit', 'on', true);

  with moved as (
    update public.lessons l
    set teacher_id = p_teacher_id
    where l.group_id = p_group_id and l.lesson_date >= v_from and l.teacher_id is distinct from p_teacher_id
    returning l.status
  )
  select count(*)::integer, count(*) filter (where status = 'held')::integer
  into v_moved, v_held
  from moved;

  perform set_config('iqup.admin_edit', '', true);

  if v_group.teacher_id is distinct from p_teacher_id then
    update public.groups set teacher_id = p_teacher_id where id = p_group_id;
  end if;

  perform set_config('iqup.audit_reason', '', true);
  return query select v_moved, v_held;
end;
$$;

-- ─── 2. close / reopen a payroll period ─────────────────────────────────────

-- «Закрыть месяц» (Б1, design Б1б): a month that is over; every lesson of it is locked (planned ones
-- too — they stay unconfirmed, the checklist warns, it does not block). Admin or accountant.
-- Returns the number of lessons locked.
create or replace function public.close_payroll_period(p_month date, p_comment text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_locked integer;
begin
  perform public.assert_payroll_staff();
  if p_month is null then
    raise exception 'month is required' using errcode = 'check_violation';
  end if;
  if v_month >= date_trunc('month', public.bishkek_today())::date then
    raise exception 'payroll month % is not over yet', to_char(v_month, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'comment is too long' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payroll_periods p where p.month = v_month) then
    raise exception 'payroll month % is already closed', to_char(v_month, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', coalesce(v_comment, ''), true);
  perform set_config('iqup.admin_edit', 'on', true);
  insert into public.payroll_periods (month, comment) values (v_month, v_comment);
  with locked as (
    update public.lessons l set is_locked = true
    where l.lesson_date >= v_month and l.lesson_date < (v_month + interval '1 month')::date
      and not l.is_locked
    returning 1
  )
  select count(*)::integer into v_locked from locked;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_locked;
end;
$$;

-- «Открыть месяц»: admin only, with a reason; the month's lessons are unlocked. Returns their number.
create or replace function public.reopen_payroll_period(p_month date, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_reason text;
  v_unlocked integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may reopen a payroll period' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);
  if not exists (select 1 from public.payroll_periods p where p.month = v_month) then
    raise exception 'payroll month % is not closed', to_char(v_month, 'YYYY-MM')
      using errcode = 'no_data_found';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  delete from public.payroll_periods p where p.month = v_month;
  perform set_config('iqup.admin_edit', '', true);
  with unlocked as (
    update public.lessons l set is_locked = false
    where l.lesson_date >= v_month and l.lesson_date < (v_month + interval '1 month')::date
      and l.is_locked
    returning 1
  )
  select count(*)::integer into v_unlocked from unlocked;
  perform set_config('iqup.audit_reason', '', true);
  return v_unlocked;
end;
$$;

revoke execute on function public.close_payroll_period(date, text) from public, anon;
grant execute on function public.close_payroll_period(date, text) to authenticated;
revoke execute on function public.reopen_payroll_period(date, text) from public, anon;
grant execute on function public.reopen_payroll_period(date, text) to authenticated;

-- ─── 3. advances: update_payroll_adjustment ─────────────────────────────────

-- Same as 0022 plus UPDATE inside update_payroll_adjustment (iqup.admin_edit): teacher, kind, author
-- and time never change; neither the old nor the new month may be closed.
create or replace function public.payroll_adjustments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('iqup.admin_edit', true), '') <> 'on' then
      raise exception 'payroll adjustments are changed only by update_payroll_adjustment'
        using errcode = 'insufficient_privilege';
    end if;
    if new.teacher_id <> old.teacher_id or new.kind <> old.kind or new.id <> old.id then
      raise exception 'teacher and kind of an adjustment do not change' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if public.payroll_month_locked(old.teacher_id, old.month) then
      raise exception 'payroll month % is closed', to_char(old.month, 'YYYY-MM')
        using errcode = 'check_violation';
    end if;
  elsif tg_op = 'DELETE' then
    if public.payroll_month_locked(old.teacher_id, old.month) then
      raise exception 'payroll month % is closed', to_char(old.month, 'YYYY-MM')
        using errcode = 'check_violation';
    end if;
    return old;
  else
    new.created_at := now();
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  end if;

  if new.issued_on > public.bishkek_today() then
    raise exception 'advance date is in the future' using errcode = 'check_violation';
  end if;
  if public.payroll_month_locked(new.teacher_id, new.month) then
    raise exception 'payroll month % is closed', to_char(new.month, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.payroll_adjustments_guard() from public, anon, authenticated;

-- «⋯ → Изменить» an advance (Б1): amount, issue date, payroll month (that of the issue date or a
-- neighbour, as issue_advance), comment; a reason. Admin only. Null date / month — keep.
create or replace function public.update_payroll_adjustment(
  p_id uuid,
  p_amount integer,
  p_issued_on date,
  p_month date,
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
  v_row public.payroll_adjustments%rowtype;
  v_issued date;
  v_month date;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may edit an advance' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);

  select * into v_row from public.payroll_adjustments a where a.id = p_id for update;
  if not found then
    raise exception 'payroll adjustment % not found', p_id using errcode = 'no_data_found';
  end if;
  v_issued := coalesce(p_issued_on, v_row.issued_on);
  v_month := date_trunc('month', coalesce(p_month, v_row.month))::date;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;
  if v_month not between (date_trunc('month', v_issued) - interval '1 month')::date
                     and (date_trunc('month', v_issued) + interval '1 month')::date then
    raise exception 'payroll month % is not next to the issue date %', to_char(v_month, 'YYYY-MM'), v_issued
      using errcode = 'check_violation';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'comment is longer than 500 characters' using errcode = 'check_violation';
  end if;

  if p_amount = v_row.amount and v_issued = v_row.issued_on and v_month = v_row.month
     and v_comment is not distinct from v_row.comment then
    return;
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  update public.payroll_adjustments
  set amount = p_amount, issued_on = v_issued, month = v_month, comment = v_comment
  where id = p_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.update_payroll_adjustment(uuid, integer, date, date, text, text)
  from public, anon;
grant execute on function public.update_payroll_adjustment(uuid, integer, date, date, text, text)
  to authenticated;

-- ─── 4. payroll impact helpers ──────────────────────────────────────────────

-- Exact pay of a held lesson's consumed marks as if it were taught by p_teacher_id on p_date (the
-- percent and the after-school hour price of that date) — lesson_pay_exact (0027) with other inputs.
create or replace function public.lesson_pay_exact_as(p_lesson_id uuid, p_teacher_id uuid, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(public.mark_pay(
    s.price_full, s.lessons_total, s.hours_total, r.percent, a.hours,
    public.afterschool_hour_price_on(p_date)
  )), 0)
  from public.lessons l
  left join lateral (
    select tr.percent
    from public.teacher_rates tr
    where tr.teacher_id = p_teacher_id and tr.valid_from <= p_date
    order by tr.valid_from desc
    limit 1
  ) r on true
  join public.attendance a on a.lesson_id = l.id and a.consumes_credit
  left join public.subscriptions s on s.id = a.subscription_id
  where l.id = p_lesson_id and l.status = 'held';
$$;

-- Exact (not rounded) accrual of a teacher's month — what v_payroll_preview.base_amount rounds.
create or replace function public.teacher_month_pay_exact(p_teacher_id uuid, p_month date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(public.lesson_pay_exact(l.id)), 0)
  from public.lessons l
  where l.teacher_id = p_teacher_id and l.status = 'held'
    and l.lesson_date >= date_trunc('month', p_month)::date
    and l.lesson_date < (date_trunc('month', p_month) + interval '1 month')::date;
$$;

-- What the teachers lose when these marks go: per teacher and month, the drop of
-- v_payroll_preview.base_amount = round(month) − round(month − marks) (the month sum is rounded once).
create or replace function public.marks_payroll_drop(p_attendance_ids uuid[])
returns table (teacher_id uuid, teacher_name text, month date, marks integer, amount integer)
language sql
stable
set search_path = ''
as $$
  with m as (
    select
      l.teacher_id,
      date_trunc('month', l.lesson_date)::date as month,
      public.mark_pay(
        s.price_full, s.lessons_total, s.hours_total, r.percent, a.hours,
        public.afterschool_hour_price_on(l.lesson_date)
      ) as pay
    from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    left join public.subscriptions s on s.id = a.subscription_id
    left join lateral (
      select tr.percent
      from public.teacher_rates tr
      where tr.teacher_id = l.teacher_id and tr.valid_from <= l.lesson_date
      order by tr.valid_from desc
      limit 1
    ) r on true
    where a.id = any (p_attendance_ids) and a.consumes_credit and l.status = 'held'
  ),
  g as (
    select m.teacher_id, m.month, count(*)::integer as marks, coalesce(sum(m.pay), 0) as pay
    from m
    group by m.teacher_id, m.month
  )
  select
    g.teacher_id,
    t.full_name,
    g.month,
    g.marks,
    (round(x.total) - round(x.total - g.pay))::integer
  from g
  join public.teachers t on t.id = g.teacher_id
  cross join lateral (select public.teacher_month_pay_exact(g.teacher_id, g.month) as total) x
  order by g.month, t.full_name;
$$;

revoke execute on function public.lesson_pay_exact_as(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.teacher_month_pay_exact(uuid, date) from public, anon, authenticated;
revoke execute on function public.marks_payroll_drop(uuid[]) from public, anon, authenticated;

-- ─── 5. update_lesson ───────────────────────────────────────────────────────

-- «Изменить занятие» before saving: the payroll of a held lesson moving to p_teacher_id / p_date —
-- per teacher and month, delta of v_payroll_preview.base_amount (− the old teacher / month, + the new
-- one; one row if both are the same). Not held — no rows. Admin only.
create or replace function public.lesson_edit_payroll_impact(
  p_lesson_id uuid,
  p_date date,
  p_teacher_id uuid
)
returns table (teacher_id uuid, teacher_name text, month date, amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_old_pay numeric;
  v_new_pay numeric;
  v_old_month date;
  v_new_month date;
  v_old_total numeric;
  v_new_total numeric;
begin
  perform public.assert_admin();
  select * into v_lesson from public.lessons l where l.id = p_lesson_id;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'no_data_found';
  end if;
  if v_lesson.status <> 'held' then
    return;
  end if;

  v_old_pay := public.lesson_pay_exact(p_lesson_id);
  v_new_pay := public.lesson_pay_exact_as(
    p_lesson_id, coalesce(p_teacher_id, v_lesson.teacher_id), coalesce(p_date, v_lesson.lesson_date)
  );
  v_old_month := date_trunc('month', v_lesson.lesson_date)::date;
  v_new_month := date_trunc('month', coalesce(p_date, v_lesson.lesson_date))::date;
  v_old_total := public.teacher_month_pay_exact(v_lesson.teacher_id, v_old_month);

  if coalesce(p_teacher_id, v_lesson.teacher_id) = v_lesson.teacher_id and v_new_month = v_old_month then
    return query
    select v_lesson.teacher_id, t.full_name, v_old_month,
           (round(v_old_total - v_old_pay + v_new_pay) - round(v_old_total))::integer
    from public.teachers t where t.id = v_lesson.teacher_id;
    return;
  end if;

  v_new_total := public.teacher_month_pay_exact(coalesce(p_teacher_id, v_lesson.teacher_id), v_new_month);
  return query
  select v_lesson.teacher_id, t.full_name, v_old_month,
         (round(v_old_total - v_old_pay) - round(v_old_total))::integer
  from public.teachers t where t.id = v_lesson.teacher_id
  union all
  select t.id, t.full_name, v_new_month,
         (round(v_new_total + v_new_pay) - round(v_new_total))::integer
  from public.teachers t where t.id = coalesce(p_teacher_id, v_lesson.teacher_id);
end;
$$;

-- «Изменить занятие» (А4 / карточка занятия): date, time, duration, teacher (the payroll owner, И49),
-- substitute (informational, А7) of a planned or held lesson, with a reason. A held lesson: not into
-- the future (it was held), its students on the roster of the new date; an after-school lesson with
-- hour marks keeps its date and duration (the hours and the month invoice follow the date — undo the
-- confirmation and hold it again, И76). Not cancelled, not in / into a closed period.
create or replace function public.update_lesson(
  p_lesson_id uuid,
  p_date date,
  p_start time,
  p_duration_min integer,
  p_teacher_id uuid,
  p_substitute_teacher_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_lesson public.lessons%rowtype;
  v_student uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may edit a lesson' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);

  select * into v_lesson from public.lessons l where l.id = p_lesson_id for update;
  if not found then
    raise exception 'lesson % not found', p_lesson_id using errcode = 'no_data_found';
  end if;
  if v_lesson.is_locked then
    raise exception 'lesson % is in a closed period', p_lesson_id using errcode = 'check_violation';
  end if;
  if v_lesson.status = 'cancelled' then
    raise exception 'lesson % is cancelled', p_lesson_id using errcode = 'check_violation';
  end if;
  if p_date is null or p_start is null or p_teacher_id is null then
    raise exception 'date, time and teacher are required' using errcode = 'check_violation';
  end if;
  if p_duration_min is null or p_duration_min not between 15 and 600 then
    raise exception 'duration must be between 15 and 600 minutes' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.teachers t where t.id = p_teacher_id) then
    raise exception 'teacher % not found', p_teacher_id using errcode = 'foreign_key_violation';
  end if;
  if p_substitute_teacher_id is not null
     and not exists (select 1 from public.teachers t where t.id = p_substitute_teacher_id) then
    raise exception 'teacher % not found', p_substitute_teacher_id using errcode = 'foreign_key_violation';
  end if;
  if public.payroll_month_closed(p_date) then
    raise exception 'payroll month % is closed', to_char(p_date, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  if v_lesson.status = 'held' then
    if (p_date + p_start) at time zone 'Asia/Bishkek' > now() then
      raise exception 'a held lesson cannot move to the future' using errcode = 'check_violation';
    end if;
    if (p_date <> v_lesson.lesson_date or p_duration_min <> v_lesson.duration_min)
       and exists (select 1 from public.attendance a where a.lesson_id = p_lesson_id and a.hours is not null)
    then
      raise exception 'an after-school lesson with hour marks keeps its date and duration'
        using errcode = 'check_violation';
    end if;
    if p_date <> v_lesson.lesson_date then
      select a.student_id into v_student
      from public.attendance a
      where a.lesson_id = p_lesson_id and not exists (
        select 1 from public.enrollments e
        where e.group_id = v_lesson.group_id and e.student_id = a.student_id
          and e.start_date <= p_date
          and (e.end_date >= p_date or (e.end_date is null and e.status = 'active'))
      )
      limit 1;
      if v_student is not null then
        raise exception 'student % is not enrolled in the group on %', v_student, p_date
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if p_date = v_lesson.lesson_date and p_start = v_lesson.planned_start
     and p_duration_min = v_lesson.duration_min and p_teacher_id = v_lesson.teacher_id
     and p_substitute_teacher_id is not distinct from v_lesson.substitute_teacher_id then
    return;
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  update public.lessons
  set lesson_date = p_date, planned_start = p_start, duration_min = p_duration_min,
      teacher_id = p_teacher_id, substitute_teacher_id = p_substitute_teacher_id
  where id = p_lesson_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.lesson_edit_payroll_impact(uuid, date, uuid) from public, anon;
grant execute on function public.lesson_edit_payroll_impact(uuid, date, uuid) to authenticated;
revoke execute on function public.update_lesson(uuid, date, time, integer, uuid, uuid, text) from public, anon;
grant execute on function public.update_lesson(uuid, date, time, integer, uuid, uuid, text) to authenticated;

-- ─── 6. tariffs ─────────────────────────────────────────────────────────────

-- Same as 0012 plus (#94): inside update_tariff_version / delete_tariff_version (iqup.admin_edit) a
-- version in effect may change its prices or go; plan_tariffs_from_today (the flag too) may start a
-- version today although the type has subscriptions (К6 stays the default for a plain insert).
create or replace function public.tariffs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edit constant boolean := coalesce(current_setting('iqup.admin_edit', true), '') = 'on';
  v_min date;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.valid_from <= public.bishkek_today() and not v_edit then
    raise exception 'tariff in effect since % cannot be changed — plan a new version', old.valid_from
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and v_edit then
    if new.valid_from <> old.valid_from or new.group_type <> old.group_type then
      raise exception 'date and group type of a tariff version do not change' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    return new;
  end if;

  -- Admin from the app (others never get past RLS; the check runs before it, so keep their 42501).
  if public.is_admin() then
    v_min := case when v_edit then public.bishkek_today() else public.tariff_min_valid_from(new.group_type) end;
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

revoke execute on function public.tariffs_guard() from public, anon, authenticated;

-- «Изменить версию» (А9а): package prices by group type ({"group": 3300, …}) and the after-school
-- hour price (null — package / hours) of the version from p_valid_from, a version in effect too.
-- Subscriptions keep their price_full (К6): the payroll of their marks does not move; new subscriptions
-- take the new price. After-school marks with no invoice yet (И69) are priced by the hour price on
-- their date — they follow. Admin, a reason. Returns the rows changed.
create or replace function public.update_tariff_version(
  p_valid_from date,
  p_prices jsonb,
  p_hour_price integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_changed integer := 0;
  v_rows integer;
  r record;
begin
  perform public.assert_admin();
  v_reason := public.assert_edit_reason(p_reason);
  if not exists (select 1 from public.tariffs t where t.valid_from = p_valid_from) then
    raise exception 'no tariff version from %', p_valid_from using errcode = 'no_data_found';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'object' then
    raise exception 'prices are required' using errcode = 'check_violation';
  end if;
  if p_hour_price is not null and p_hour_price <= 0 then
    raise exception 'hour price must be positive' using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  for r in select key, value from jsonb_each(p_prices) loop
    if r.key not in ('group', 'mini', 'pair', 'individual', 'afterschool') then
      raise exception 'unknown group type %', r.key using errcode = 'check_violation';
    end if;
    if jsonb_typeof(r.value) <> 'number' or (r.value #>> '{}')::numeric <= 0
       or (r.value #>> '{}')::numeric <> trunc((r.value #>> '{}')::numeric) then
      raise exception 'price must be a positive whole number' using errcode = 'check_violation';
    end if;
    update public.tariffs t
    set package_price = (r.value #>> '{}')::integer,
        hour_price = case when t.group_type = 'afterschool' then p_hour_price else t.hour_price end
    where t.valid_from = p_valid_from and t.group_type = r.key::public.group_type
      and (t.package_price <> (r.value #>> '{}')::integer
           or (t.group_type = 'afterschool' and t.hour_price is distinct from p_hour_price));
    get diagnostics v_rows = row_count;
    v_changed := v_changed + v_rows;
  end loop;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_changed;
end;
$$;

-- «Удалить версию»: a version nobody bought a subscription on (FK); one in effect only if every type
-- has an earlier version to fall back to. Admin, a reason. Returns the rows deleted.
create or replace function public.delete_tariff_version(p_valid_from date, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_deleted integer;
begin
  perform public.assert_admin();
  v_reason := public.assert_edit_reason(p_reason);
  if not exists (select 1 from public.tariffs t where t.valid_from = p_valid_from) then
    raise exception 'no tariff version from %', p_valid_from using errcode = 'no_data_found';
  end if;
  if exists (
    select 1 from public.subscriptions s
    join public.tariffs t on t.id = s.tariff_id
    where t.valid_from = p_valid_from
  ) then
    raise exception 'subscriptions were bought on the version from %', p_valid_from
      using errcode = 'foreign_key_violation';
  end if;
  if p_valid_from <= public.bishkek_today() and exists (
    select 1 from public.tariffs t
    where t.valid_from = p_valid_from
      and not exists (
        select 1 from public.tariffs e where e.group_type = t.group_type and e.valid_from < p_valid_from
      )
  ) then
    raise exception 'the version from % has no earlier version to fall back to', p_valid_from
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  with gone as (
    delete from public.tariffs t where t.valid_from = p_valid_from returning 1
  )
  select count(*)::integer into v_deleted from gone;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_deleted;
end;
$$;

-- «Новая версия тарифов» + «Применить с сегодняшнего дня» (решение Кайрата 19.10): the rows
-- ([{group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit,
-- hour_price}]) start today even if the type has subscriptions (К6 is the default otherwise).
-- Subscriptions already bought keep their price — payroll does not move. Admin. Returns rows inserted.
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
           coalesce(x.freeze_limit, 2), x.hour_price, public.bishkek_today()
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

revoke execute on function public.update_tariff_version(date, jsonb, integer, text) from public, anon;
grant execute on function public.update_tariff_version(date, jsonb, integer, text) to authenticated;
revoke execute on function public.delete_tariff_version(date, text) from public, anon;
grant execute on function public.delete_tariff_version(date, text) to authenticated;
revoke execute on function public.plan_tariffs_from_today(jsonb) from public, anon;
grant execute on function public.plan_tariffs_from_today(jsonb) to authenticated;

-- ─── 7. holidays ────────────────────────────────────────────────────────────

-- An id for audit_log.entity_id (the key stays the day).
alter table public.holidays add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists holidays_id_key on public.holidays (id);

-- Signed-in users write only through save_holiday / delete_holidays (iqup.admin_edit): those keep the
-- lessons of the day in step. The service role (seed, import) as in 0006: a past day is not edited.
create or replace function public.holidays_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('iqup.admin_edit', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if tg_op = 'UPDATE' and (new.day <> old.day or new.id <> old.id) then
      raise exception 'a holiday is renamed, not moved' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if auth.uid() is not null then
    raise exception 'holidays are changed only by save_holiday / delete_holidays'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.day < public.bishkek_today() then
    raise exception 'past holiday % cannot be changed', old.day using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.holidays_guard() from public, anon, authenticated;

drop trigger if exists audit_log on public.holidays;
create trigger audit_log after insert or update or delete on public.holidays
for each row execute function public.write_audit_log();

-- The planned lessons a holiday on p_day cancels (holiday), the ones its removal brings back
-- (cancelled for the holiday), and the held ones that stay as they are. Admin.
create or replace function public.holiday_lessons(p_day date)
returns table (planned integer, restored integer, held integer, locked integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
  select
    (count(*) filter (where l.status = 'planned'))::integer,
    (count(*) filter (where l.status = 'cancelled' and l.cancel_reason = 'holiday'))::integer,
    (count(*) filter (where l.status = 'held'))::integer,
    (count(*) filter (where l.is_locked))::integer
  from public.lessons l
  where l.lesson_date = p_day;
end;
$$;

-- The planned lessons of every running group on one day, from its schedule (generate_lessons, 0008,
-- for one date): a holiday removed — its lessons come back. Returns the number created.
create or replace function public.generate_lessons_on(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  with slots as (
    select g.id as group_id, g.group_type, r.start_time
    from public.groups g
    join public.schedule_rules r on r.group_id = g.id
    where g.status in ('forming', 'active')
      and g.start_date <= p_day and (g.end_date is null or g.end_date >= p_day)
      and r.valid_from <= p_day and (r.valid_to is null or r.valid_to >= p_day)
      and r.weekday = extract(isodow from p_day)::integer
      and not exists (select 1 from public.holidays h where h.day = p_day)
  ),
  inserted as (
    insert into public.lessons (group_id, lesson_date, planned_start, duration_min)
    select s.group_id, p_day, s.start_time, public.tariff_duration(s.group_type, p_day)
    from slots s
    where public.tariff_duration(s.group_type, p_day) is not null
    on conflict (group_id, lesson_date, planned_start) do nothing
    returning 1
  )
  select count(*)::integer into v_created from inserted;
  return v_created;
end;
$$;

revoke execute on function public.generate_lessons_on(date) from public, anon, authenticated;

-- «+ Добавить» / rename a holiday (А9): a past day too, then with a reason (journal). A new holiday
-- cancels the planned lessons of the day (cancel_reason holiday; the held ones stay); a closed period —
-- refused. Admin. Returns the lessons cancelled.
create or replace function public.save_holiday(p_day date, p_name text, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_reason text;
  v_old public.holidays%rowtype;
  v_cancelled integer := 0;
begin
  perform public.assert_admin();
  if p_day is null then
    raise exception 'day is required' using errcode = 'check_violation';
  end if;
  if length(v_name) = 0 or length(v_name) > 100 then
    raise exception 'holiday name must be 1…100 characters' using errcode = 'check_violation';
  end if;
  if p_day < public.bishkek_today() then
    v_reason := public.assert_edit_reason(p_reason);
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;
  if public.payroll_month_closed(p_day) then
    raise exception 'payroll month % is closed', to_char(p_day, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', coalesce(v_reason, ''), true);
  perform set_config('iqup.admin_edit', 'on', true);
  select * into v_old from public.holidays h where h.day = p_day for update;
  if found then
    if v_old.name <> v_name then
      update public.holidays set name = v_name where day = p_day;
    end if;
  else
    insert into public.holidays (day, name) values (p_day, v_name);
    delete from public.attendance a
    using public.lessons l
    where l.id = a.lesson_id and l.lesson_date = p_day and l.status = 'planned';
    with cancelled as (
      update public.lessons l
      set status = 'cancelled', cancel_reason = 'holiday'
      where l.lesson_date = p_day and l.status = 'planned'
      returning 1
    )
    select count(*)::integer into v_cancelled from cancelled;
  end if;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_cancelled;
end;
$$;

-- «✕» a holiday (several days of one name at once, А9): a past day too, then with a reason. The
-- lessons cancelled for it come back as planned and the missing ones are generated from the schedule;
-- a closed period — refused. Admin. Returns the lessons planned again (restored + created).
create or replace function public.delete_holidays(p_days date[], p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_day date;
  v_rows integer;
  v_planned integer := 0;
begin
  perform public.assert_admin();
  if p_days is null or cardinality(p_days) = 0 then
    raise exception 'days are required' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(p_days) d where d < public.bishkek_today()) then
    v_reason := public.assert_edit_reason(p_reason);
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;
  if exists (select 1 from unnest(p_days) d where public.payroll_month_closed(d)) then
    raise exception 'payroll month is closed' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(p_days) d where not exists (select 1 from public.holidays h where h.day = d)) then
    raise exception 'holiday not found' using errcode = 'no_data_found';
  end if;

  perform set_config('iqup.audit_reason', coalesce(v_reason, ''), true);
  perform set_config('iqup.admin_edit', 'on', true);
  delete from public.holidays h where h.day = any (p_days);
  foreach v_day in array p_days loop
    update public.lessons l
    set status = 'planned', cancel_reason = null
    where l.lesson_date = v_day and l.status = 'cancelled' and l.cancel_reason = 'holiday';
    get diagnostics v_rows = row_count;
    v_planned := v_planned + v_rows + public.generate_lessons_on(v_day);
  end loop;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_planned;
end;
$$;

revoke execute on function public.holiday_lessons(date) from public, anon;
grant execute on function public.holiday_lessons(date) to authenticated;
revoke execute on function public.save_holiday(date, text, text) from public, anon;
grant execute on function public.save_holiday(date, text, text) to authenticated;
revoke execute on function public.delete_holidays(date[], text) from public, anon;
grant execute on function public.delete_holidays(date[], text) to authenticated;

-- ─── 8. trials ──────────────────────────────────────────────────────────────

-- Same as 0020 plus (#94), first: inside update_trial / reopen_trial (iqup.admin_edit) a trial in any
-- status changes its lead fields; its lesson — while scheduled (a planned lesson today or later) or
-- attended / no_show (a lesson that took place: not cancelled, not in the future); closed goes back
-- to scheduled / attended / no_show. Identity, author, student and enrollment never change there.
create or replace function public.trials_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons%rowtype;
  v_student public.students%rowtype;
  v_teacher_cols constant text[] := array['status', 'came', 'marked_at', 'marked_by'];
  v_backdated boolean := false;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('iqup.admin_edit', true), '') = 'on' then
    if new.id <> old.id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at or new.student_id is distinct from old.student_id
       or new.enrollment_id is distinct from old.enrollment_id then
      raise exception 'trial identity cannot be changed' using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'closed' and new.status in ('scheduled', 'attended', 'no_show')) then
      raise exception 'trial cannot go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    select * into v_lesson from public.lessons l where l.id = new.lesson_id;
    if not found then
      raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
    end if;
    new.group_id := v_lesson.group_id;
    if new.lesson_id <> old.lesson_id then
      if new.status in ('enrolled', 'closed') then
        raise exception 'a decided trial keeps its lesson' using errcode = 'check_violation';
      end if;
      if new.status = 'scheduled'
         and (v_lesson.status <> 'planned' or v_lesson.lesson_date < public.bishkek_today()) then
        raise exception 'a trial is booked on a planned lesson today or later' using errcode = 'check_violation';
      end if;
      if new.status in ('attended', 'no_show')
         and (v_lesson.status = 'cancelled' or v_lesson.lesson_date > public.bishkek_today()) then
        raise exception 'the trial lesson must have taken place' using errcode = 'check_violation';
      end if;
      if exists (select 1 from public.groups g where g.id = v_lesson.group_id and g.status = 'archived') then
        raise exception 'group % is archived', v_lesson.group_id using errcode = 'check_violation';
      end if;
    end if;
    if new.status = 'scheduled' and old.status <> 'scheduled' then
      new.came := null;
      new.marked_at := null;
      new.marked_by := null;
    else
      new.came := old.came;
      new.marked_at := old.marked_at;
      new.marked_by := old.marked_by;
    end if;
    return new;
  end if;

  -- remove_enrollment (0020): the enrollment made from this trial was a mistake — enrolled → attended,
  -- nothing else changes. The flag is set only inside that admin RPC, for that enrollment.
  if tg_op = 'UPDATE' and old.status = 'enrolled' and new.status = 'attended' and new.enrollment_id is null
     and current_setting('iqup.undo_enrollment', true) = old.enrollment_id::text
     and (to_jsonb(new) - array['status', 'enrollment_id'])
         = (to_jsonb(old) - array['status', 'enrollment_id']) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('attended', 'no_show') then
      -- «Уже был(а)»: the admin books and marks at once (a teacher never inserts: RLS + this check).
      if auth.uid() is not null and not public.is_admin() then
        raise exception 'only an admin books a trial after the fact' using errcode = 'insufficient_privilege';
      end if;
      v_backdated := true;
    elsif new.status <> 'scheduled' then
      raise exception 'a trial starts as scheduled' using errcode = 'check_violation';
    end if;
    new.came := null;
    new.marked_at := null;
    new.marked_by := null;
    new.enrollment_id := null;
    new.created_by := auth.uid();
    new.created_at := now();

    if new.student_id is not null then
      select * into v_student from public.students s where s.id = new.student_id;
      if not found then
        raise exception 'student % not found', new.student_id using errcode = 'foreign_key_violation';
      end if;
      new.full_name := v_student.full_name;
      new.grade := coalesce(new.grade, v_student.grade);
      new.parent_phone := coalesce(new.parent_phone, v_student.parent_phone);
    end if;
  else
    if old.status in ('enrolled', 'closed') then
      raise exception 'trial % is already decided', old.id using errcode = 'check_violation';
    end if;
    if new.id <> old.id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at then
      raise exception 'trial identity cannot be changed' using errcode = 'check_violation';
    end if;
    if new.student_id is distinct from old.student_id and new.status <> 'enrolled' then
      raise exception 'trial student changes only on enrollment' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_lesson from public.lessons l where l.id = new.lesson_id;
  if not found then
    raise exception 'lesson % not found', new.lesson_id using errcode = 'foreign_key_violation';
  end if;
  new.group_id := v_lesson.group_id;

  if tg_op = 'INSERT' or new.lesson_id <> old.lesson_id then
    if v_backdated then
      -- after the fact: the lesson took place (or takes place today) — planned or held, not cancelled
      if v_lesson.status = 'cancelled' then
        raise exception 'the lesson was cancelled' using errcode = 'check_violation';
      end if;
      if v_lesson.lesson_date > public.bishkek_today() then
        raise exception 'the trial lesson is not today yet' using errcode = 'check_violation';
      end if;
      new.came := new.status = 'attended';
      new.marked_at := now();
      new.marked_by := auth.uid();
    else
      -- On insert and on «Перенести» / «Записать заново» — a planned lesson, today or later.
      if new.status <> 'scheduled' then
        raise exception 'a trial moves to another lesson only as scheduled' using errcode = 'check_violation';
      end if;
      if v_lesson.status <> 'planned' or v_lesson.lesson_date < public.bishkek_today() then
        raise exception 'a trial is booked on a planned lesson today or later' using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from public.groups g where g.id = v_lesson.group_id and g.status = 'archived') then
      raise exception 'group % is archived', v_lesson.group_id using errcode = 'check_violation';
    end if;
    if new.student_id is not null and exists (
      select 1 from public.enrollments e
      where e.student_id = new.student_id and e.group_id = v_lesson.group_id and e.status = 'active'
    ) then
      raise exception 'student is already enrolled in this group' using errcode = 'unique_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'scheduled' and new.status in ('attended', 'no_show', 'closed'))
      or (old.status = 'attended' and new.status in ('no_show', 'enrolled', 'closed'))
      or (old.status = 'no_show' and new.status in ('attended', 'scheduled', 'closed'))
    ) then
      raise exception 'trial cannot go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'scheduled' and new.lesson_id = old.lesson_id then
      raise exception 'book the trial on another lesson' using errcode = 'check_violation';
    end if;
    if new.status in ('attended', 'no_show') then
      if v_lesson.status = 'cancelled' then
        raise exception 'the lesson was cancelled' using errcode = 'check_violation';
      end if;
      if v_lesson.lesson_date > public.bishkek_today() then
        raise exception 'the trial lesson is not today yet' using errcode = 'check_violation';
      end if;
      new.came := new.status = 'attended';
      new.marked_at := now();
      new.marked_by := auth.uid();
    elsif new.status = 'scheduled' then
      new.came := null;
      new.marked_at := null;
      new.marked_by := null;
    else
      -- enrolled / closed keep the teacher's mark for the funnel
      new.came := old.came;
      new.marked_at := old.marked_at;
      new.marked_by := old.marked_by;
    end if;
  elsif tg_op = 'UPDATE' then
    new.came := old.came;
    new.marked_at := old.marked_at;
    new.marked_by := old.marked_by;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    -- Teacher (RLS: own groups): «Был / Не пришёл» only — Ж3.
    if (to_jsonb(new) - v_teacher_cols) <> (to_jsonb(old) - v_teacher_cols) then
      raise exception 'teacher may only mark a trial' using errcode = 'insufficient_privilege';
    end if;
    if new.status not in ('attended', 'no_show') then
      raise exception 'teacher may only mark a trial as attended or no_show' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.trials_guard() from public, anon, authenticated;

-- «Изменить» a trial (А11), any status, with a reason: the lead's name, class, parent phone, source,
-- note and — while scheduled / attended / no_show — the lesson (trials_guard). Admin. Null grade /
-- phone / source / note — cleared; null lesson — keep.
create or replace function public.update_trial(
  p_trial_id uuid,
  p_full_name text,
  p_grade integer,
  p_parent_phone text,
  p_source public.trial_source,
  p_note text,
  p_lesson_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_trial public.trials%rowtype;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may edit a trial' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);
  select * into v_trial from public.trials t where t.id = p_trial_id for update;
  if not found then
    raise exception 'trial % not found', p_trial_id using errcode = 'no_data_found';
  end if;
  if length(v_name) = 0 or length(v_name) > 200 then
    raise exception 'name must be 1…200 characters' using errcode = 'check_violation';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'note is too long' using errcode = 'check_violation';
  end if;

  if v_name = v_trial.full_name and p_grade is not distinct from v_trial.grade
     and p_parent_phone is not distinct from v_trial.parent_phone
     and p_source is not distinct from v_trial.source and v_note is not distinct from v_trial.note
     and coalesce(p_lesson_id, v_trial.lesson_id) = v_trial.lesson_id then
    return;
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  update public.trials
  set full_name = v_name, grade = p_grade, parent_phone = p_parent_phone, source = p_source,
      note = v_note, lesson_id = coalesce(p_lesson_id, lesson_id)
  where id = p_trial_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

-- «Вернуть в воронку» a closed trial (А11), with a reason: came → attended («Оплатил → зачислить»),
-- did not come → no_show («Позвонить»), never marked → scheduled if its lesson is still ahead, else
-- no_show. Admin. Returns the new status.
create or replace function public.reopen_trial(p_trial_id uuid, p_reason text)
returns public.trial_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_trial public.trials%rowtype;
  v_status public.trial_status;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may reopen a trial' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);
  select * into v_trial from public.trials t where t.id = p_trial_id for update;
  if not found then
    raise exception 'trial % not found', p_trial_id using errcode = 'no_data_found';
  end if;
  if v_trial.status <> 'closed' then
    raise exception 'trial % is not closed', p_trial_id using errcode = 'check_violation';
  end if;

  v_status := case
    when v_trial.came then 'attended'
    when v_trial.came is null and exists (
      select 1 from public.lessons l
      where l.id = v_trial.lesson_id and l.status = 'planned' and l.lesson_date >= public.bishkek_today()
    ) then 'scheduled'
    else 'no_show'
  end;

  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  update public.trials set status = v_status where id = p_trial_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_status;
end;
$$;

revoke execute on function
  public.update_trial(uuid, text, integer, text, public.trial_source, text, uuid, text) from public, anon;
grant execute on function
  public.update_trial(uuid, text, integer, text, public.trial_source, text, uuid, text) to authenticated;
revoke execute on function public.reopen_trial(uuid, text) from public, anon;
grant execute on function public.reopen_trial(uuid, text) to authenticated;

-- ─── 9. attendance_correction_requests: delete ──────────────────────────────

-- The delete of a request goes to the journal too (0021 audited insert / update only).
drop trigger if exists audit_log on public.attendance_correction_requests;
create trigger audit_log after insert or update or delete on public.attendance_correction_requests
for each row execute function public.write_audit_log();

-- «Удалить запрос» (карточка занятия): a mistaken request, any status, with a reason. Marks do not
-- change. Admin. There is still no delete policy — a direct delete removes nothing.
create or replace function public.delete_correction_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may delete a correction request' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.assert_edit_reason(p_reason);
  perform set_config('iqup.audit_reason', v_reason, true);
  delete from public.attendance_correction_requests r where r.id = p_request_id;
  if not found then
    perform set_config('iqup.audit_reason', '', true);
    raise exception 'correction request % not found', p_request_id using errcode = 'no_data_found';
  end if;
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.delete_correction_request(uuid, text) from public, anon;
grant execute on function public.delete_correction_request(uuid, text) to authenticated;

-- ─── 10. groups: delete with everything ─────────────────────────────────────

-- A signed-in user deletes a group only inside delete_group (iqup.admin_edit) — RLS lets the admin
-- delete rows, the reason and the cascade live in the RPC. The service role is not restricted.
create or replace function public.groups_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('iqup.admin_edit', true), '') <> 'on' then
    raise exception 'a group is deleted only by delete_group' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

revoke execute on function public.groups_guard() from public, anon, authenticated;

drop trigger if exists groups_guard on public.groups;
create trigger groups_guard
before delete on public.groups
for each row execute function public.groups_guard();

-- delete_group(uuid) of 0020 (an empty group, no reason): the same, under iqup.admin_edit.
create or replace function public.delete_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reasons text[];
  v_lessons integer;
begin
  perform public.assert_admin();

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  v_reasons := public.group_delete_blockers(p_group_id);
  if cardinality(v_reasons) > 0 then
    raise exception 'group cannot be deleted: %', array_to_string(v_reasons, ', ')
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'delete_group', true);
  with gone as (
    delete from public.lessons l where l.group_id = p_group_id returning 1
  )
  select count(*) into v_lessons from gone;
  delete from public.schedule_rules r where r.group_id = p_group_id;
  perform set_config('iqup.admin_edit', 'on', true);
  delete from public.groups g where g.id = p_group_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);

  return v_lessons;
end;
$$;

-- «Удалить группу» before confirming: what goes with it and what stops it. blockers: 'payments' (the
-- students' money never goes silently — transfer them, И57, or archive), 'locked' (a closed period).
-- payments_som — Σ of the payment rows (payments and refunds). Admin.
create or replace function public.group_delete_preview(p_group_id uuid)
returns table (
  lessons integer,
  held_lessons integer,
  marks integer,
  consumed_marks integer,
  enrollments integer,
  trials integer,
  payments integer,
  payments_som integer,
  locked_lessons integer,
  blockers text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payments integer;
  v_locked integer;
begin
  perform public.assert_admin();
  if not exists (select 1 from public.groups g where g.id = p_group_id) then
    raise exception 'group % not found', p_group_id using errcode = 'no_data_found';
  end if;
  select count(p.id)::integer into v_payments
  from public.payments p
  join public.subscriptions s on s.id = p.subscription_id
  join public.enrollments e on e.id = s.enrollment_id
  where e.group_id = p_group_id;
  select count(*)::integer into v_locked from public.lessons l where l.group_id = p_group_id and l.is_locked;

  return query
  select
    (select count(*)::integer from public.lessons l where l.group_id = p_group_id),
    (select count(*)::integer from public.lessons l where l.group_id = p_group_id and l.status = 'held'),
    (select count(*)::integer from public.attendance a join public.lessons l on l.id = a.lesson_id
     where l.group_id = p_group_id),
    (select count(*)::integer from public.attendance a join public.lessons l on l.id = a.lesson_id
     where l.group_id = p_group_id and a.consumes_credit and l.status = 'held'),
    (select count(*)::integer from public.enrollments e where e.group_id = p_group_id),
    (select count(*)::integer from public.trials t where t.group_id = p_group_id),
    v_payments,
    (select coalesce(sum(p.amount), 0)::integer
     from public.payments p
     join public.subscriptions s on s.id = p.subscription_id
     join public.enrollments e on e.id = s.enrollment_id
     where e.group_id = p_group_id),
    v_locked,
    array_remove(array[
      case when v_payments > 0 then 'payments' end,
      case when v_locked > 0 then 'locked' end
    ], null);
end;
$$;

-- What the teachers lose with the group's marks (per teacher and month, marks_payroll_drop). Admin.
create or replace function public.group_payroll_impact(p_group_id uuid)
returns table (teacher_id uuid, teacher_name text, month date, marks integer, amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
  select * from public.marks_payroll_drop(array(
    select a.id from public.attendance a join public.lessons l on l.id = a.lesson_id
    where l.group_id = p_group_id
  ));
end;
$$;

-- «Удалить группу» (И84, И51 revised): any group without money and outside a closed period — with its
-- lessons (held ones too), marks (the teacher's payroll drops by group_payroll_impact), presets,
-- correction requests, trials, enrollments with subscriptions and after-school plans, schedule; a
-- reason (journal: every row with it). Admin. Returns the lessons deleted. The old delete_group(uuid)
-- (an empty group, 0020) stays.
create or replace function public.delete_group(p_group_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_blockers text[];
  v_lessons integer;
begin
  perform public.assert_admin();
  v_reason := public.assert_edit_reason(p_reason);

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'no_data_found';
  end if;
  select x.blockers into v_blockers from public.group_delete_preview(p_group_id) x;
  if cardinality(v_blockers) > 0 then
    raise exception 'group cannot be deleted: %', array_to_string(v_blockers, ', ')
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  delete from public.attendance a
  using public.lessons l
  where l.id = a.lesson_id and l.group_id = p_group_id;
  delete from public.trials t where t.group_id = p_group_id;
  delete from public.subscriptions s
  using public.enrollments e
  where e.id = s.enrollment_id and e.group_id = p_group_id;
  delete from public.enrollments e where e.group_id = p_group_id;
  with gone as (
    delete from public.lessons l where l.group_id = p_group_id returning 1
  )
  select count(*)::integer into v_lessons from gone;
  delete from public.schedule_rules r where r.group_id = p_group_id;
  perform set_config('iqup.admin_edit', 'on', true);
  delete from public.groups g where g.id = p_group_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
  return v_lessons;
end;
$$;

revoke execute on function public.group_delete_preview(uuid) from public, anon;
grant execute on function public.group_delete_preview(uuid) to authenticated;
revoke execute on function public.group_payroll_impact(uuid) from public, anon;
grant execute on function public.group_payroll_impact(uuid) to authenticated;
revoke execute on function public.delete_group(uuid, text) from public, anon;
grant execute on function public.delete_group(uuid, text) to authenticated;

-- ─── 11. students: delete ───────────────────────────────────────────────────

-- The delete of a student goes to the journal (the full name stays in the snapshot).
drop trigger if exists audit_log_delete on public.students;
create trigger audit_log_delete after delete on public.students
for each row execute function public.write_audit_log();

-- A signed-in user deletes a student only inside delete_student (iqup.admin_edit). The service role
-- is not restricted.
create or replace function public.students_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('iqup.admin_edit', true), '') <> 'on' then
    raise exception 'a student is deleted only by delete_student' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

revoke execute on function public.students_guard() from public, anon, authenticated;

drop trigger if exists students_guard on public.students;
create trigger students_guard
before delete on public.students
for each row execute function public.students_guard();

-- «Удалить ученика» (А6) before confirming. blockers: 'active_enrollment' — an active enrollment with
-- payments or consumed marks («Ушёл» / «Записан по ошибке» first, И57); 'locked' — marks in a closed
-- period. paid_som / refunded_som — Σ payments / refunds of the student (they go with the student).
-- Admin.
create or replace function public.student_delete_preview(p_student_id uuid)
returns table (
  enrollments integer,
  active_enrollments integer,
  marks integer,
  consumed_marks integer,
  payments integer,
  paid_som integer,
  refunded_som integer,
  trials integer,
  locked_marks integer,
  blockers text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_blocking integer;
  v_locked integer;
begin
  perform public.assert_admin();
  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'student % not found', p_student_id using errcode = 'no_data_found';
  end if;
  select count(*)::integer into v_blocking
  from public.enrollments e
  where e.student_id = p_student_id and e.status = 'active' and (
    exists (
      select 1 from public.payments p join public.subscriptions s on s.id = p.subscription_id
      where s.enrollment_id = e.id
    )
    or exists (
      select 1 from public.attendance a
      join public.subscriptions s on s.id = a.subscription_id
      where s.enrollment_id = e.id and a.consumes_credit
    )
    or exists (
      select 1 from public.attendance a join public.lessons l on l.id = a.lesson_id
      where a.student_id = p_student_id and l.group_id = e.group_id and a.consumes_credit
        and a.subscription_id is null
    )
  );
  select count(*)::integer into v_locked
  from public.attendance a join public.lessons l on l.id = a.lesson_id
  where a.student_id = p_student_id and l.is_locked;

  return query
  select
    (select count(*)::integer from public.enrollments e where e.student_id = p_student_id),
    (select count(*)::integer from public.enrollments e where e.student_id = p_student_id and e.status = 'active'),
    (select count(*)::integer from public.attendance a where a.student_id = p_student_id),
    (select count(*)::integer from public.attendance a join public.lessons l on l.id = a.lesson_id
     where a.student_id = p_student_id and a.consumes_credit and l.status = 'held'),
    (select count(*)::integer from public.payments p
     join public.subscriptions s on s.id = p.subscription_id
     join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = p_student_id and p.kind = 'payment'),
    (select coalesce(sum(p.amount), 0)::integer from public.payments p
     join public.subscriptions s on s.id = p.subscription_id
     join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = p_student_id and p.kind = 'payment'),
    (select coalesce(-sum(p.amount), 0)::integer from public.payments p
     join public.subscriptions s on s.id = p.subscription_id
     join public.enrollments e on e.id = s.enrollment_id
     where e.student_id = p_student_id and p.kind = 'refund'),
    (select count(*)::integer from public.trials t
     where t.student_id = p_student_id
        or t.enrollment_id in (select e.id from public.enrollments e where e.student_id = p_student_id)),
    v_locked,
    array_remove(array[
      case when v_blocking > 0 then 'active_enrollment' end,
      case when v_locked > 0 then 'locked' end
    ], null);
end;
$$;

-- What the teachers lose with the student's marks (per teacher and month). Admin.
create or replace function public.student_payroll_impact(p_student_id uuid)
returns table (teacher_id uuid, teacher_name text, month date, marks integer, amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
  select * from public.marks_payroll_drop(array(
    select a.id from public.attendance a where a.student_id = p_student_id
  ));
end;
$$;

-- «Удалить ученика» (И85): refused by student_delete_preview blockers; otherwise the student with
-- every mark (payroll drops by student_payroll_impact), preset, trial, payment (the money was settled
-- by «Ушёл» / a refund — И57), subscription, after-school plan and enrollment; «Кто привёл» of others
-- is cleared. A reason (journal: every row with it). Admin.
create or replace function public.delete_student(p_student_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_blockers text[];
begin
  perform public.assert_admin();
  v_reason := public.assert_edit_reason(p_reason);

  perform 1 from public.students s where s.id = p_student_id for update;
  if not found then
    raise exception 'student % not found', p_student_id using errcode = 'no_data_found';
  end if;
  select x.blockers into v_blockers from public.student_delete_preview(p_student_id) x;
  if cardinality(v_blockers) > 0 then
    raise exception 'student cannot be deleted: %', array_to_string(v_blockers, ', ')
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', v_reason, true);
  delete from public.attendance a where a.student_id = p_student_id;
  delete from public.trials t
  where t.student_id = p_student_id
     or t.enrollment_id in (select e.id from public.enrollments e where e.student_id = p_student_id);
  perform set_config('iqup.payment_edit', 'on', true);
  delete from public.payments p
  using public.subscriptions s, public.enrollments e
  where s.id = p.subscription_id and e.id = s.enrollment_id and e.student_id = p_student_id;
  perform set_config('iqup.payment_edit', '', true);
  delete from public.subscriptions s
  using public.enrollments e
  where e.id = s.enrollment_id and e.student_id = p_student_id;
  delete from public.enrollments e where e.student_id = p_student_id;
  update public.students s set referred_by_student_id = null where s.referred_by_student_id = p_student_id;
  update public.trials t set referred_by_student_id = null where t.referred_by_student_id = p_student_id;
  perform set_config('iqup.admin_edit', 'on', true);
  delete from public.students s where s.id = p_student_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.student_delete_preview(uuid) from public, anon;
grant execute on function public.student_delete_preview(uuid) to authenticated;
revoke execute on function public.student_payroll_impact(uuid) from public, anon;
grant execute on function public.student_payroll_impact(uuid) to authenticated;
revoke execute on function public.delete_student(uuid, text) from public, anon;
grant execute on function public.delete_student(uuid, text) to authenticated;

-- ─── 12. subjects: delete ───────────────────────────────────────────────────

-- A signed-in user deletes a subject only inside delete_subject (iqup.admin_edit); adding, renaming
-- and hiding stay direct (RLS, 0013). The service role is not restricted.
create or replace function public.subjects_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('iqup.admin_edit', true), '') <> 'on' then
    raise exception 'a subject is deleted only by delete_subject' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

revoke execute on function public.subjects_guard() from public, anon, authenticated;

drop trigger if exists subjects_guard on public.subjects;
create trigger subjects_guard
before delete on public.subjects
for each row execute function public.subjects_guard();

-- «Удалить» a subject (А9 «Предметы», И86): only one no group uses (otherwise «Скрыть» — is_active).
-- A reason. Admin.
create or replace function public.delete_subject(p_subject_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  perform public.assert_admin();
  v_reason := public.assert_edit_reason(p_reason);
  if not exists (select 1 from public.subjects s where s.id = p_subject_id) then
    raise exception 'subject % not found', p_subject_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.groups g where g.subject_id = p_subject_id) then
    raise exception 'subject % has groups — hide it instead', p_subject_id using errcode = 'foreign_key_violation';
  end if;
  perform set_config('iqup.audit_reason', v_reason, true);
  perform set_config('iqup.admin_edit', 'on', true);
  delete from public.subjects s where s.id = p_subject_id;
  perform set_config('iqup.admin_edit', '', true);
  perform set_config('iqup.audit_reason', '', true);
end;
$$;

revoke execute on function public.delete_subject(uuid, text) from public, anon;
grant execute on function public.delete_subject(uuid, text) to authenticated;

-- ─── 13. journal ────────────────────────────────────────────────────────────

-- Same as 0022 plus (#94): a held lesson whose date / time / duration / teacher changed (update_lesson,
-- change_group_teacher) and a past holiday added / renamed / removed — «Правки задним числом»; a
-- payroll period closed / reopened — «Оплаты» (with the advances).
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
      then 'retro'
    when p_entity in ('subscriptions', 'payments', 'payroll_adjustments', 'payroll_periods')
      then 'payment'
    when p_entity = 'lessons' and p_action = 'update'
         and p_before ->> 'status' = 'planned' and p_after ->> 'status' = 'held'
      then 'attendance'
    else 'other'
  end
$$;

-- Recompute the stored kind of the rows the new rule may file differently (held lesson updates).
update public.audit_log set entity = entity
where entity = 'lessons' and action = 'update' and before ->> 'status' = 'held' and after ->> 'status' = 'held';

-- Same as 0026 plus students (a deleted student — by the snapshot's name).
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
    when 'students' then
      v_lead := p_row ->> 'full_name';
    when 'holidays' then
      v_lead := p_row ->> 'name';
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
