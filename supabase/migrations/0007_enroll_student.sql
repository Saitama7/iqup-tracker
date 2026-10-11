-- 0007 — зачисление ученика в группу с абонементом (issue #8, А4 / А6).
-- enroll_student(): enrollment + first subscription in one transaction. The price is fixed on the
-- start date by the group's tariff (05-decisions В6), discounts follow В5:
--   15 % returning — only the student's first subscription (students.is_returning);
--    5 % referral  — the student who brought a friend, one subscription per friend brought.
-- price_final = round(price_full × (100 − discount) / 100); payroll ignores discounts (А1.1).
-- Old rows are never edited here: a new enrollment is a new row (И8 «старое не редактируется»).

create function public.enroll_student(
  p_student_id uuid,
  p_group_id uuid,
  p_start_date date,
  p_discount_pct integer default 0,
  p_discount_reason public.discount_reason default 'none'
)
returns table (enrollment_id uuid, subscription_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_group public.groups%rowtype;
  v_tariff public.tariffs%rowtype;
  v_enrollment_id uuid;
  v_subscription_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only an admin may enroll students' using errcode = 'insufficient_privilege';
  end if;

  if p_start_date is null then
    raise exception 'start date is required' using errcode = 'check_violation';
  end if;

  if not (
    (p_discount_pct = 0 and p_discount_reason = 'none')
    or (p_discount_pct = 15 and p_discount_reason = 'returning')
    or (p_discount_pct = 5 and p_discount_reason = 'referral')
  ) then
    raise exception 'discount must be 0, 5 %% referral or 15 %% returning'
      using errcode = 'check_violation';
  end if;

  -- Serialize concurrent enrollments of one student (discount eligibility below).
  select * into v_student from public.students s where s.id = p_student_id for update;
  if not found then
    raise exception 'student % not found', p_student_id using errcode = 'foreign_key_violation';
  end if;

  select * into v_group from public.groups g where g.id = p_group_id;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'foreign_key_violation';
  end if;
  if v_group.status = 'archived' then
    raise exception 'group % is archived', p_group_id using errcode = 'check_violation';
  end if;
  if p_start_date < v_group.start_date
     or (v_group.end_date is not null and p_start_date > v_group.end_date) then
    raise exception 'start date is outside the group dates' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.group_id = p_group_id and e.status = 'active'
  ) then
    raise exception 'student is already enrolled in this group' using errcode = 'unique_violation';
  end if;

  if p_discount_reason = 'returning' and (
    not v_student.is_returning
    or exists (
      select 1 from public.subscriptions s
      join public.enrollments e on e.id = s.enrollment_id
      where e.student_id = p_student_id
    )
  ) then
    raise exception '15 %% applies only to the first subscription of a returning student'
      using errcode = 'check_violation';
  end if;

  if p_discount_reason = 'referral' and (
    select count(*) from public.students f where f.referred_by_student_id = p_student_id
  ) <= (
    select count(*) from public.subscriptions s
    join public.enrollments e on e.id = s.enrollment_id
    where e.student_id = p_student_id and s.discount_reason = 'referral'
  ) then
    raise exception '5 %% applies once per friend brought' using errcode = 'check_violation';
  end if;

  -- Tariff in effect on the start date — same rule as tariffFor() in src/features/tariffs/current.ts.
  select * into v_tariff from public.tariffs t
  where t.group_type = v_group.group_type and t.valid_from <= p_start_date
  order by t.valid_from desc
  limit 1;
  if not found then
    raise exception 'no tariff for % on %', v_group.group_type, p_start_date
      using errcode = 'check_violation';
  end if;

  insert into public.enrollments (student_id, group_id, start_date)
  values (p_student_id, p_group_id, p_start_date)
  returning id into v_enrollment_id;

  insert into public.subscriptions (
    enrollment_id, tariff_id, lessons_total, price_full,
    discount_percent, discount_reason, price_final, started_at
  )
  values (
    v_enrollment_id, v_tariff.id, v_tariff.lessons_in_package, v_tariff.package_price,
    p_discount_pct, p_discount_reason,
    round(v_tariff.package_price * (100 - p_discount_pct) / 100.0)::integer,
    p_start_date
  )
  returning id into v_subscription_id;

  return query select v_enrollment_id, v_subscription_id;
end;
$$;

revoke execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason)
from public, anon;
grant execute on function public.enroll_student(uuid, uuid, date, integer, public.discount_reason)
to authenticated;
