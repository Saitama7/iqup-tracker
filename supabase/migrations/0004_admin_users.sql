-- 0004 — А8 «Учителя и доступ» (issue #6).
-- 1. Adding the teacher role to an existing profile links/creates its teachers row (same rule as 0003).
-- 2. teacher_rates is append-only: a new percent is a new row with valid_from, history is never rewritten.
-- 3. Last sign-in for the users table (auth.users is not exposed to the client).

-- ─── 1. link_teacher_profile on role change ────────────────────────────────

-- The function is idempotent: an already linked profile is left as is.
create trigger link_teacher_profile_on_roles
after update of roles on public.profiles
for each row
when ('teacher'::public.role = any (new.roles) and not ('teacher'::public.role = any (old.roles)))
execute function public.link_teacher_profile();

-- ─── 2. teacher_rates: insert only ─────────────────────────────────────────

drop policy teacher_rates_admin_write on public.teacher_rates;
create policy teacher_rates_admin_insert on public.teacher_rates for insert to authenticated
  with check (public.is_admin());

-- ─── 3. Last sign-in ────────────────────────────────────────────────────────

-- Staff only; anyone else gets no rows.
create function public.user_last_sign_in()
returns table (user_id uuid, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_staff();
$$;

revoke execute on function public.user_last_sign_in() from public, anon;
grant execute on function public.user_last_sign_in() to authenticated;
