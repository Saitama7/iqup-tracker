// Where a lesson sheet returns after «Провести / Подтвердить» and «назад» (#72). The source list
// comes in the URL (/lessons/…?from=my-month&month=2026-09&group=…), so it survives a reload;
// no source — «Сегодня», as before.
import { z } from 'zod'
import { MONTH_RE } from '@/features/payroll/model'

export const lessonSearchSchema = z.object({
  from: z.enum(['my-month']).optional().catch(undefined),
  month: z.string().regex(MONTH_RE).optional().catch(undefined),
  group: z.uuid().optional().catch(undefined),
})

export type LessonSearch = z.infer<typeof lessonSearchSchema>

/** «Мой месяц» with the same month and group filter; null — no source list. */
export function myMonthReturn(
  search: LessonSearch,
): { month: string | undefined; group: string | undefined } | null {
  if (search.from !== 'my-month') return null
  return { month: search.month, group: search.group }
}

/** Search of a lesson link from «Мой месяц». */
export function fromMyMonth(month: string, group: string | undefined): LessonSearch {
  return { from: 'my-month', month, group }
}

/** Anchor of the first unconfirmed lesson of the list — the return scrolls to it. */
export const NEXT_UNCONFIRMED_ID = 'unconfirmed'
