-- #42 · Subjects as a reference table instead of free text in groups.subject.
-- subjects: everyone signed in reads, admin adds / renames / hides (is_active = false keeps the
-- subject on existing groups but drops it from «Новая группа»). groups.subject → subject_id,
-- existing rows are moved by name. A group name is unique per subject among groups that are not
-- archived («Математика · 8 класс А» / «… Б», А3); create_group takes p_subject_id.

-- ─── subjects ───────────────────────────────────────────────────────────────

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) > 0 and name = btrim(name)),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- «Математика» and «математика» are the same subject
create unique index subjects_name_ci_key on public.subjects (lower(name));

-- The list the form had in code (А3), then any other subject already used by a group.
insert into public.subjects (name, sort_order) values
  ('Математика', 10),
  ('Химия', 20),
  ('ОРТ', 30),
  ('Продлёнка', 40),
  ('Индивидуально', 50);

insert into public.subjects (name, sort_order)
select s.name, 100 + (row_number() over (order by s.name))::integer
from (
  select distinct on (lower(btrim(g.subject))) btrim(g.subject) as name
  from public.groups g
  where btrim(g.subject) <> ''
  order by lower(btrim(g.subject)), btrim(g.subject)
) s
where not exists (select 1 from public.subjects x where lower(x.name) = lower(s.name));

alter table public.subjects enable row level security;

create policy subjects_select on public.subjects for select to authenticated using (true);
create policy subjects_admin_write on public.subjects for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── groups.subject → subject_id ────────────────────────────────────────────

alter table public.groups add column subject_id uuid references public.subjects (id);

update public.groups g
set subject_id = s.id
from public.subjects s
where lower(s.name) = lower(btrim(g.subject));

alter table public.groups alter column subject_id set not null;
alter table public.groups drop column subject;
create index on public.groups (subject_id);

-- «Математика · 7 класс» exists once among running groups; the next one gets a letter (А3).
create unique index groups_active_name_key on public.groups (subject_id, lower(btrim(name)))
  where status <> 'archived';

-- ─── create_group ───────────────────────────────────────────────────────────

drop function public.create_group(
  text, text, integer, public.group_type, uuid, integer[], time, date, text, date
);

-- «Новая группа» (А3): group + one schedule rule per weekday (same time) + lessons up to p_until,
-- one transaction. The group starts as forming (01-domain-model §7 #14).
create function public.create_group(
  p_name text,
  p_subject_id uuid,
  p_grade integer,
  p_group_type public.group_type,
  p_teacher_id uuid,
  p_weekdays integer[],
  p_start_time time,
  p_start_date date,
  p_room text,
  p_until date
)
returns table (group_id uuid, lessons_created integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  perform public.assert_admin();

  if p_weekdays is null or cardinality(p_weekdays) = 0
     or exists (select 1 from unnest(p_weekdays) w where w not between 1 and 7) then
    raise exception 'pick at least one weekday' using errcode = 'check_violation';
  end if;
  if p_start_time is null or p_start_date is null then
    raise exception 'time and start date are required' using errcode = 'check_violation';
  end if;
  if public.tariff_duration(p_group_type, p_start_date) is null then
    raise exception 'no tariff for % on %', p_group_type, p_start_date using errcode = 'check_violation';
  end if;

  insert into public.groups (name, subject_id, grade, group_type, teacher_id, start_date, room)
  values (trim(p_name), p_subject_id, p_grade, p_group_type, p_teacher_id, p_start_date,
          nullif(trim(coalesce(p_room, '')), ''))
  returning id into v_group_id;

  insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
  select v_group_id, w, p_start_time, p_start_date
  from (select distinct unnest(p_weekdays) as w) d;

  return query select v_group_id, public.generate_lessons(v_group_id, p_until);
end;
$$;

revoke execute on function
  public.create_group(text, uuid, integer, public.group_type, uuid, integer[], time, date, text, date)
  from public, anon;
grant execute on function
  public.create_group(text, uuid, integer, public.group_type, uuid, integer[], time, date, text, date)
  to authenticated;
