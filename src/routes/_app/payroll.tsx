import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { MONTH_RE, pickMonth } from '@/features/payroll/model'
import { PayrollPage } from '@/features/payroll/payroll-page'
import { payrollMonth } from '@/features/schedule/model'
import { ForbiddenError } from '@/lib/guards'
import { useNow } from '@/lib/now'
import { hasRole } from '@/lib/roles'
import { bishkekDate } from '@/lib/time'

// ?month=2026-09; without it — the month being paid: until the 15th the previous one (И15).
const searchSchema = z.object({
  month: z.string().regex(MONTH_RE).optional().catch(undefined),
})

// Б1 / БМ1 «Расчёт ЗП»: accountant, and admin read-only (И2).
export const Route = createFileRoute('/_app/payroll')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    const { roles } = context.auth
    if (!hasRole(roles, 'accountant') && !hasRole(roles, 'admin')) throw new ForbiddenError()
  },
  component: PayrollRoute,
})

function PayrollRoute() {
  const { month } = Route.useSearch()
  const today = bishkekDate(useNow())
  return <PayrollPage month={month ? pickMonth(month, today) : payrollMonth(today).month} />
}
