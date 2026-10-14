-- #81 · Перевод ученика в группу другого типа с переносом остатка денег, «Ушёл» с возвратом,
-- «Записан по ошибке» с пересчётом ЗП.
-- 1. payments.kind 'transfer': a transfer is a pair of immutable rows (И41) with the same transfer_id —
--    «перенос в <группа>» (−) on the old subscription and «перенос из <группа>» (+) on the new one, so
--    both groups' payment history and v_student_balance (Σ amount) see it. No method (no cash moved).
-- 2. Money of an enrollment (subscription_settlement / enrollment_settlement): lesson price = paid price
--    of the subscription (price_final / lessons_total); used = lessons charged to it (v_student_balance,
--    carry of «в долг» included, И37); remainder = Σ payments − ceil(used × price) — negative is a debt
--    (ceil as debt_som, И37). enrollment_payroll_impact: what the teacher was paid for its marks.
-- 3. RPCs (admin only, journal via the audit triggers with a reason, closed periods refused):
--    transfer_preview / transfer_student — the old enrollment ends the day before the first day in the
--    new group, the new group gets a new enrollment + subscription at its tariff, the remainder moves
--    (debt too); a surplus over the new price stays (more lessons) or is refunded. Same type with
--    nothing written off — the #73 move (transfer_enrollment), unchanged.
--    withdraw_enrollment — «Ушёл»: finished from a date; the remainder is refunded, and whatever is not
--    refunded is left to the center explicitly, with a reason in the journal (nothing is lost silently).
--    The old subscriptions of a transfer / «ушёл» become exhausted (closed on their used lessons; they
--    stay in the И37 chain, so a carried debt does not reappear, but never take a new mark first).
--    delete_enrollment — «Записан по ошибке»: every mark is deleted (payroll drops by them); payments
--    stay (immutable) — the money is transferred to the right group or refunded, and an enrollment that
--    has payments stays as a void record (finished, end_date null = never on a roster) whose
--    subscriptions are refunded — out of attendance_subscription and the balance chain.
-- 4. A void record holds no dates: enrollment_attendance takes no lessons by its dates, and the overlap
--    checks (set_enrollment_start 0017, transfer_enrollment 0020, the ones below) skip it — the student
--    can be enrolled in that group again.
-- 5. v_student_balance: paid_lessons floors a negative paid_som too — a debt carried to a new
--    subscription is a debt before the first lesson (same in balance.ts).
-- Safe on production data: the new enum value and column, method nullable and a wider check accept
-- every existing row; the replaced view / functions keep their signatures and change nothing for rows
-- that exist before this migration (no void records, paid_som ≥ 0); re-running the file is a no-op.

-- ─── 1. payments: transfer ──────────────────────────────────────────────────

alter type public.payment_kind add value if not exists 'transfer';

alter table public.payments add column if not exists transfer_id uuid;
comment on column public.payments.transfer_id is
  'Both rows of a transfer between subscriptions (kind = transfer) share it (#81).';
alter table public.payments alter column method drop not null;

-- kind::text — the new enum value cannot be used in the transaction that adds it.
alter table public.payments drop constraint if exists payments_check;
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (
  (kind::text = 'payment' and amount > 0 and method is not null and transfer_id is null)
  or (kind::text = 'refund' and amount < 0 and method is not null and transfer_id is null
      and length(btrim(coalesce(reason, ''))) > 0)
  or (kind::text = 'transfer' and amount <> 0 and method is null and transfer_id is not null
      and length(btrim(coalesce(reason, ''))) > 0)
);
create index if not exists payments_transfer_idx on public.payments (transfer_id) where transfer_id is not null;

-- ─── 1b. balance with a carried debt, void records ──────────────────────────

