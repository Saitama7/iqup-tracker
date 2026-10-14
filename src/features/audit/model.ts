// А10 view model: filters in the URL, the period's start, entries grouped by Bishkek day.
// Pure functions of (data, now) — no fetching, no clock.
import { addDays } from '@/features/groups/model'
import { nameKey } from '@/features/trials/model'
import { bishkekDate, formatDayMonth } from '@/lib/time'
import { bishkekDay, type AuditEntry, type AuditKind } from './describe'

export const PAGE_SIZE = 50

export const KINDS: readonly AuditKind[] = ['retro', 'late', 'payment', 'attendance', 'other']

export type Period = 'today' | '7d' | '30d' | 'all'
export const PERIODS: readonly Period[] = ['today', '7d', '30d', 'all']
export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Сегодня',
  '7d': '7 дней',
  '30d': '30 дней',
  all: 'Всё время',
}

/** «Все пользователи ▾»: a profile id, or rows without an author (service role, migrations). */
export const SYSTEM_ACTOR = 'system'

export interface AuditFilters {
  kind: AuditKind | null
  entity: string | null
  actor: string | null
  /** Start of the period, `timestamptz` ISO; null — all time. */
  since: string | null
  /** «Ученик, группа, учитель…» as `searchKey` made it; null — no search. */
  q: string | null
}

/**
 * The search box as v_audit_feed.search is stored (person_name_key in 0018 = nameKey): spaces
 * collapsed, lower case, ё = е. `*` is a wildcard in PostgREST's like — dropped. Empty → null.
 */
export function searchKey(text: string | null | undefined): string | null {
  const key = nameKey((text ?? '').replaceAll('*', ' '))
  return key === '' ? null : key
}

/** `like` pattern for a searchKey: the key anywhere, its own `%` / `_` / `\` taken literally. */
export const likePattern = (key: string) => `%${key.replace(/[\\%_]/g, '\\$&')}%`

/** Bishkek midnight the period starts at: «7 дней» — today and the 6 days before. */
export function periodStart(period: Period, nowMs: number): string | null {
  const days = { today: 0, '7d': 6, '30d': 29, all: null }[period]
  if (days === null) return null
  return `${addDays(bishkekDate(nowMs), -days)}T00:00:00+06:00`
}

/** «Сегодня, 8 октября», «Вчера, 7 октября», «6 октября». */
export function dayTitle(day: string, today: string): string {
  const date = formatDayMonth(day)
  if (day === today) return `Сегодня, ${date}`
  if (day === addDays(today, -1)) return `Вчера, ${date}`
  return day.slice(0, 4) === today.slice(0, 4) ? date : `${date} ${day.slice(0, 4)}`
}

export interface AuditDay {
  day: string
  title: string
  entries: AuditEntry[]
}

/** Entries (newest first) split into Bishkek days, order kept. */
export function groupByDay(entries: readonly AuditEntry[], nowMs: number): AuditDay[] {
  const today = bishkekDate(nowMs)
  const days: AuditDay[] = []
  for (const entry of entries) {
    const day = bishkekDay(entry.at)
    const last = days.at(-1)
    if (last?.day === day) last.entries.push(entry)
    else days.push({ day, title: dayTitle(day, today), entries: [entry] })
  }
  return days
}
