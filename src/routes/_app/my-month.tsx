import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { MyMonthPage } from '@/features/payroll/my-month-page'
import { MONTH_RE, pickMonth } from '@/features/payroll/model'
import { requireRole } from '@/lib/guards'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'

// The month and the group filter live in the URL (?month=2026-09&group=…), so «← Сентябрь» and the
// filter survive reload and the return from a lesson (#72); no month — current, no group — all.
const searchSchema = z.object({
  month: z.string().regex(MONTH_RE).optional().catch(undefined),
  group: z.uuid().optional().catch(undefined),
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
  const { month, group } = Route.useSearch()
  return <MyMonthPage month={pickMonth(month, bishkekDate(useNow()))} group={group} />
}
