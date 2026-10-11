-- 0001_core — ядро R1: люди, тарифы, группы, расписание, занятия, ученики, абонементы, посещаемость, аудит.
-- Модель: docs/01-domain-model.md §2; доступ: docs/02-architecture.md §5; инварианты: CLAUDE.md.
-- payments, payroll_*, trials — в следующих миграциях.

-- ─── Enums ──────────────────────────────────────────────────────────────────

create type public.role as enum ('teacher', 'admin', 'accountant');
create type public.group_type as enum ('group', 'mini', 'pair', 'individual', 'afterschool');
create type public.group_status as enum ('forming', 'active', 'archived');
create type public.lesson_status as enum ('planned', 'held', 'cancelled');
create type public.cancel_reason as enum ('center', 'teacher', 'holiday', 'all_frozen');
create type public.attendance_status as enum ('present', 'absent_frozen', 'absent_burned');
create type public.enrollment_status as enum ('active', 'finished');
create type public.subscription_status as enum ('active', 'exhausted', 'refunded');
create type public.discount_reason as enum ('none', 'returning', 'referral');

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique check (phone ~ '^996[0-9]{9}$'),
  full_name text not null check (length(trim(full_name)) > 0),
  roles public.role[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on column public.profiles.roles is 'Duplicate of auth app_metadata.roles; RLS reads the JWT, not this column.';

-- A teacher exists before their login: user_id is linked when the account is created
-- (scripts/seed-users.ts / Edge Function create-user), matched by phone.
create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text unique check (phone ~ '^996[0-9]{9}$'),
  created_at timestamptz not null default now()
);

create table public.teacher_rates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  percent numeric(5, 2) not null check (percent > 0 and percent <= 100),
  valid_from date not null,
  created_at timestamptz not null default now(),
  unique (teacher_id, valid_from)
);

create table public.tariffs (
  id uuid primary key default gen_random_uuid(),
  group_type public.group_type not null,
  lessons_in_package integer not null check (lessons_in_package > 0),
  package_price integer not null check (package_price > 0),
  max_students integer not null check (max_students > 0),
  lesson_duration_min integer not null check (lesson_duration_min > 0),
  freeze_limit integer not null default 2 check (freeze_limit >= 0),
  valid_from date not null,
  created_at timestamptz not null default now(),
  unique (group_type, valid_from)
);

create table public.holidays (
  day date primary key,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  subject text not null,
  grade integer check (grade between 1 and 11),
  group_type public.group_type not null,
  teacher_id uuid not null references public.teachers (id),
  start_date date not null,
  end_date date,
  status public.group_status not null default 'forming',
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index on public.groups (teacher_id);

create table public.schedule_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  weekday integer not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  start_time time not null,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index on public.schedule_rules (group_id);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  lesson_date date not null,
  planned_start time not null,
  duration_min integer not null check (duration_min > 0),
  is_extra boolean not null default false,
  makes_up_for_lesson_id uuid references public.lessons (id),
  substitute_teacher_id uuid references public.teachers (id), -- informational only, payroll goes to groups.teacher_id
  status public.lesson_status not null default 'planned',
  cancel_reason public.cancel_reason,
  confirmed_at timestamptz, -- set by DB on transition to held, never edited
  confirmed_by uuid references public.profiles (id),
  confirmed_late boolean not null default false,
  comment text,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (group_id, lesson_date, planned_start),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status <> 'held' or confirmed_at is not null)
);
create index on public.lessons (lesson_date);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  grade integer check (grade between 1 and 11),
  parent_name text,
  parent_phone text check (parent_phone ~ '^996[0-9]{9}$'),
  is_returning boolean not null default false,
  referred_by_student_id uuid references public.students (id),
  notes text,
  created_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  group_id uuid not null references public.groups (id),
  start_date date not null,
  end_date date,
  status public.enrollment_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (student_id, group_id, start_date),
  check (end_date is null or end_date >= start_date)
);
create index on public.enrollments (group_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id),
  tariff_id uuid not null references public.tariffs (id), -- tariff snapshot at purchase date
  lessons_total integer not null check (lessons_total > 0),
  price_full integer not null check (price_full >= 0),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  discount_reason public.discount_reason not null default 'none',
  price_final integer not null check (price_final >= 0 and price_final <= price_full),
  started_at date not null,
  status public.subscription_status not null default 'active',
  created_at timestamptz not null default now(),
  check ((discount_percent = 0) = (discount_reason = 'none'))
);
create index on public.subscriptions (enrollment_id);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id),
  student_id uuid not null references public.students (id),
  subscription_id uuid references public.subscriptions (id),
  status public.attendance_status not null,
  consumes_credit boolean generated always as (status in ('present', 'absent_burned')) stored,
  marked_at timestamptz not null default now(),
  marked_by uuid references public.profiles (id),
  unique (lesson_id, student_id)
);
create index on public.attendance (subscription_id);
create index on public.attendance (student_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid, -- auth.uid(); null for service role / migrations
  entity text not null,
  entity_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);
