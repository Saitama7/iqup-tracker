-- 0003 — a new profile with the teacher role is linked to its teachers row by phone (issue #3).
-- One rule for scripts/seed-users.ts and the Edge Function create-user:
--   teachers row with the same phone and no user → link it; no row → create one.

create function public.link_teacher_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ('teacher'::public.role = any (new.roles)) then
    return null;
  end if;

  update public.teachers
  set user_id = new.id
  where phone = new.phone and user_id is null;

  if not found and not exists (select 1 from public.teachers where user_id = new.id) then
    if exists (select 1 from public.teachers where phone = new.phone) then
      raise exception 'teacher with phone % is already linked to another user', new.phone
        using errcode = 'unique_violation';
    end if;
    insert into public.teachers (user_id, full_name, phone)
    values (new.id, new.full_name, new.phone);
  end if;

  return null;
end;
$$;

revoke execute on function public.link_teacher_profile() from public, anon, authenticated;

create trigger link_teacher_profile
after insert on public.profiles
for each row execute function public.link_teacher_profile();
