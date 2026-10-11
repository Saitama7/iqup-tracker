import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { MyMonthPage } from '@/features/payroll/my-month-page'
import { MONTH_RE, pickMonth } from '@/features/payroll/model'
import { requireRole } from '@/lib/guards'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'

// The month lives in the URL (?month=2026-09), so «← Сентябрь» survives reload; no month — current.
const searchSchema = z.object({
  month: z.string().regex(MONTH_RE).optional().catch(undefined),
})

// У6 / УД4 «Мой месяц». Admin+teacher (Каныкей) gets here via «Как учитель».
export const Route = createFileRoute('/_app/my-month')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: MyMonthRoute,
})

function MyMonthRoute() {
  const { month } = Route.useSearch()
  return <MyMonthPage month={pickMonth(month, bishkekDate(useNow()))} />
}
