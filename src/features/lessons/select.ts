// «Сегодня» (У2 / УД1): which lesson is current, deck order, countdowns.
// Pure functions of (lessons, now) — docs/02-architecture.md §7 and §7.1; the clock is useNow().
import type { Database } from '@/lib/supabase/types.gen'

export type LessonStatus = Database['public']['Enums']['lesson_status']

/** The fields every function here needs; api rows carry more. */
export interface LessonTiming {
  id: string
  lesson_date: string // YYYY-MM-DD, Bishkek calendar date
  planned_start: string // HH:MM or HH:MM:SS, Bishkek wall clock
  duration_min: number
  status: LessonStatus
}

export type LessonState = 'upcoming' | 'current' | 'ended_unconfirmed' | 'held' | 'cancelled'

const MIN = 60_000
/** Window of «current» on the deck: from 15 min before start to 30 min after the end (§7). */
export const BEFORE_START_MS = 15 * MIN
export const AFTER_END_MS = 30 * MIN

/** Start instant; Bishkek is UTC+6 with no DST (invariant 8). */
export function lessonStartMs(l: Pick<LessonTiming, 'lesson_date' | 'planned_start'>): number {
  return Date.parse(`${l.lesson_date}T${l.planned_start.slice(0, 5)}:00+06:00`)
}

export function lessonEndMs(
  l: Pick<LessonTiming, 'lesson_date' | 'planned_start' | 'duration_min'>,
): number {
  return lessonStartMs(l) + l.duration_min * MIN
}

/**
 * Status of a lesson at `now`. A planned lesson is «Сейчас» from 15 min before start until its end;
 * after the end it is «Не подтверждено» (§7.1: now > planned_end && status = planned).
 */
export function lessonState(l: LessonTiming, now: number): LessonState {
  if (l.status === 'cancelled') return 'cancelled'
  if (l.status === 'held') return 'held'
  if (now < lessonStartMs(l) - BEFORE_START_MS) return 'upcoming'
  if (now < lessonEndMs(l)) return 'current'
  return 'ended_unconfirmed'
}

export interface ConfirmCopy {
  /** The button. */
  action: string
  /** Not every student is marked yet. */
  hint: string
  /** While the database answers. */
  busy: string
  /** Success toast, «· HH:MM» is appended. */
  done: string
  /** Error toast, «: <reason>» is appended. */
  failed: string
}

/**
 * Words of the sheet's action (#41): a lesson that is over (an earlier day or past its end) is
 * confirmed after the fact — «Подтвердить занятие»; a current one is held — «Провести занятие».
 */
export function confirmCopy(state: LessonState): ConfirmCopy {
  return state === 'ended_unconfirmed'
    ? {
        action: 'Подтвердить занятие',
        hint: 'Отметьте всех, чтобы подтвердить',
        busy: 'Подтверждаем…',
        done: 'Занятие подтверждено',
        failed: 'Не удалось подтвердить занятие',
      }
    : {
        action: 'Провести занятие',
        hint: 'Отметьте всех, чтобы провести',
        busy: 'Проводим…',
        done: 'Занятие проведено',
        failed: 'Не удалось провести занятие',
      }
}

/** Planned lesson inside the deck's «current» window: start − 15 min ≤ now ≤ end + 30 min. */
export function inCurrentWindow(l: LessonTiming, now: number): boolean {
  return (
    l.status === 'planned' &&
    lessonStartMs(l) - BEFORE_START_MS <= now &&
    now <= lessonEndMs(l) + AFTER_END_MS
  )
}

const byStart = <T extends LessonTiming>(a: T, b: T) =>
  lessonStartMs(a) - lessonStartMs(b) || a.id.localeCompare(b.id)

/**
 * Deck on У2: only lessons not held yet (planned). Top — the current one (first by start inside the
 * window), else the nearest upcoming; then the later ones by time; lessons that ended without
 * confirmation go last, so the deck never hides one the teacher still has to mark.
 */
export function deckOrder<T extends LessonTiming>(lessons: readonly T[], now: number): T[] {
  const planned = lessons.filter((l) => l.status === 'planned').sort(byStart)
  const current = planned.find((l) => inCurrentWindow(l, now))
  const rest = planned.filter((l) => l !== current)
  const ahead = rest.filter((l) => lessonEndMs(l) > now)
  const ended = rest.filter((l) => lessonEndMs(l) <= now)
  return [...(current ? [current] : []), ...ahead, ...ended]
}

/** «ещё 36 мин» — whole minutes until the end, rounded up; 0 once it is over. */
export function minutesLeft(
  l: Pick<LessonTiming, 'lesson_date' | 'planned_start' | 'duration_min'>,
  now: number,
): number {
  return Math.max(0, Math.ceil((lessonEndMs(l) - now) / MIN))
}

