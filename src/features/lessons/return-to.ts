// Where a lesson sheet returns after «Провести / Подтвердить», «Исправить отметки» and «назад»
// (#72, #76, #89). Every link to the sheet names its source in the URL (/lessons/…?from=admin-group
// &group=…&tab=lessons, ?from=schedule&date=…, ?from=my-month&month=2026-09&group=…), so it survives
// a reload; no source — «Сегодня» / the dashboard. Only these sources and well-formed params pass.
import { z } from 'zod'
import { MONTH_RE } from '@/features/payroll/model'

export const LESSON_SOURCES = [
  'my-month',
  'group',
  'admin-group',
  'schedule',
  'dashboard',
  'today',
] as const

export type LessonSource = (typeof LESSON_SOURCES)[number]

/** Tab of a group page (А4 / У5), kept in its URL (#89). */
export const GROUP_TABS = ['students', 'lessons'] as const
export type GroupTab = (typeof GROUP_TABS)[number]

export const lessonSearchSchema = z.object({
  from: z.enum(LESSON_SOURCES).optional().catch(undefined),
  month: z.string().regex(MONTH_RE).optional().catch(undefined),
  group: z.uuid().optional().catch(undefined),
  tab: z.enum(GROUP_TABS).optional().catch(undefined),
  date: z.iso.date().optional().catch(undefined),
  teacher: z.uuid().optional().catch(undefined),
  filter: z.enum(['unconfirmed']).optional().catch(undefined),
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
  | { to: '/groups/$groupId'; params: { groupId: string }; search: { tab: GroupTab | undefined } }
  | {
      to: '/admin/groups/$groupId'
      params: { groupId: string }
      search: { tab: GroupTab | undefined }
    }
  | {
      to: '/admin/schedule'
      search: {
        date: string | undefined
        teacher: string | undefined
        filter: 'unconfirmed' | undefined
      }
    }
  | { to: '/admin' }
  | { to: '/today' }

/**
 * The screen a lesson sheet came from, with its tab / month / filters; null — no (valid) source,
 * the caller picks the view's home.
 */
export function lessonSource(search: LessonSearch): LessonReturn | null {
  switch (search.from) {
    case 'my-month':
      return {
        to: '/my-month',
        search: { month: search.month, group: search.group },
        hash: NEXT_UNCONFIRMED_ID,
      }
    case 'group':
      return search.group
        ? { to: '/groups/$groupId', params: { groupId: search.group }, search: { tab: search.tab } }
        : null
    case 'admin-group':
      return search.group
        ? {
            to: '/admin/groups/$groupId',
            params: { groupId: search.group },
            search: { tab: search.tab },
          }
        : null
    case 'schedule':
      return {
        to: '/admin/schedule',
        search: { date: search.date, teacher: search.teacher, filter: search.filter },
      }
    case 'dashboard':
      return { to: '/admin' }
    case 'today':
      return { to: '/today' }
    default:
      return null
  }
}

/** The list a lesson sheet goes back to after the confirm: its source, else «Сегодня». */
export function lessonReturn(search: LessonSearch): LessonReturn {
  return lessonSource(search) ?? { to: '/today' }
}

/** Name of the source under the back chevron: «‹ Группа», «‹ Расписание». */
export const SOURCE_LABEL: Record<LessonSource, string> = {
  'my-month': 'Мой месяц',
  group: 'Группа',
  'admin-group': 'Группа',
  schedule: 'Расписание',
  dashboard: 'Сегодня',
  today: 'Сегодня',
}

/** Search of a lesson link from «Мой месяц». */
export function fromMyMonth(month: string, group: string | undefined): LessonSearch {
  return { from: 'my-month', month, group }
}

/** Search of a lesson link from the teacher's group page and its tab (#76, #89). */
export function fromGroup(groupId: string, tab?: GroupTab): LessonSearch {
  return { from: 'group', group: groupId, tab }
}

/** Search of a lesson link from the admin's group page А4 and its tab (#89). */
export function fromAdminGroup(groupId: string, tab?: GroupTab): LessonSearch {
  return { from: 'admin-group', group: groupId, tab }
}

/** Search of a lesson link from А2 «Расписание» with its week, teacher and filter (#89). */
export function fromSchedule(s: {
  date?: string
  teacher?: string
  filter?: 'unconfirmed'
}): LessonSearch {
  return { from: 'schedule', date: s.date, teacher: s.teacher, filter: s.filter }
}

export const FROM_DASHBOARD: LessonSearch = { from: 'dashboard' }
export const FROM_TODAY: LessonSearch = { from: 'today' }