create index on public.audit_log (entity, entity_id);
create index on public.audit_log (at desc);

-- ─── Role helpers (JWT app_metadata.roles) ─────────────────────────────────

create function public.current_roles()
returns public.role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array(
      select r::public.role
      from jsonb_array_elements_text(coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb)) as r
      where r in ('teacher', 'admin', 'accountant')
    ),
    '{}'
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select 'admin'::public.role = any (public.current_roles()); $$;

create function public.is_accountant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select 'accountant'::public.role = any (public.current_roles()); $$;

-- Admin or accountant: both read everything (matrix §5).
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.is_admin() or public.is_accountant(); $$;

create function public.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select t.id from public.teachers t where t.user_id = auth.uid(); $$;

create function public.teaches_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    join public.teachers t on t.id = g.teacher_id
    where g.id = p_group_id and t.user_id = auth.uid()
  );
$$;

create function public.teaches_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lessons l
    where l.id = p_lesson_id and public.teaches_group(l.group_id)
  );
$$;

create function public.teaches_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and public.teaches_group(e.group_id)
  );
$$;

create function public.teaches_enrollment(p_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment_id and public.teaches_group(e.group_id)
  );
$$;

-- ─── RPC ────────────────────────────────────────────────────────────────────

-- Client clock offset: now = Date.now() + (server_now() - Date.now()) — architecture §7.1.
create function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now(); $$;

-- Today in Asia/Bishkek (UTC+6, no DST) — invariant 8.
create function public.bishkek_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Bishkek')::date; $$;

grant execute on function public.server_now() to anon, authenticated;

-- ─── Triggers: lessons ──────────────────────────────────────────────────────

create function public.lessons_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mutable constant text[] := array['status', 'comment', 'confirmed_at', 'confirmed_by', 'confirmed_late'];
begin
  if tg_op = 'DELETE' then
    if old.is_locked then
      raise exception 'lesson % is in a closed period', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
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

  if old.confirmed_at is not null then
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

create trigger lessons_guard
before insert or update or delete on public.lessons
for each row execute function public.lessons_guard();

-- ─── Triggers: attendance ───────────────────────────────────────────────────

create function public.attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson_ids uuid[];
begin
  v_lesson_ids := case tg_op
    when 'INSERT' then array[new.lesson_id]
    when 'DELETE' then array[old.lesson_id]
    else array[old.lesson_id, new.lesson_id]
  end;
  if exists (select 1 from public.lessons l where l.id = any (v_lesson_ids) and l.is_locked) then
    raise exception 'attendance belongs to a closed period' using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  new.marked_at := now();
  new.marked_by := auth.uid();

  if new.subscription_id is not null and not exists (
    select 1
    from public.subscriptions s
    join public.enrollments e on e.id = s.enrollment_id
    where s.id = new.subscription_id and e.student_id = new.student_id
  ) then
    raise exception 'subscription % does not belong to student %', new.subscription_id, new.student_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger attendance_guard
before insert or update or delete on public.attendance
for each row execute function public.attendance_guard();

-- absent_frozen per subscription ≤ tariffs.freeze_limit (invariant 5).
create function public.enforce_freeze_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used integer;
begin
  if new.status <> 'absent_frozen' or new.subscription_id is null then
    return new;
  end if;

  -- Serialize concurrent marks on the same subscription.
  select t.freeze_limit into v_limit
  from public.subscriptions s
  join public.tariffs t on t.id = s.tariff_id
  where s.id = new.subscription_id
  for update of s;

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

create trigger enforce_freeze_limit
before insert or update of status, subscription_id on public.attendance
for each row execute function public.enforce_freeze_limit();

-- ─── Audit log ──────────────────────────────────────────────────────────────

-- Optional reason: `set local iqup.audit_reason = '...'` in the same transaction.
create function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, entity, entity_id, action, before, after, reason)
  values (
    auth.uid(),
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    nullif(current_setting('iqup.audit_reason', true), '')
  );
  return null;
end;
$$;

create trigger audit_log after insert or update or delete on public.lessons
for each row execute function public.write_audit_log();
create trigger audit_log after insert or update or delete on public.attendance
for each row execute function public.write_audit_log();
create trigger audit_log after insert or update or delete on public.subscriptions
for each row execute function public.write_audit_log();
create trigger audit_log after insert or update or delete on public.teacher_rates
for each row execute function public.write_audit_log();
create trigger audit_log after insert or update or delete on public.enrollments
for each row execute function public.write_audit_log();