/** Whole minutes until the start, rounded up; 0 once started. */
export function minutesUntil(
  l: Pick<LessonTiming, 'lesson_date' | 'planned_start'>,
  now: number,
): number {
  return Math.max(0, Math.ceil((lessonStartMs(l) - now) / MIN))
}

/** «через 40 мин» / «через 1 ч» (whole hours, as on У2). */
export function untilLabel(l: Pick<LessonTiming, 'lesson_date' | 'planned_start'>, now: number) {
  const m = minutesUntil(l, now)
  return m < 60 ? `через ${m} мин` : `через ${Math.floor(m / 60)} ч`
}

export interface DayCounts {
  /** Not cancelled. */
  total: number
  held: number
  left: number
}

export function dayCounts(lessons: readonly LessonTiming[]): DayCounts {
  const total = lessons.filter((l) => l.status !== 'cancelled').length
  const held = lessons.filter((l) => l.status === 'held').length
  return { total, held, left: total - held }
}

/** 1 занятие, 2 занятия, 5 занятий. */
export function pluralRu(n: number, [one, few, many]: readonly [string, string, string]): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const LESSONS = ['занятие', 'занятия', 'занятий'] as const
export const lessonsWord = (n: number) => `${n} ${pluralRu(n, LESSONS)}`

/** «4 занятия · 2 проведено · осталось 2» — counter above the deck. */
export function countsCaption({ total, held, left }: DayCounts): string {
  return `${lessonsWord(total)} · ${held} проведено · осталось ${left}`
}

/** '14:00:00' + 60 → «14:00–15:00». */
export function timeRange(l: Pick<LessonTiming, 'planned_start' | 'duration_min'>): string {
  const [h = 0, m = 0] = l.planned_start.split(':').map(Number)
  const end = h * 60 + m + l.duration_min
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}–${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`
}

/** Bishkek wall-clock «HH:MM» of an instant (confirmed_at → «Проведено 10:02»). */
export function bishkekTime(iso: string): string {
  return new Date(Date.parse(iso) + 6 * 60 * MIN).toISOString().slice(11, 16)
}

const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export interface DaySplit<T> {
  today: T[]
  /** Tomorrow, cancelled ones left out — «Завтра». */
  tomorrow: T[]
}

/** Rows of the month … tomorrow (one fetch) → today's list and «Завтра», each by start time. */
export function splitDays<T extends LessonTiming>(
  lessons: readonly T[],
  today: string,
): DaySplit<T> {
  const sorted = [...lessons].sort(byStart)
  const tomorrow = shiftDay(today, 1)
  return {
    today: sorted.filter((l) => l.lesson_date === today),
    tomorrow: sorted.filter((l) => l.lesson_date === tomorrow && l.status !== 'cancelled'),
  }
}

export interface Unconfirmed<T> {
  /** Nearest to now first. */
  lessons: T[]
  /** Every one is yesterday's — «Вчера не подтверждено». */
  onlyYesterday: boolean
}

/** Banner on У2 and «Требует внимания» on УД1 show this many; the rest is «ещё M». */
export const UNCONFIRMED_SHOWN = 3

/**
 * Planned lessons of the earlier days of the current Bishkek month — the teacher may still confirm
 * them until the month is over (Б2). Today's are left out: they are on the deck and in today's list.
 */
export function unconfirmedInMonth<T extends LessonTiming>(
  lessons: readonly T[],
  now: number,
): Unconfirmed<T> {
  const today = new Date(now + 6 * 60 * MIN).toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const yesterday = shiftDay(today, -1)
  const list = lessons
    .filter(
      (l) => l.status === 'planned' && l.lesson_date.startsWith(month) && l.lesson_date < today,
    )
    .sort((a, b) => byStart(b, a))
  return {
    lessons: list,
    onlyYesterday: list.length > 0 && list.every((l) => l.lesson_date === yesterday),
  }
}

/** «Вчера не подтверждено» / «Не подтверждено: 12 занятий». */
export function unconfirmedTitle({ lessons, onlyYesterday }: Unconfirmed<LessonTiming>): string {
  return onlyYesterday ? 'Вчера не подтверждено' : `Не подтверждено: ${lessonsWord(lessons.length)}`
}

/** УД1 header chip: «1 не подтверждено за вчера» / «12 не подтверждено». */
export function unconfirmedChip({ lessons, onlyYesterday }: Unconfirmed<LessonTiming>): string {
  return `${lessons.length} не подтверждено${onlyYesterday ? ' за вчера' : ''}`
}
