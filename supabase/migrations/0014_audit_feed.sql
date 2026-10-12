-- #45 · А10 «Журнал изменений» (/admin/audit).
-- 1. audit_log triggers on subjects (review of #42/#49: «Предмет: Математика → Математика (углубл.)»,
--    «Предмет скрыт/показан») and on tariffs (the issue's «Тариф group: 3 000 → 3 200 с 01.11»).
-- 2. v_audit_feed — the journal as the screen reads it: audit_log rows with a kind for the filter
--    chips, and the marks of a confirmed lesson folded into the lesson's row (one line per «Провести»,
--    as on the artboard). Nothing is removed from audit_log; the folded rows stay in the table.
-- RLS stays as in 0001: audit_log is read by admin and accountant only, a teacher sees nothing (И: no
-- teacher journal in R1); written only by write_audit_log().

-- ─── 1. triggers ────────────────────────────────────────────────────────────

create trigger audit_log after insert or update or delete on public.subjects
for each row execute function public.write_audit_log();
create trigger audit_log after insert or update or delete on public.tariffs
for each row execute function public.write_audit_log();

-- «Все пользователи ▾» narrows the feed to one author.
create index on public.audit_log (actor_id, at desc);

-- ─── 2. v_audit_feed ────────────────────────────────────────────────────────

-- kind:
--   late       — a lesson confirmed not on its day (planned → held with confirmed_late, Б2);
--   retro      — a correction after the fact: a mark changed outside «Провести» (teachers change marks
--                only through confirm_lesson, so any other write is an admin's edit), a held lesson
--                cancelled or deleted, a teacher's rate fixed or removed from a day already started (И3);
--   payment    — subscriptions (a paid package, its refund) and payments once they exist (R2);
--   attendance — a lesson confirmed on its day;
--   other      — everything else (lessons planned / cancelled / rescheduled, enrollments, tariffs, subjects).
-- marks: statuses written by the same confirm_lesson call (same transaction → same `at`), for «был 7,
-- заморозка 1» on the lesson's row.
create view public.v_audit_feed
with (security_invoker = true)
as
select
  a.id,
  a.actor_id,
  a.entity,
  a.entity_id,
  a.action,
  a.before,
  a.after,
  a.reason,
  a.at,
  case
    when a.entity = 'lessons' and a.action = 'update'
         and a.before ->> 'status' = 'planned' and a.after ->> 'status' = 'held'
         and coalesce((a.after ->> 'confirmed_late')::boolean, false)
      then 'late'
    when a.entity = 'attendance'
      or (a.entity = 'lessons' and a.before ->> 'status' = 'held'
          and (a.action = 'delete' or a.after ->> 'status' <> 'held'))
      or (a.entity = 'teacher_rates' and a.action <> 'insert'
          and (a.before ->> 'valid_from')::date <= (a.at at time zone 'Asia/Bishkek')::date)
      then 'retro'
    when a.entity in ('subscriptions', 'payments')
      then 'payment'
    when a.entity = 'lessons' and a.action = 'update'
         and a.before ->> 'status' = 'planned' and a.after ->> 'status' = 'held'
      then 'attendance'
    else 'other'
  end as kind,
  case
    when a.entity = 'lessons' and a.reason = 'confirm_lesson' then (
      select coalesce(jsonb_agg(m.after ->> 'status' order by m.after ->> 'status'), '[]'::jsonb)
      from public.audit_log m
      where m.entity = 'attendance'
        and m.reason = 'confirm_lesson'
        and m.at = a.at
        and m.after ->> 'lesson_id' = a.entity_id::text
    )
  end as marks
from public.audit_log a
where not (a.entity = 'attendance' and a.reason is not distinct from 'confirm_lesson');

comment on view public.v_audit_feed is
  'А10 journal: audit_log + kind (late/retro/payment/attendance/other); confirm_lesson marks folded into the lesson row.';

-- Read-only: the journal is written by the trigger only (the view is auto-updatable otherwise).
revoke all on public.v_audit_feed from anon, authenticated;
grant select on public.v_audit_feed to authenticated;
