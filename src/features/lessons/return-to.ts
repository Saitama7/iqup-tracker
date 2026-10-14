// Where a lesson sheet returns after «Провести / Подтвердить» and «назад» (#72, #76). The source
// list comes in the URL (/lessons/…?from=my-month&month=2026-09&group=… or ?from=group&group=…),
// so it survives a reload; no source — «Сегодня», as before. Only these sources are accepted.
import { z } from 'zod'
import { MONTH_RE } from '@/features/payroll/model'

export const lessonSearchSchema = z.object({
  from: z.enum(['my-month', 'group']).optional().catch(undefined),
  month: z.string().regex(MONTH_RE).optional().catch(undefined),
  group: z.uuid().optional().catch(undefined),
})

export type LessonSearch = z.infer<typeof lessonSearchSchema>

/** Validated search of the current location; anything unknown or malformed is dropped. */
export function parseLessonSearch(raw: unknown): LessonSearch {
  const parsed = lessonSearchSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

/** Anchor of the next unconfirmed lesson of «Мой месяц» — the return scrolls to it. */
export const NEXT_UNCONFIRMED_ID = 'unconfirmed'

export type LessonReturn =
  | {
      to: '/my-month'
      search: { month: string | undefined; group: string | undefined }
      hash: typeof NEXT_UNCONFIRMED_ID
    }
  | { to: '/groups/$groupId'; params: { groupId: string } }
  | { to: '/today' }

/** The list a lesson sheet goes back to after the confirm: «Мой месяц», the group, or «Сегодня». */
export function lessonReturn(search: LessonSearch): LessonReturn {
  if (search.from === 'my-month') {
    return {
      to: '/my-month',
      search: { month: search.month, group: search.group },
      hash: NEXT_UNCONFIRMED_ID,
    }
  }
  if (search.from === 'group' && search.group) {
    return { to: '/groups/$groupId', params: { groupId: search.group } }
  }
  return { to: '/today' }
}

/** Search of a lesson link from «Мой месяц». */
export function fromMyMonth(month: string, group: string | undefined): LessonSearch {
  return { from: 'my-month', month, group }
}

/** Search of a lesson link from the teacher's group page (#76). */
export function fromGroup(groupId: string): LessonSearch {
  return { from: 'group', group: groupId }
}
