-- Dev seed. Names and groups match the design canvas (docs/06-design.md): У4/У5/УД3, А3, А8, А9.
-- Auth users and profiles are NOT created here — see scripts/seed-users.ts (R0-3); it links teachers.user_id by phone.
-- Lessons are not seeded: the schedule generator comes in R1.

-- Tariffs — docs/01-domain-model.md §3; in effect since September 2026, earlier versions for А9а
insert into public.tariffs (group_type, lessons_in_package, package_price, max_students, lesson_duration_min, freeze_limit, valid_from, created_at) values
  ('group',       12, 2800, 10,  60, 2, '2025-02-01', '2025-01-20 12:00+06'),
  ('mini',        12, 3200,  4,  60, 2, '2025-02-01', '2025-01-20 12:00+06'),
  ('pair',        12, 3600,  2,  60, 2, '2025-02-01', '2025-01-20 12:00+06'),
  ('individual',  12, 6000,  1,  60, 2, '2025-02-01', '2025-01-20 12:00+06'),
  ('afterschool', 20, 6500,  8, 180, 2, '2025-02-01', '2025-01-20 12:00+06'),
  ('group',       12, 3000, 10,  60, 2, '2025-09-01', '2025-08-20 12:00+06'),
  ('mini',        12, 3500,  4,  60, 2, '2025-09-01', '2025-08-20 12:00+06'),
  ('pair',        12, 4000,  2,  60, 2, '2025-09-01', '2025-08-20 12:00+06'),
  ('individual',  12, 6500,  1,  60, 2, '2025-09-01', '2025-08-20 12:00+06'),
  ('afterschool', 20, 7000,  8, 180, 2, '2025-09-01', '2025-08-20 12:00+06'),
  ('group',       12, 3200, 10,  60, 2, '2026-09-01', '2026-08-25 12:00+06'),
  ('mini',        12, 3800,  4,  60, 2, '2026-09-01', '2026-08-25 12:00+06'),
  ('pair',        12, 4400,  2,  60, 2, '2026-09-01', '2026-08-25 12:00+06'),
  ('individual',  12, 7200,  1,  60, 2, '2026-09-01', '2026-08-25 12:00+06'),
  ('afterschool', 20, 7400,  8, 180, 2, '2026-09-01', '2026-08-25 12:00+06');

-- Holidays — А9, school year 2026/27 (+ two past days: locked, cannot be deleted)
insert into public.holidays (day, name) values
  ('2026-05-09', 'День Победы'),
  ('2026-08-31', 'День независимости'),
  ('2026-11-07', 'День Октябрьской революции'),
  ('2026-12-31', 'Новый год · каникулы центра'),
  ('2027-01-01', 'Новый год · каникулы центра'),
  ('2027-01-02', 'Новый год · каникулы центра'),
  ('2027-01-07', 'Рождество'),
  ('2027-02-23', 'День защитника Отечества'),
  ('2027-03-08', 'Международный женский день'),
  ('2027-03-21', 'Нооруз'),
  ('2027-05-01', 'День труда'),
  ('2027-05-09', 'День Победы');

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

