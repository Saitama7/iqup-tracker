-- 0006 — А9 «Тарифы и праздники», А9а «История тарифов» (issue #7).
-- 1. tariffs.created_by — «кто и когда» in the tariff history.
-- 2. A tariff in effect (valid_from <= today) is never changed or deleted: lessons already held
--    were priced by it. A new price is a new set of rows with a future valid_from; a planned
--    (future) set may still be deleted. From the app a tariff can only be planned for the future.
-- 3. A past holiday is history (lessons were not generated / were cancelled) — no edits or
--    deletes; from the app holidays are added from today on.
-- Service role / migrations / seed (no admin JWT) may insert past rows (initial import).

-- ─── 1. created_by ──────────────────────────────────────────────────────────

alter table public.tariffs
  add column created_by uuid default auth.uid() references auth.users (id) on delete set null;

-- ─── 2. tariffs guard ───────────────────────────────────────────────────────

create function public.tariffs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    if new.valid_from <= public.bishkek_today() then
      raise exception 'a new tariff must start after today' using errcode = 'check_violation';
    end if;
    -- author is the signed-in user, not a client-supplied value
    new.created_by := case when tg_op = 'INSERT' then auth.uid() else old.created_by end;
  end if;
  return new;
end;
$$;

create trigger tariffs_guard
before insert or update or delete on public.tariffs
for each row execute function public.tariffs_guard();

-- ─── 3. holidays guard ──────────────────────────────────────────────────────

create function public.holidays_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.day < public.bishkek_today() then
    raise exception 'past holiday % cannot be changed', old.day using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if public.is_admin() and new.day < public.bishkek_today() then
    raise exception 'a holiday cannot be added in the past' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger holidays_guard
before insert or update or delete on public.holidays
for each row execute function public.holidays_guard();

revoke execute on function public.tariffs_guard(), public.holidays_guard()
from public, anon, authenticated;
