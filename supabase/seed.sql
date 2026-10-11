-- Dev seed. Names and groups match the design canvas (docs/06-design.md): У4/У5/УД3, А3, А8, А9.
-- Auth users and profiles are NOT created here — see scripts/seed-users.ts (R0-3); it links teachers.user_id by phone.
-- Lessons are not seeded: the schedule generator comes in R1.

-- Tariffs — docs/01-domain-model.md §3 (September 2026)
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from) values
  ('group',       12, 3200, 10,  60, 2, '2026-09-01'),
  ('mini',        12, 3800,  4,  60, 2, '2026-09-01'),
  ('pair',        12, 4400,  2,  60, 2, '2026-09-01'),
  ('individual',  12, 7200,  1,  60, 2, '2026-09-01'),
  ('afterschool', 20, 7400,  8, 180, 2, '2026-09-01');

-- Holidays — А9, school year 2026/27
insert into public.holidays (day, name) values
  ('2026-11-07', 'День Октябрьской революции'),
  ('2026-12-31', 'Новый год · каникулы центра'),
  ('2027-01-01', 'Новый год · каникулы центра'),
  ('2027-01-02', 'Новый год · каникулы центра'),
  ('2027-01-07', 'Рождество'),
  ('2027-02-23', 'День защитника Отечества'),
  ('2027-03-08', 'Международный женский день'),
  ('2027-03-21', 'Нооруз'),
  ('2027-05-01', 'День труда');

-- Teachers — А8 (phones are login candidates for seed-users)
insert into public.teachers (id, full_name, phone) values
  ('00000000-0000-4000-a000-000000000001', 'Гульзат Асанова',  '996555123456'),
  ('00000000-0000-4000-a000-000000000002', 'Айпери Жусупова',  '996555201001'),
  ('00000000-0000-4000-a000-000000000003', 'Бекзат Ормонов',   '996555201002'),
  ('00000000-0000-4000-a000-000000000004', 'Нургуль Токтоева', '996555201004'),
  ('00000000-0000-4000-a000-000000000005', 'Эльмира Садыкова', '996555201005');

insert into public.teacher_rates (teacher_id, percent, valid_from) values
  ('00000000-0000-4000-a000-000000000001', 45, '2026-09-01'),
  ('00000000-0000-4000-a000-000000000002', 50, '2026-09-01'),
  ('00000000-0000-4000-a000-000000000003', 45, '2026-09-01'),
  ('00000000-0000-4000-a000-000000000004', 45, '2026-09-01'),
  ('00000000-0000-4000-a000-000000000005', 45, '2026-09-01');

-- Groups of Гульзат — У4 / УД3 / А3
insert into public.groups (id, name, subject, grade, group_type, teacher_id, start_date, status) values
  ('00000000-0000-4000-b000-000000000001', '8 класс А', 'Математика', 8, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000002', '6 класс',   'Математика', 6, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000003', '8 класс Б', 'Математика', 8, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000004', '5 класс',   'Математика', 5, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active');

-- Schedule: 8А 09:00, 6 кл 11:00, 8Б 14:00 — ВТ/ЧТ/СБ; 5 кл 15:00 — ПН/СР/ПТ
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, d.weekday, g.t::time, '2026-09-01'
from (values
  ('00000000-0000-4000-b000-000000000001'::uuid, '09:00', array[2, 4, 6]),
  ('00000000-0000-4000-b000-000000000002'::uuid, '11:00', array[2, 4, 6]),
  ('00000000-0000-4000-b000-000000000003'::uuid, '14:00', array[2, 4, 6]),
  ('00000000-0000-4000-b000-000000000004'::uuid, '15:00', array[1, 3, 5])
) as g (id, t, days)
cross join lateral unnest(g.days) as d (weekday);

-- Students + enrollments (8А exactly as УД3; other groups — dev placeholders of the same size as У4)
with roster (group_id, full_name, grade, parent_phone, start_date, is_returning) as (
  values
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Айжан Бекова',        8, '996555111222', date '2026-09-15', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Бакыт Токтосунов',    8, '996700333444', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Данияр Кадыров',      8, '996555777888', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Элина Сыдыкова',      8, '996555123456', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Камила Орозова',      8, '996770555666', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Нурлан Асанов',       8, '996555999000', date '2026-10-01', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Сезим Жумабекова',    8, '996555222333', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Тимур Мамбетов',      8, '996555444555', date '2026-09-01', true),

    ('00000000-0000-4000-b000-000000000002'::uuid, 'Адилет Сапаров',      6, '996555310001', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Айдана Келдибекова',  6, '996555310002', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Бектур Алиев',        6, '996555310003', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Мээрим Турдубаева',   6, '996555310004', date '2026-09-08', false),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Эрлан Шамшиев',       6, '996555310005', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Асема Ниязова',       6, '996555310006', date '2026-09-15', false),

    ('00000000-0000-4000-b000-000000000003'::uuid, 'Алина Исакова',       8, '996555320001', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Арсен Дуйшеев',       8, '996555320002', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Бегимай Осмонова',    8, '996555320003', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Даниэль Курманов',    8, '996555320004', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Жибек Абдраева',      8, '996555320005', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Нурсултан Бакиров',   8, '996555320006', date '2026-09-10', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Сабина Темирова',     8, '996555320007', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Улан Жээнбеков',      8, '996555320008', date '2026-09-01', false),

    ('00000000-0000-4000-b000-000000000004'::uuid, 'Аделя Мусаева',       5, '996555330001', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Байэл Токтогулов',    5, '996555330002', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Гулина Эсенова',      5, '996555330003', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Илияс Абдыкадыров',   5, '996555330004', date '2026-09-01', false),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Нурай Жолдошева',     5, '996555330005', date '2026-09-21', false),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Тилек Орозбаев',      5, '996555330006', date '2026-09-01', false)
),
new_students as (
  insert into public.students (full_name, grade, parent_phone, is_returning)
  select full_name, grade, parent_phone, is_returning from roster
  returning id, full_name
)
insert into public.enrollments (student_id, group_id, start_date)
select s.id, r.group_id, r.start_date
from roster r
join new_students s on s.full_name = r.full_name;

-- One subscription per enrollment at the group tariff; returning students get 15 % on the first one (В5)
insert into public.subscriptions (enrollment_id, tariff_id, lessons_total, price_full, discount_percent, discount_reason, price_final, started_at)
select
  e.id,
  t.id,
  t.lessons_in_package,
  t.package_price,
  case when st.is_returning then 15 else 0 end,
  case when st.is_returning then 'returning' else 'none' end::public.discount_reason,
  round(t.package_price * (100 - case when st.is_returning then 15 else 0 end) / 100.0)::integer,
  e.start_date
from public.enrollments e
join public.students st on st.id = e.student_id
join public.groups g on g.id = e.group_id
join public.tariffs t on t.group_type = g.group_type and t.valid_from <= e.start_date;
