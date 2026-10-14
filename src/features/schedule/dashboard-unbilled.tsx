// #82 · «Требует внимания»: after-school months with marks and no invoice (И69). The teacher is paid
// for them already; the student owes them until the admin issues the invoice on А6.
import { queryOptions, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'
import { formatHours, monthAccusative } from '@/features/afterschool/model'
import { BALANCES_KEY, UNBILLED_KEY } from '@/features/payments/api'
import { shortName } from '@/features/students/model'
import { supabase } from '@/lib/supabase/client'

const rowSchema = z.object({
  enrollment_id: z.uuid(),
  student_id: z.uuid(),
  month: z.string(),
  hours: z.number(),
  active: z.boolean(),
  student: z.object({ full_name: z.string() }),
})

export interface UnbilledItem {
  enrollmentId: string
  studentId: string
  studentName: string
  month: string
  hours: number
  /** The enrollment is finished — «Ушёл» could not bill the month: its marks are in a closed period. */
  closed: boolean
}

/**
 * Every month not invoiced while its debt is there: an active enrollment — «Выставить счёт»; a finished
 * one is left only by a closed period («Ушёл» bills the rest, И69) — open the period or write the debt off.
 */
const dashboardUnbilledQuery = () =>
  queryOptions({
    queryKey: [BALANCES_KEY, UNBILLED_KEY, 'dashboard'],
    queryFn: async (): Promise<UnbilledItem[]> => {
      const { data, error } = await supabase
        .from('v_afterschool_unbilled')
        .select(
          'enrollment_id, student_id, month, hours, active, student:students!inner(full_name)',
        )
        .gt('amount', 0)
        .order('month')
      if (error) throw error
      return z
        .array(rowSchema)
        .parse(data)
        .map((r) => ({
          enrollmentId: r.enrollment_id,
          studentId: r.student_id,
          studentName: r.student.full_name,
          month: r.month,
          hours: r.hours,
          closed: !r.active,
        }))
    },
  })

export const useUnbilled = () => useQuery(dashboardUnbilledQuery())

/**
 * «Продлёнка: не выставлен счёт за ноябрь — Айжан Б., 21 ч»; a finished enrollment — «… · закрытый
 * период — откройте период или спишите долг».
 */
export const unbilledLine = (
  u: Pick<UnbilledItem, 'month' | 'studentName' | 'hours'> & { closed?: boolean },
) =>
  `Продлёнка: не выставлен счёт за ${monthAccusative(u.month)} — ${shortName(u.studentName)}, ${formatHours(u.hours)} ч` +
  (u.closed ? ' · закрытый период — откройте период или спишите долг' : '')

/** Items of the «Требует внимания» list — each opens the student (А6, «Выставить счёт»). */
export function UnbilledItems({ items }: { items: readonly UnbilledItem[] }) {
  return items.map((u) => (
    <li key={`${u.enrollmentId}:${u.month}`}>
      <Link
        to="/admin/students/$studentId"
        params={{ studentId: u.studentId }}
        className="flex min-h-11 items-center gap-2.5 rounded-[14px] bg-warn-soft px-3.5 py-2.5 text-warn-strong"
      >
        <span className="flex-1 text-[13px] font-bold">{unbilledLine(u)}</span>
        <span className="text-[13px] font-extrabold" aria-hidden>
          →
        </span>
      </Link>
    </li>
  ))
}

/** А1 aside: shown only while some month is not invoiced. */
export function UnbilledWidget({ items }: { items: readonly UnbilledItem[] }) {
  if (items.length === 0) return null
  return (
    <section
      aria-label="Не выставлены счета продлёнки"
      className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-card px-5 py-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-extrabold">Продлёнка: не выставлен счёт</h2>
        <span className="rounded-full bg-warn-soft px-[9px] py-[3px] text-xs font-extrabold whitespace-nowrap text-warn-strong">
          {items.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((u) => (
          <li
            key={`${u.enrollmentId}:${u.month}`}
            className="flex justify-between gap-2.5 text-[13px] font-bold"
          >
            <span>{unbilledLine(u)}</span>
            <Link
              to="/admin/students/$studentId"
              params={{ studentId: u.studentId }}
              className="font-extrabold whitespace-nowrap text-teal"
            >
              Открыть
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
