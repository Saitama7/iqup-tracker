-- archive_group (0008) also finishes the group's active enrollments (PR #24 review):
-- status = 'finished', end_date = today in Bishkek (not before start_date for enrollments that start later).
-- Subscriptions stay untouched — remainder and refunds are R2.
create or replace function public.archive_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  perform public.assert_admin();

  update public.groups set status = 'archived' where id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;

  update public.enrollments e
  set status = 'finished',
      end_date = greatest(e.start_date, public.bishkek_today())
  where e.group_id = p_group_id and e.status = 'active';

  with gone as (
    delete from public.lessons l
    where l.group_id = p_group_id
      and l.status = 'planned'
      and public.lesson_starts_at(l.lesson_date, l.planned_start) > now()
      and not exists (select 1 from public.attendance a where a.lesson_id = l.id)
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;
