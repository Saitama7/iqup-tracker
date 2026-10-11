-- 0005 — teacher_rates: admin writes again (PR #21 review, issue #6).
-- A typo in the current percent is fixed in place — a new row from tomorrow would pay today's
-- lessons at the wrong percent. History is kept by audit_log (0001). Locking rows whose
-- valid_from falls into a closed period comes with period closing (R3).

drop policy teacher_rates_admin_insert on public.teacher_rates;
create policy teacher_rates_admin_write on public.teacher_rates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