-- Other teachers' groups from А5 (one student each in the seed; the full rosters come with the Excel import, #14)
insert into public.groups (id, name, subject, grade, group_type, teacher_id, start_date, status) values
  ('00000000-0000-4000-b000-000000000005', 'утро',       'Продлёнка',  3,  'afterschool', '00000000-0000-4000-a000-000000000004', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000006', 'математика', 'ОРТ',        11, 'group',       '00000000-0000-4000-a000-000000000002', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000007', 'Бекзат',     'Индивидуально', 10, 'individual', '00000000-0000-4000-a000-000000000003', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000008', '9 класс',    'Химия',      9,  'group',       '00000000-0000-4000-a000-000000000005', '2026-09-01', 'active');

-- Schedule: 8А 09:00, 6 кл 11:00, 8Б 14:00 — ВТ/ЧТ/СБ; 5 кл 15:00 — ПН/СР/ПТ
insert into public.schedule_rules (group_id, weekday, start_time, valid_from)
select g.id, d.weekday, g.t::time, '2026-09-01'
from (values
  ('00000000-0000-4000-b000-000000000001'::uuid, '09:00', array[2, 4, 6]),
  ('00000000-0000-4000-b000-000000000002'::uuid, '11:00', array[2, 4, 6]),
  ('00000000-0000-4000-b000-000000000003'::uuid, '14:00', array[2, 4, 6]),
  ('00000000-0000-4000-b000-000000000004'::uuid, '15:00', array[1, 3, 5]),
  ('00000000-0000-4000-b000-000000000005'::uuid, '08:00', array[1, 2, 3, 4, 5]),
  ('00000000-0000-4000-b000-000000000006'::uuid, '16:00', array[1, 3, 5]),
  ('00000000-0000-4000-b000-000000000007'::uuid, '17:00', array[2, 4]),
  ('00000000-0000-4000-b000-000000000008'::uuid, '16:00', array[2, 4, 6])
) as g (id, t, days)
cross join lateral unnest(g.days) as d (weekday);

-- Students — А5 / А4 / А6 (8А exactly as the artboards; other groups — dev placeholders of the same size as У4)
create temp table seed_students (full_name text primary key, grade integer, parent_name text, parent_phone text, is_returning boolean, notes text);
insert into seed_students values
  ('Айжан Бекова',        8, 'Гульмира Бекова',   '996555111222', true,  null),
  ('Бакыт Токтосунов',    8, 'Нурбек Токтосунов', '996700333444', false, null),
  ('Данияр Кадыров',      8, 'Айнура Кадырова',   '996555777888', false, null),
  ('Элина Сыдыкова',      8, 'Жылдыз Сыдыкова',   '996555123456', false, null),
  ('Камила Орозова',      8, 'Бакыт Орозов',      '996770555666', false, null),
  ('Нурлан Асанов',       8, 'Асан Асанов',       '996555999000', false,
   'Пришёл по рекомендации Тимура Мамбетова — Тимуру скидка 5 % на следующий абонемент. Родитель предпочитает Mbank.'),
  ('Сезим Жумабекова',    8, 'Чолпон Жумабекова', '996555222333', false, null),
  ('Тимур Мамбетов',      8, 'Эркин Мамбетов',    '996555444555', false, null),
  ('Азамат Уулу',         3, 'Айгуль',            '996555010203', false, null),
  ('Алина Токтогулова',  11, 'Динара Токтогулова','996700404505', false, null),
  ('Асель Кубанычбекова',10, 'Мира Кубанычбекова','996555606707', false, null),
  ('Адилет Сапаров',      6, null, '996555310001', false, null),
  ('Айдана Келдибекова',  6, null, '996555310002', false, null),
  ('Бектур Алиев',        6, null, '996555310003', false, null),
  ('Мээрим Турдубаева',   6, null, '996555310004', false, null),
  ('Эрлан Шамшиев',       6, null, '996555310005', false, null),
  ('Асема Ниязова',       6, null, '996555310006', false, null),
  ('Алина Исакова',       8, null, '996555320001', false, null),
  ('Арсен Дуйшеев',       8, null, '996555320002', false, null),
  ('Бегимай Осмонова',    8, null, '996555320003', false, null),
  ('Даниэль Курманов',    8, null, '996555320004', false, null),
  ('Жибек Абдраева',      8, null, '996555320005', false, null),
  ('Нурсултан Бакиров',   8, null, '996555320006', false, null),
  ('Сабина Темирова',     8, null, '996555320007', false, null),
  ('Улан Жээнбеков',      8, null, '996555320008', false, null),
  ('Аделя Мусаева',       5, null, '996555330001', false, null),
  ('Байэл Токтогулов',    5, null, '996555330002', false, null),
  ('Гулина Эсенова',      5, null, '996555330003', false, null),
  ('Илияс Абдыкадыров',   5, null, '996555330004', false, null),
  ('Нурай Жолдошева',     5, null, '996555330005', false, null),
  ('Тилек Орозбаев',      5, null, '996555330006', false, null);

insert into public.students (full_name, grade, parent_name, parent_phone, is_returning, notes)
select full_name, grade, parent_name, parent_phone, is_returning, notes from seed_students;

-- Тимур brought Нурлан (А4: «привёл Тимур М. → 5 % Тимуру»)
update public.students set referred_by_student_id = (select id from public.students where full_name = 'Тимур Мамбетов')
where full_name = 'Нурлан Асанов';

-- Enrollments: (group, student, start date, discount on the subscription — В5)
with roster (group_id, full_name, start_date, discount) as (
  values
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Айжан Бекова',        date '2026-09-15', 15),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Бакыт Токтосунов',    date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Данияр Кадыров',      date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Элина Сыдыкова',      date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Камила Орозова',      date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Нурлан Асанов',       date '2026-10-01', 0),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Сезим Жумабекова',    date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000001'::uuid, 'Тимур Мамбетов',      date '2026-09-01', 5),

    ('00000000-0000-4000-b000-000000000002'::uuid, 'Адилет Сапаров',      date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Айдана Келдибекова',  date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Бектур Алиев',        date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Мээрим Турдубаева',   date '2026-09-08', 0),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Эрлан Шамшиев',       date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000002'::uuid, 'Асема Ниязова',       date '2026-09-15', 0),

    ('00000000-0000-4000-b000-000000000003'::uuid, 'Алина Исакова',       date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Арсен Дуйшеев',       date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Бегимай Осмонова',    date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Даниэль Курманов',    date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Жибек Абдраева',      date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Нурсултан Бакиров',   date '2026-09-10', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Сабина Темирова',     date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000003'::uuid, 'Улан Жээнбеков',      date '2026-09-01', 0),

    ('00000000-0000-4000-b000-000000000004'::uuid, 'Аделя Мусаева',       date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Байэл Токтогулов',    date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Гулина Эсенова',      date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Илияс Абдыкадыров',   date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Нурай Жолдошева',     date '2026-09-21', 0),
    ('00000000-0000-4000-b000-000000000004'::uuid, 'Тилек Орозбаев',      date '2026-09-01', 0),

    ('00000000-0000-4000-b000-000000000005'::uuid, 'Азамат Уулу',         date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000006'::uuid, 'Алина Токтогулова',   date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000007'::uuid, 'Асель Кубанычбекова', date '2026-09-01', 0),
    ('00000000-0000-4000-b000-000000000008'::uuid, 'Камила Орозова',      date '2026-09-01', 0)
),
new_enrollments as (
  insert into public.enrollments (student_id, group_id, start_date)
  select s.id, r.group_id, r.start_date
  from roster r
  join public.students s on s.full_name = r.full_name
  returning id, student_id, group_id
)
-- One subscription per enrollment at the group tariff on its start date (same rule as enroll_student, 0007)
insert into public.subscriptions (enrollment_id, tariff_id, lessons_total, price_full, discount_percent, discount_reason, price_final, started_at)
select
  e.id,
  t.id,
  t.lessons_in_package,
  t.package_price,
  r.discount,
  case r.discount when 15 then 'returning' when 5 then 'referral' else 'none' end::public.discount_reason,
  round(t.package_price * (100 - r.discount) / 100.0)::integer,
  r.start_date
from new_enrollments e
join public.students st on st.id = e.student_id
join roster r on r.full_name = st.full_name and r.group_id = e.group_id
join public.groups g on g.id = e.group_id
cross join lateral (
  select * from public.tariffs t
  where t.group_type = g.group_type and t.valid_from <= r.start_date
  order by t.valid_from desc
  limit 1
) t;

drop table seed_students;