-- Trigger/helper functions are not part of the public API.
revoke execute on function
  public.lessons_guard(), public.attendance_guard(), public.enforce_freeze_limit(), public.write_audit_log()
from public, anon, authenticated;

-- ─── Views (security_invoker → caller's RLS applies) ───────────────────────

create view public.v_lesson_status
with (security_invoker = true)
as
select
  l.*,
  case
    when l.status = 'planned' and l.lesson_date < public.bishkek_today() then 'unconfirmed'
    else l.status::text
  end as effective_status
from public.lessons l;

create view public.v_subscription_balances
with (security_invoker = true)
as
select
  s.id as subscription_id,
  s.enrollment_id,
  e.student_id,
  e.group_id,
  s.status,
  s.lessons_total,
  count(a.id) filter (where a.consumes_credit)::integer as lessons_used,
  (s.lessons_total - count(a.id) filter (where a.consumes_credit))::integer as lessons_left,
  count(a.id) filter (where a.status = 'absent_frozen')::integer as freezes_used,
  t.freeze_limit
from public.subscriptions s
join public.enrollments e on e.id = s.enrollment_id
join public.tariffs t on t.id = s.tariff_id
left join public.attendance a on a.subscription_id = s.id
group by s.id, e.student_id, e.group_id, t.freeze_limit;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.teacher_rates enable row level security;
alter table public.tariffs enable row level security;
alter table public.holidays enable row level security;
alter table public.groups enable row level security;
alter table public.schedule_rules enable row level security;
alter table public.lessons enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_log enable row level security;

-- profiles: teacher — own; admin — CRUD; accountant — read
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- teachers
create policy teachers_select on public.teachers for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy teachers_admin_write on public.teachers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- teacher_rates: teacher reads own percent
create policy teacher_rates_select on public.teacher_rates for select to authenticated
  using (teacher_id = public.current_teacher_id() or public.is_staff());
create policy teacher_rates_admin_write on public.teacher_rates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tariffs, holidays: everyone signed in reads (prices and days off), admin writes
create policy tariffs_select on public.tariffs for select to authenticated using (true);
create policy tariffs_admin_write on public.tariffs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy holidays_select on public.holidays for select to authenticated using (true);
create policy holidays_admin_write on public.holidays for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- groups, schedule_rules: teacher — own
create policy groups_select on public.groups for select to authenticated
  using (public.teaches_group(id) or public.is_staff());
create policy groups_admin_write on public.groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy schedule_rules_select on public.schedule_rules for select to authenticated
  using (public.teaches_group(group_id) or public.is_staff());
create policy schedule_rules_admin_write on public.schedule_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- lessons: teacher reads own, creates extra lessons for own groups, confirms (column rules in lessons_guard)
create policy lessons_select on public.lessons for select to authenticated
  using (public.teaches_group(group_id) or public.is_staff());
create policy lessons_insert on public.lessons for insert to authenticated
  with check (
    public.is_admin()
    or (public.teaches_group(group_id) and is_extra and status = 'planned')
  );
create policy lessons_update on public.lessons for update to authenticated
  using (public.is_admin() or public.teaches_group(group_id))
  with check (public.is_admin() or public.teaches_group(group_id));
create policy lessons_delete on public.lessons for delete to authenticated
  using (public.is_admin());

-- students: teacher reads students of own groups
create policy students_select on public.students for select to authenticated
  using (public.teaches_student(id) or public.is_staff());
create policy students_admin_write on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- enrollments
create policy enrollments_select on public.enrollments for select to authenticated
  using (public.teaches_group(group_id) or public.is_staff());
create policy enrollments_admin_write on public.enrollments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- subscriptions: teacher reads own students' balances
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.teaches_enrollment(enrollment_id) or public.is_staff());
create policy subscriptions_admin_write on public.subscriptions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- attendance: teacher inserts/updates on own lessons
create policy attendance_select on public.attendance for select to authenticated
  using (public.teaches_lesson(lesson_id) or public.is_staff());
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.is_admin() or public.teaches_lesson(lesson_id));
create policy attendance_update on public.attendance for update to authenticated
  using (public.is_admin() or public.teaches_lesson(lesson_id))
  with check (public.is_admin() or public.teaches_lesson(lesson_id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.is_admin());

-- audit_log: read-only for admin and accountant; written only by trigger
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_staff());

-- ─── Realtime (architecture §7.1) ───────────────────────────────────────────

alter publication supabase_realtime add table public.lessons, public.attendance;