-- Same as 0016 except: paid_lessons = floor(paid × lessons_total / price_final) for a negative paid_som
-- too (a debt carried by a transfer) — debt_lessons / debt_som show it before the first lesson; an
-- exhausted subscription (closed by a transfer / «ушёл») suggests no refund — its rest was moved,
-- refunded or left to the center.
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
      -- floor, not truncation: a debt carried in by a transfer (paid_som < 0) is lessons owed
      else floor(paid_som::numeric * lessons_total / price_final)::integer
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
    when status in ('refunded', 'exhausted') then 0 -- exhausted: closed by a transfer / «ушёл» (#81)
    else round(
      greatest(0, least(paid_lessons, lessons_total) - lessons_used)::numeric * price_final / lessons_total
    )::integer
  end as refund_suggested,
  freezes_used,
  freeze_limit,
  is_current
from balance;

comment on view public.v_student_balance is
  'Per subscription: paid / used / debt / refund (В7, В7.1, В8, И37, #81) — same as src/features/payments/balance.ts.';

-- Marks of an enrollment: charged to its subscriptions, or in its group within its dates. A void record
-- (finished, end_date null — «записан по ошибке» with payments) has no dates: only marks charged to it.
create or replace function public.enrollment_attendance(p_enrollment_id uuid)
returns setof public.attendance
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.enrollments e
  join public.lessons l on l.group_id = e.group_id
  join public.attendance a on a.lesson_id = l.id and a.student_id = e.student_id
  where e.id = p_enrollment_id
    and (
      a.subscription_id in (select s.id from public.subscriptions s where s.enrollment_id = e.id)
      or (
        l.lesson_date >= e.start_date
        and (l.lesson_date <= e.end_date or (e.end_date is null and e.status = 'active'))
      )
    );
$$;

-- 0017 / 0020 with the overlap checks skipping a void record (else it blocks the group forever).
create or replace function public.set_enrollment_start(p_enrollment_id uuid, p_start_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_group public.groups%rowtype;
begin
  perform public.assert_admin();

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  if p_start_date is null then
    raise exception 'start date is required' using errcode = 'check_violation';
  end if;
  if p_start_date = v_enrollment.start_date then
    return;
  end if;

  select * into v_group from public.groups g where g.id = v_enrollment.group_id;
  if p_start_date < v_group.start_date
     or (v_group.end_date is not null and p_start_date > v_group.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;
  if v_enrollment.end_date is not null and p_start_date > v_enrollment.end_date then
    raise exception 'start date is after the enrollment end' using errcode = 'check_violation';
  end if;

  -- the same student in the same group: periods must not overlap (and unique start date)
  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_enrollment.student_id
      and e.group_id = v_enrollment.group_id
      and e.id <> v_enrollment.id
      and e.start_date <= coalesce(v_enrollment.end_date, 'infinity'::date)
      and coalesce(e.end_date, 'infinity'::date) >= p_start_date
      and not (e.status = 'finished' and e.end_date is null) -- a void record (0024) holds no dates
  ) then
    raise exception 'another enrollment of the student in this group overlaps these dates'
      using errcode = 'unique_violation';
  end if;

  -- marks of this enrollment: charged to its subscriptions, or in the group since it started
  if exists (
    select 1 from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    where a.student_id = v_enrollment.student_id
      and l.group_id = v_enrollment.group_id
      and l.lesson_date < p_start_date
      and (
        l.lesson_date >= v_enrollment.start_date
        or a.subscription_id in (
          select s.id from public.subscriptions s where s.enrollment_id = v_enrollment.id
        )
      )
  ) then
    raise exception 'the enrollment has attendance before the new date' using errcode = 'check_violation';
  end if;

  update public.enrollments set start_date = p_start_date where id = p_enrollment_id;
  update public.subscriptions s
  set started_at = p_start_date
  where s.enrollment_id = p_enrollment_id and s.started_at = v_enrollment.start_date;
end;
$$;

create or replace function public.transfer_enrollment(
  p_enrollment_id uuid,
  p_group_id uuid,
  p_start_date date default null
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_from public.groups%rowtype;
  v_to public.groups%rowtype;
  v_start date;
begin
  perform public.assert_admin();

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  select * into v_to from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_to.id = v_enrollment.group_id then
    raise exception 'the enrollment is already in this group' using errcode = 'check_violation';
  end if;
  if v_to.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  select * into v_from from public.groups g where g.id = v_enrollment.group_id;
  if v_to.group_type <> v_from.group_type then
    raise exception 'the target group has another type — refund first' using errcode = 'check_violation';
  end if;

  perform public.assert_enrollment_undoable(p_enrollment_id);

  v_start := coalesce(p_start_date, greatest(v_enrollment.start_date, v_to.start_date));
  if v_start < v_to.start_date or (v_to.end_date is not null and v_start > v_to.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;
  if v_enrollment.end_date is not null and v_start > v_enrollment.end_date then
    raise exception 'start date is after the enrollment end' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_enrollment.student_id
      and e.group_id = p_group_id
      and e.start_date <= coalesce(v_enrollment.end_date, 'infinity'::date)
      and coalesce(e.end_date, 'infinity'::date) >= v_start
      and not (e.status = 'finished' and e.end_date is null) -- a void record (0024) holds no dates
  ) then
    raise exception 'the student is already enrolled in the target group on these dates'
      using errcode = 'unique_violation';
  end if;

  perform set_config('iqup.audit_reason', 'transfer_enrollment', true);

  delete from public.attendance a
  where a.id in (select m.id from public.enrollment_attendance(p_enrollment_id) m)
    and a.status = 'absent_frozen'; -- a «был» committed meanwhile (confirm_lesson) is never deleted

  update public.enrollments set group_id = p_group_id, start_date = v_start where id = p_enrollment_id;
  update public.subscriptions s
  set started_at = v_start
  where s.enrollment_id = p_enrollment_id and s.started_at = v_enrollment.start_date;

  perform set_config('iqup.audit_reason', '', true);
  return v_start;
end;
$$;

-- ─── 2. money of an enrollment ──────────────────────────────────────────────

-- «Математика · 8 класс А» — the group as the payment rows name it.
create or replace function public.group_title(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select concat_ws(' · ', sj.name, g.name)
  from public.groups g
  left join public.subjects sj on sj.id = g.subject_id
  where g.id = p_group_id;
$$;

-- Per live (not refunded) subscription of the enrollment: paid, used, used at its paid price, remainder.
create or replace function public.subscription_settlement(p_enrollment_id uuid)
returns table (
  subscription_id uuid,
  started_at date,
  created_at timestamptz,
  paid_som integer,
  lessons_used integer,
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

-- The dialogs on А6 / А4: marks, money and the remainder of an enrollment.
create or replace function public.enrollment_settlement(p_enrollment_id uuid)
returns table (
  present_marks integer,
  burned_marks integer,
  frozen_marks integer,
  locked_marks integer,
  last_mark_date date,
  payments integer,
  money_som integer,
  paid_som integer,
  lessons_used integer,
  used_som integer,
  remainder integer,
  lesson_price numeric,
  has_trial boolean
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
      coalesce(sum(x.lessons_used), 0)::integer as lessons_used,
      coalesce(sum(x.used_som), 0)::integer as used_som,
      coalesce(sum(x.remainder), 0)::integer as remainder
    from public.subscription_settlement(p_enrollment_id) x
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
    (select s.price_final::numeric / s.lessons_total
     from public.subscriptions s
     where s.enrollment_id = p_enrollment_id and s.status <> 'refunded'
     order by s.started_at desc, s.created_at desc, s.id desc
     limit 1),
    exists (select 1 from public.trials t where t.enrollment_id = p_enrollment_id)
  from money, settled;
end;
$$;

-- What the teachers were paid for the written-off marks of the enrollment (same rule as
-- v_payroll_preview: price_full / lessons_total × percent on the lesson date, lessons.teacher_id).
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
    round(coalesce(sum(s.price_full * r.percent / (s.lessons_total * 100.0)), 0))::integer
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

-- ─── 3a. transfer ───────────────────────────────────────────────────────────

-- First day in the new group by default: its next planned lesson from today (not before its start).
create or replace function public.transfer_default_start(p_enrollment_id uuid, p_group_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_to public.groups%rowtype;
  v_from_type public.group_type;
  v_from date;
begin
  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id;
  select * into v_to from public.groups g where g.id = p_group_id;
  select g.group_type into v_from_type from public.groups g where g.id = v_enrollment.group_id;
  if v_to.group_type = v_from_type and not exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a where a.consumes_credit
  ) then
    -- the #73 move: the enrollment keeps its start (not before the group's)
    return greatest(v_enrollment.start_date, v_to.start_date);
  end if;
  v_from := greatest(public.bishkek_today(), v_to.start_date, v_enrollment.start_date + 1);
  return coalesce(
    (select min(l.lesson_date) from public.lessons l
     where l.group_id = p_group_id and l.status = 'planned' and l.lesson_date >= v_from),
    v_from
  );
end;
$$;

-- «Перевести в другую группу» — the money preview of the dialog.
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

-- «Перевести в другую группу» (А6 / А4). p_start_date — the first day in the new group (default:
-- transfer_default_start). Same type and no «был» / «сгорело» — the #73 move (transfer_enrollment).
-- Otherwise: «заморожен» marks from that day are deleted, the enrollment ends the day before, a new
-- enrollment + subscription at the new group's tariff (no discount) start on it, and the remainder of
-- the old subscriptions moves to the new one as a transfer pair. A surplus over the new price stays on
-- it (more lessons), or with p_refund_surplus is refunded (p_method). The old teacher keeps the payroll
-- of the used lessons (attendance → old subscription), the new one is paid by the new subscription.
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

-- ─── 3b. «Ушёл из группы» ───────────────────────────────────────────────────

-- p_end_date — the last day in the group (lessons after it leave the roster; its «был» / «сгорело» stay
-- with the teacher's payroll). «Заморожен» marks after it are deleted; written-off marks after it
-- refuse. p_refund (0 … the remainder) is refunded from the newest subscription.
-- What is not refunded (the remainder − p_refund) is never dropped silently: it is left to the center
-- only with p_center_reason (the journal of the subscriptions says «остаток N сом оставлен центру:
-- <reason>»), else the call refuses. First the subscriptions are evened out by a transfer pair onto the
-- newest one (each other subscription to remainder 0), so the refund / the rest left to the center / the
-- net debt sits on that one only — no old debt beside a surplus refunded elsewhere. The subscriptions
-- become exhausted — closed on their used lessons; a net debt (remainder < 0) stays on the newest one
-- and in the debtors list.
create or replace function public.withdraw_enrollment(
  p_enrollment_id uuid,
  p_end_date date,
  p_refund integer default 0,
  p_method public.payment_method default null,
  p_reason text default null,
  p_paid_on date default null,
  p_center_reason text default null
)
returns table (remainder integer, refunded integer, left_to_center integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_remainder integer;
  v_refund integer := coalesce(p_refund, 0);
  v_rest integer;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ученик ушёл из группы');
  v_center_reason text := nullif(btrim(coalesce(p_center_reason, '')), '');
  v_target uuid;
  v_moved integer := 0;
  v_transfer uuid := gen_random_uuid();
  r record;
begin
  perform public.assert_admin();

  select * into v_enrollment from public.enrollments e where e.id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'foreign_key_violation';
  end if;
  -- the subscriptions too, as record_payment does: no payment / refund lands between the settlement
  -- read below and the rows written from it
  perform 1 from public.subscriptions s where s.enrollment_id = p_enrollment_id for update;
  if v_enrollment.status <> 'active' then
    raise exception 'enrollment is finished' using errcode = 'check_violation';
  end if;
  if p_end_date is null or p_end_date < v_enrollment.start_date then
    raise exception 'end date is before the enrollment start' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
    where a.consumes_credit and l.lesson_date > p_end_date
  ) then
    raise exception 'the enrollment has present or burned marks after %', p_end_date
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
    where l.is_locked and l.lesson_date > p_end_date
  ) then
    raise exception 'the enrollment has marks in a closed period' using errcode = 'check_violation';
  end if;

  select coalesce(sum(x.remainder), 0)::integer into v_remainder
  from public.subscription_settlement(p_enrollment_id) x;
  if v_refund < 0 or v_refund > greatest(v_remainder, 0) then
    raise exception 'refund must be between 0 and the remainder' using errcode = 'check_violation';
  end if;
  if v_refund > 0 and p_method is null then
    raise exception 'payment method is required for a refund' using errcode = 'check_violation';
  end if;
  v_rest := greatest(v_remainder, 0) - v_refund;
  if v_rest > 0 and v_center_reason is null then
    raise exception 'the rest of the remainder must be refunded or left to the center with a reason'
      using errcode = 'check_violation';
  end if;

  perform set_config('iqup.audit_reason', 'withdraw_enrollment', true);

  delete from public.attendance a
  where a.id in (
    select m.id from public.enrollment_attendance(p_enrollment_id) m
    join public.lessons l on l.id = m.lesson_id
    where l.lesson_date > p_end_date
  )
    and a.status = 'absent_frozen';

  update public.enrollments set end_date = p_end_date, status = 'finished' where id = p_enrollment_id;

  -- even the subscriptions out onto the newest one: every other one to remainder 0 (a transfer pair, as
  -- transfer_student), so a debt on an old one and a surplus on a new one cancel instead of the refund /
  -- the rest left to the center taking the surplus and the old debt staying in the debtors list
  for r in
    select * from public.subscription_settlement(p_enrollment_id) x
    order by x.started_at desc, x.created_at desc, x.subscription_id desc
  loop
    if v_target is null then
      v_target := r.subscription_id;
    elsif r.remainder <> 0 then
      insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id)
      values (r.subscription_id, -r.remainder, null, 'transfer', 'перенос между абонементами: ' || v_reason,
              v_transfer);
      v_moved := v_moved + r.remainder;
    end if;
  end loop;
  if v_moved <> 0 then
    insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id)
    values (v_target, v_moved, null, 'transfer', 'перенос между абонементами: ' || v_reason, v_transfer);
  end if;

  if v_refund > 0 then
    insert into public.payments (subscription_id, amount, method, paid_at, kind, reason)
    values (v_target, -v_refund, p_method, public.payment_time(p_paid_on), 'refund', v_reason);
  end if;

  if v_rest > 0 then
    perform set_config('iqup.audit_reason',
      'остаток ' || v_rest || ' сом оставлен центру: ' || v_center_reason, true);
  end if;
  update public.subscriptions s set status = 'exhausted'
  where s.enrollment_id = p_enrollment_id and s.status = 'active';

  perform set_config('iqup.audit_reason', '', true);
  return query select v_remainder, v_refund, v_rest;
end;
$$;

-- ─── 3c. «Записан по ошибке — удалить» ──────────────────────────────────────

-- Every mark of the enrollment is deleted, «был» and «сгорело» too — the teachers' payroll drops by
-- them (journal: retro rows with the reason delete_enrollment). A closed period refuses.
-- Without payments: the enrollment and its subscriptions are deleted (as remove_enrollment).
-- With money on it (Σ payments ≠ 0) p_money is required:
--   'transfer' — to the right group p_group_id: same type and the student not in it — the #73 move
--     (the enrollment with subscriptions and payments goes there whole, p_start_date as there);
--     otherwise to the student's current subscription there, or a new enrollment + subscription
--     from p_start_date (default: the later of the two starts) — a transfer pair;
--   'refund' — each subscription's money refunded (p_method), the subscription → refunded.
-- Payments are immutable (И41), so an enrollment that has them is kept as a void record: finished
-- with end_date null (on no roster), its subscriptions without payments deleted.
-- An enrollment made from a trial returns the trial to «был на пробном».
create or replace function public.delete_enrollment(
  p_enrollment_id uuid,
  p_money text default null,
  p_group_id uuid default null,
  p_start_date date default null,
  p_method public.payment_method default null,
  p_paid_on date default null
)
returns table (marks_deleted integer, money integer, kept boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.enrollments%rowtype;
  v_from public.groups%rowtype;
  v_to public.groups%rowtype;
  v_has_payments boolean;
  v_has_money boolean;
  v_marks integer;
  v_target_sub uuid;
  v_target_enrollment uuid;
  v_tariff public.tariffs%rowtype;
  v_start date;
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
  select * into v_from from public.groups g where g.id = v_old.group_id;

  if exists (
    select 1 from public.enrollment_attendance(p_enrollment_id) a
    join public.lessons l on l.id = a.lesson_id
    where l.is_locked
  ) then
    raise exception 'the enrollment has marks in a closed period' using errcode = 'check_violation';
  end if;

  v_has_payments := exists (
    select 1 from public.payments p
    join public.subscriptions s on s.id = p.subscription_id
    where s.enrollment_id = p_enrollment_id
  );
  v_has_money := exists (
    select 1 from public.subscriptions s
    where s.enrollment_id = p_enrollment_id
      and coalesce((select sum(p.amount) from public.payments p where p.subscription_id = s.id), 0) <> 0
  );

  if v_has_money then
    if p_money is null or p_money not in ('transfer', 'refund') then
      raise exception 'the enrollment has payments — transfer them to the right group or refund'
        using errcode = 'check_violation';
    end if;
    if p_money = 'refund' then
      if p_method is null then
        raise exception 'payment method is required for a refund' using errcode = 'check_violation';
      end if;
      if exists (
        select 1 from public.subscriptions s
        where s.enrollment_id = p_enrollment_id
          and coalesce((select sum(p.amount) from public.payments p where p.subscription_id = s.id), 0) < 0
      ) then
        raise exception 'a debt cannot be refunded — transfer it' using errcode = 'check_violation';
      end if;
    else
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
    end if;
  end if;

  perform set_config('iqup.audit_reason', 'delete_enrollment', true);

  with gone as (
    delete from public.attendance a
    where a.id in (select m.id from public.enrollment_attendance(p_enrollment_id) m)
    returning 1
  )
  select count(*)::integer into v_marks from gone;

  perform set_config('iqup.undo_enrollment', p_enrollment_id::text, true);
  update public.trials t set status = 'attended', enrollment_id = null
  where t.enrollment_id = p_enrollment_id;
  perform set_config('iqup.undo_enrollment', '', true);

  if not v_has_payments then
    delete from public.subscriptions s where s.enrollment_id = p_enrollment_id;
    delete from public.enrollments e where e.id = p_enrollment_id;
    perform set_config('iqup.audit_reason', '', true);
    return query select v_marks, 0, false;
    return;
  end if;

  if v_has_money and p_money = 'transfer' then
    if v_to.group_type = v_from.group_type and not exists (
      select 1 from public.enrollments e
      where e.student_id = v_old.student_id and e.group_id = p_group_id
        and not (e.status = 'finished' and e.end_date is null)
    ) then
      -- nothing is written off any more: the whole enrollment moves (#73)
      perform public.transfer_enrollment(
        p_enrollment_id, p_group_id, coalesce(p_start_date, greatest(v_old.start_date, v_to.start_date))
      );
      perform set_config('iqup.audit_reason', '', true);
      return query
      select v_marks,
             (select coalesce(sum(p.amount), 0)::integer from public.payments p
              join public.subscriptions s on s.id = p.subscription_id
              where s.enrollment_id = p_enrollment_id),
             false;
      return;
    end if;

    select e.id into v_target_enrollment from public.enrollments e
    where e.student_id = v_old.student_id and e.group_id = p_group_id and e.status = 'active'
    order by e.start_date desc
    limit 1;
    if v_target_enrollment is not null then
      select s.id into v_target_sub from public.subscriptions s
      where s.enrollment_id = v_target_enrollment and s.status <> 'refunded'
      order by s.started_at desc, s.created_at desc, s.id desc
      limit 1;
    end if;
    if v_target_sub is null then
      v_start := coalesce(p_start_date, greatest(v_old.start_date, v_to.start_date));
      if v_start < v_to.start_date or (v_to.end_date is not null and v_start > v_to.end_date) then
        raise exception 'start date is outside the group dates' using errcode = 'check_violation';
      end if;
      select * into v_tariff from public.tariffs t
      where t.group_type = v_to.group_type and t.valid_from <= v_start
      order by t.valid_from desc
      limit 1;
      if not found then
        raise exception 'no tariff for % on %', v_to.group_type, v_start using errcode = 'check_violation';
      end if;
      if v_target_enrollment is null then
        if exists (
          select 1 from public.enrollments e
          where e.student_id = v_old.student_id and e.group_id = p_group_id and e.start_date = v_start
        ) then
          raise exception 'the student is already enrolled in the target group' using errcode = 'unique_violation';
        end if;
        insert into public.enrollments (student_id, group_id, start_date)
        values (v_old.student_id, p_group_id, v_start)
        returning id into v_target_enrollment;
      end if;
      insert into public.subscriptions (
        enrollment_id, tariff_id, lessons_total, price_full, discount_percent, discount_reason, price_final, started_at
      )
      values (
        v_target_enrollment, v_tariff.id, v_tariff.lessons_in_package, v_tariff.package_price, 0, 'none',
        v_tariff.package_price, v_start
      )
      returning id into v_target_sub;
    end if;

    for r in
      select s.id, coalesce(sum(p.amount), 0)::integer as net
      from public.subscriptions s
      left join public.payments p on p.subscription_id = s.id
      where s.enrollment_id = p_enrollment_id
      group by s.id
      having coalesce(sum(p.amount), 0) <> 0
    loop
      insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id)
      values (r.id, -r.net, null, 'transfer', 'перенос в ' || public.group_title(p_group_id), v_transfer);
      v_moved := v_moved + r.net;
    end loop;
    insert into public.payments (subscription_id, amount, method, kind, reason, transfer_id)
    values (v_target_sub, v_moved, null, 'transfer',
            'перенос из ' || public.group_title(v_old.group_id) || ' (записан по ошибке)', v_transfer);
  elsif v_has_money then
    for r in
      select s.id, coalesce(sum(p.amount), 0)::integer as net
      from public.subscriptions s
      left join public.payments p on p.subscription_id = s.id
      where s.enrollment_id = p_enrollment_id
      group by s.id
      having coalesce(sum(p.amount), 0) > 0
    loop
      insert into public.payments (subscription_id, amount, method, paid_at, kind, reason)
      values (r.id, -r.net, p_method, public.payment_time(p_paid_on), 'refund', 'записан по ошибке');
      v_moved := v_moved + r.net;
    end loop;
  end if;

  -- the void record: subscriptions without payments go, the rest are refunded (closed: out of
  -- attendance_subscription and the balance chain — its money was transferred or refunded), the
  -- enrollment is on no roster and holds no dates
  delete from public.subscriptions s
  where s.enrollment_id = p_enrollment_id
    and not exists (select 1 from public.payments p where p.subscription_id = s.id);
  update public.subscriptions s set status = 'refunded'
  where s.enrollment_id = p_enrollment_id and s.status <> 'refunded';
  update public.enrollments set status = 'finished', end_date = null where id = p_enrollment_id;

  perform set_config('iqup.audit_reason', '', true);
  return query select v_marks, v_moved, true;
end;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────

revoke execute on function
  public.group_title(uuid),
  public.subscription_settlement(uuid),
  public.transfer_default_start(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.enrollment_settlement(uuid),
  public.enrollment_payroll_impact(uuid),
  public.transfer_preview(uuid, uuid, date),
  public.transfer_student(uuid, uuid, date, boolean, public.payment_method, date),
  public.withdraw_enrollment(uuid, date, integer, public.payment_method, text, date, text),
  public.delete_enrollment(uuid, text, uuid, date, public.payment_method, date)
from public, anon;

grant execute on function
  public.enrollment_settlement(uuid),
  public.enrollment_payroll_impact(uuid),
  public.transfer_preview(uuid, uuid, date),
  public.transfer_student(uuid, uuid, date, boolean, public.payment_method, date),
  public.withdraw_enrollment(uuid, date, integer, public.payment_method, text, date, text),
  public.delete_enrollment(uuid, text, uuid, date, public.payment_method, date)
to authenticated;
