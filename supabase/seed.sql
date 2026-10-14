-- Dev seed. Names and groups match the design canvas (docs/06-design.md): У4/У5/УД3, А3, А8, А9.
-- Auth users and profiles are NOT created here — see scripts/seed-users.ts (R0-3); it links teachers.user_id by phone.
-- Lessons are generated from schedule_rules at the end (generate_lessons, 0008): from the group start to 8 weeks ahead.

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
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('00000000-0000-4000-b000-000000000001', '8 класс А', (select id from public.subjects where name = 'Математика'), 8, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000002', '6 класс',   (select id from public.subjects where name = 'Математика'), 6, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000003', '8 класс Б', (select id from public.subjects where name = 'Математика'), 8, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000004', '5 класс',   (select id from public.subjects where name = 'Математика'), 5, 'group', '00000000-0000-4000-a000-000000000001', '2026-09-01', 'active');

-- Other teachers' groups from А5 (one student each in the seed; the full rosters come with the Excel import, #14)
insert into public.groups (id, name, subject_id, grade, group_type, teacher_id, start_date, status) values
  ('00000000-0000-4000-b000-000000000005', 'утро',       (select id from public.subjects where name = 'Продлёнка'), 3,  'afterschool', '00000000-0000-4000-a000-000000000004', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000006', 'математика', (select id from public.subjects where name = 'ОРТ'), 11, 'group',       '00000000-0000-4000-a000-000000000002', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000007', 'Бекзат',     (select id from public.subjects where name = 'Индивидуально'), 10, 'individual', '00000000-0000-4000-a000-000000000003', '2026-09-01', 'active'),
  ('00000000-0000-4000-b000-000000000008', '9 класс',    (select id from public.subjects where name = 'Химия'), 9,  'group',       '00000000-0000-4000-a000-000000000005', '2026-09-01', 'active');

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

-- Rooms — А4 «каб. 1»
update public.groups set room = '1' where id in ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002');
update public.groups set room = '2' where id in ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-000000000004');

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

-- Lessons: every running group from its start to 8 weeks ahead, holidays skipped (А4 «Занятия», У2 «Сегодня»).
-- September is held below; October's past lessons stay planned (= «не подтверждено»).
select public.ensure_lessons(public.bishkek_today() + 56);

-- September 2026 is held (R1-9: «Мой месяц», Б1 and the payroll reconciliation test have a month to show).
-- Every lesson of every group, everyone present except the marks below. Гульзат: 52 lessons,
-- 324 marks − 6 freezes = 318 student-lessons × 120 сом = 38 160 сом (Б1 / Б2 / БМ1).
-- Written as history with triggers off: confirmed in the evening of the lesson day, not late, so the
-- seed does not look like everything was confirmed at `db reset` time. October stays unconfirmed.
create temp table seed_marks (full_name text, group_id uuid, lesson_date date, status public.attendance_status);
insert into seed_marks values
  ('Данияр Кадыров',     '00000000-0000-4000-b000-000000000001', '2026-09-10', 'absent_frozen'),
  ('Данияр Кадыров',     '00000000-0000-4000-b000-000000000001', '2026-09-12', 'absent_frozen'),
  ('Камила Орозова',     '00000000-0000-4000-b000-000000000001', '2026-09-24', 'absent_burned'),
  ('Эрлан Шамшиев',      '00000000-0000-4000-b000-000000000002', '2026-09-17', 'absent_frozen'),
  ('Бектур Алиев',       '00000000-0000-4000-b000-000000000002', '2026-09-19', 'absent_burned'),
  ('Арсен Дуйшеев',      '00000000-0000-4000-b000-000000000003', '2026-09-03', 'absent_frozen'),
  ('Жибек Абдраева',     '00000000-0000-4000-b000-000000000003', '2026-09-22', 'absent_frozen'),
  ('Жибек Абдраева',     '00000000-0000-4000-b000-000000000003', '2026-09-24', 'absent_frozen');

create temp table seed_september as
select
  l.id as lesson_id,
  l.lesson_date,
  l.planned_start,
  l.duration_min,
  e.id as enrollment_id,
  e.student_id,
  coalesce(m.status, 'present') as status
from public.lessons l
join public.enrollments e
  on e.group_id = l.group_id and e.start_date <= l.lesson_date and (e.end_date is null or e.end_date >= l.lesson_date)
join public.students s on s.id = e.student_id
left join seed_marks m on m.full_name = s.full_name and m.group_id = l.group_id and m.lesson_date = l.lesson_date
where l.lesson_date between '2026-09-01' and '2026-09-30' and l.status = 'planned';

-- Who used up the first subscription in September renewed it (no discount, tariff on that day) —
-- otherwise every September student would start October «в долг».
with consumed as (
  select
    ss.enrollment_id,
    ss.lesson_date,
    row_number() over (partition by ss.enrollment_id order by ss.lesson_date, ss.planned_start) as n
  from seed_september ss
  where ss.status <> 'absent_frozen'
)
insert into public.subscriptions (enrollment_id, tariff_id, lessons_total, price_full, price_final, started_at)
select c.enrollment_id, t.id, t.lessons_in_package, t.package_price, t.package_price, c.lesson_date
from consumed c
join public.subscriptions s on s.enrollment_id = c.enrollment_id
join public.enrollments e on e.id = c.enrollment_id
join public.groups g on g.id = e.group_id
cross join lateral (
  select * from public.tariffs t
  where t.group_type = g.group_type and t.valid_from <= c.lesson_date
  order by t.valid_from desc
  limit 1
) t
where c.n = s.lessons_total + 1;

set session_replication_role = replica;

do $$
declare
  r record;
begin
  -- Lesson by lesson: attendance_subscription() charges the first subscription until it is used up.
  for r in select * from seed_september order by lesson_date, planned_start, student_id loop
    insert into public.attendance (lesson_id, student_id, subscription_id, status, marked_at)
    values (
      r.lesson_id,
      r.student_id,
      public.attendance_subscription(r.lesson_id, r.student_id),
      r.status,
      ((r.lesson_date + r.planned_start) at time zone 'Asia/Bishkek') + make_interval(mins => r.duration_min)
    );
  end loop;
end;
$$;

update public.lessons l
set
  status = 'held',
  confirmed_at = ((l.lesson_date + l.planned_start) at time zone 'Asia/Bishkek')
    + make_interval(mins => l.duration_min + 2 + (extract(day from l.lesson_date)::integer % 9)),
  confirmed_late = false
where l.lesson_date between '2026-09-01' and '2026-09-30' and l.status = 'planned';

set session_replication_role = origin;

drop table seed_september;
drop table seed_marks;

-- Payments — А7 / А6 / А5 (#47). Every subscription is paid in full on its start day, cash and Mbank in
-- turn, except: Нурлан Асанов paid half (1 600 of 3 200 → 6 lessons, А6), Сезим Жумабекова paid half of
-- the renewal, Азамат Уулу has not paid the renewal (2 lessons «в долг», 740 сом), Асема Ниязова left
-- 6 класс — refund of the 5 remaining lessons (В8), the subscription refunded; the enrollment is finished
-- explicitly (a refund alone does not finish it, И42).
-- Written as history with triggers off (no admin to be created_by; created_at = paid_at).
set session_replication_role = replica;

create temp table seed_subs as
select
  s.id, s.started_at, s.price_final, st.full_name, e.group_id, e.id as enrollment_id,
  row_number() over (partition by e.id order by s.started_at, s.created_at) as n,
  row_number() over (order by s.started_at, st.full_name, e.group_id) as k
from public.subscriptions s
join public.enrollments e on e.id = s.enrollment_id
join public.students st on st.id = e.student_id;

insert into public.payments (subscription_id, amount, method, paid_at, kind, reason, created_at)
select
  ss.id,
  case
    when ss.full_name in ('Нурлан Асанов', 'Сезим Жумабекова') and (ss.full_name = 'Нурлан Асанов' or ss.n = 2)
      then ss.price_final / 2
    else ss.price_final
  end,
  (case when ss.k % 2 = 0 then 'cash' else 'mbank' end)::public.payment_method,
  (ss.started_at + time '12:00' + make_interval(mins => (ss.k * 37 % 300)::integer)) at time zone 'Asia/Bishkek',
  'payment',
  case when ss.full_name = 'Нурлан Асанов' then 'половина абонемента, доплата через неделю' end,
  (ss.started_at + time '12:00' + make_interval(mins => (ss.k * 37 % 300)::integer)) at time zone 'Asia/Bishkek'
from seed_subs ss
where not (ss.full_name = 'Азамат Уулу' and ss.n = 2);

insert into public.payments (subscription_id, amount, method, paid_at, kind, reason, created_at)
select ss.id, -1333, 'cash', timestamptz '2026-10-02 16:00+06', 'refund', 'Переезд, ушла из центра',
       timestamptz '2026-10-02 16:00+06'
from seed_subs ss
where ss.full_name = 'Асема Ниязова';

update public.subscriptions s set status = 'refunded'
from seed_subs ss where ss.id = s.id and ss.full_name = 'Асема Ниязова';
update public.enrollments e set status = 'finished', end_date = '2026-09-30'
from seed_subs ss where ss.enrollment_id = e.id and ss.full_name = 'Асема Ниязова';

drop table seed_subs;

set session_replication_role = origin;

-- Trials — А11 / У2 / УД2 / А1 / А4 (names from the artboards). Dates follow bishkek_today(): Розаина on
-- Гульзат's next lesson (today if she teaches today), Адема and Амина from tomorrow on; Бермет was on a
-- past lesson and waits for the decision, Бакай did not come — «Позвонить» (Ж8). Written with triggers
-- off (trials_guard books only today or later; the seed has no admin to be created_by).
set session_replication_role = replica;

insert into public.trials (full_name, grade, parent_phone, group_id, lesson_id, status, came, source, note, created_at, marked_at)
select t.full_name, t.grade, t.phone, l.group_id, l.id, t.status::public.trial_status, t.came,
       t.source::public.trial_source, t.note, now() - interval '5 days',
       case when t.came is not null then ((l.lesson_date + l.planned_start) at time zone 'Asia/Bishkek') + interval '1 hour' end
from (values
  ('Розаина Бекова',     8,  '996995857758', 'scheduled', null::boolean, 'instagram', null,                    array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-000000000004']::uuid[], 0, false),
  ('Адема Кадырова',     8,  '996707998406', 'scheduled', null,          'referral',  'подруга Айжан Б.',      array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000003']::uuid[], 1, false),
  ('Амина Садыкова',     9,  '996504210313', 'scheduled', null,          '2gis',      null,                    array['00000000-0000-4000-b000-000000000008']::uuid[], 1, false),
  ('Бермет Токтогулова', 8,  '996555404404', 'attended',  true,          'instagram', null,                    array['00000000-0000-4000-b000-000000000001']::uuid[], -1, true),
  ('Бакай Осмонов',      11, '996555303303', 'no_show',   false,         'other',     null,                    array['00000000-0000-4000-b000-000000000006']::uuid[], -1, true)
) as t (full_name, grade, phone, status, came, source, note, groups, from_day, past)
cross join lateral (
  select l.* from public.lessons l
  where l.group_id = any (t.groups) and l.status <> 'cancelled'
    and case when t.past then l.lesson_date < public.bishkek_today()
             else l.lesson_date >= public.bishkek_today() + t.from_day and l.status = 'planned' end
  order by
    case when t.past then l.lesson_date end desc,
    case when not t.past then l.lesson_date end,
    l.planned_start
  limit 1
) l;

set session_replication_role = origin;

-- After-school plans (#82): the prod migration (0023) gives every current after-school student the
-- default plan — group weekdays × 3 h from the enrollment start; the seed mirrors it (triggers off, no
-- journal rows). Their September marks stay on the 20-lesson packages — payroll sums do not move.
set session_replication_role = replica;
select public.afterschool_backfill_plans();
set session_replication_role = origin;
