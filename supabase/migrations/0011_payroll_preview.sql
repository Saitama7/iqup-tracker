-- 0011 — v_payroll_preview (issue #13, R1-9): a teacher's accrual per calendar month, before the period
-- is closed. Docs: 01-domain-model.md §6, 05-decisions А1–А3, А6–А7, Ж2, И18.
--
-- Same rules as calcMonth() in src/features/payroll/calc.ts — change both together;
-- tests/integration/payroll.test.ts compares them teacher by teacher on the seed:
--   • only held lessons (planned and cancelled never pay, А6), extra lessons included;
--   • the teacher is groups.teacher_id, never substitute_teacher_id (А7);
--   • a student-lesson = attendance.consumes_credit (present + absent_burned, А1.3); trials have no
--     attendance rows, so they never count (Ж2);
--   • per student-lesson: package_price / lessons_in_package × percent / 100 — the group's tariff and
--     the teacher's percent on the lesson date (valid_from), full price, discounts ignored (А1.1);
--   • rounded to whole som once per teacher and month, not per lesson;
--   • hours = duration_min / 60 (1 h a lesson, 3 h an after-school day, А3).
-- security_invoker: the caller's RLS on lessons / groups / attendance applies — a teacher sees only
-- the rows of her own groups, admin and accountant see everyone.

create view public.v_payroll_preview
with (security_invoker = true)
as
with held as (
  select
    g.teacher_id,
    date_trunc('month', l.lesson_date)::date as month,
    l.lesson_date,
    l.duration_min,
    g.group_type,
    (
      select count(*) from public.attendance a
      where a.lesson_id = l.id and a.consumes_credit
    )::integer as student_lessons
  from public.lessons l
  join public.groups g on g.id = l.group_id
  where l.status = 'held'
)
select
  h.teacher_id,
  h.month,
  count(*)::integer as lessons_held,
  round(sum(h.duration_min) / 60.0, 2) as hours,
  sum(h.student_lessons)::integer as student_lessons,
  round(coalesce(sum(
    h.student_lessons * t.package_price * r.percent / (t.lessons_in_package * 100.0)
  ), 0))::integer as base_amount
from held h
left join lateral (
  select t.package_price, t.lessons_in_package
  from public.tariffs t
  where t.group_type = h.group_type and t.valid_from <= h.lesson_date
  order by t.valid_from desc
  limit 1
) t on true
left join lateral (
  select r.percent
  from public.teacher_rates r
  where r.teacher_id = h.teacher_id and r.valid_from <= h.lesson_date
  order by r.valid_from desc
  limit 1
) r on true
group by h.teacher_id, h.month;

comment on view public.v_payroll_preview is
  'Preliminary payroll per teacher and month (R1-9). Same rules as src/features/payroll/calc.ts.';

revoke all on public.v_payroll_preview from anon;
