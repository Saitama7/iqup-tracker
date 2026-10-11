// А1 / АМ1 / А2: pure functions of (lessons, now). Lesson states come from lessons/select.ts (#10) —
// the admin screens add no status rules of their own.
import { attendanceSummary, CANCEL_REASON_LABEL, addDays, dayShort } from '@/features/groups/model'
import {
  bishkekTime,
  lessonStartMs,
  lessonState,
  pluralRu,
  unconfirmedInMonth,
  type LessonState,
  type LessonTiming,
} from '@/features/lessons/select'
import { firstName, groupLabel } from '@/features/students/model'
import { bishkekDate, formatDayMonth } from '@/lib/time'
import type { AdminLesson } from './api'

const byStart = (a: LessonTiming, b: LessonTiming) =>
  lessonStartMs(a) - lessonStartMs(b) || a.id.localeCompare(b.id)

export const lessonLabel = (l: Pick<AdminLesson, 'group'>) => groupLabel(l.group)
export const teacherName = (l: Pick<AdminLesson, 'teacher'>) => firstName(l.teacher.name)

const STUDENTS = ['ученик', 'ученика', 'учеников'] as const
const studentsWord = (n: number) => `${n} ${pluralRu(n, STUDENTS)}`

// ─── «Не подтверждено» ──────────────────────────────────────────────────────

/** A planned lesson that is over — the same rule as on «Сегодня» (§7.1, И14). */
export const isUnconfirmed = (l: LessonTiming, now: number) =>
  lessonState(l, now) === 'ended_unconfirmed'

/**
 * Lessons of the current month still waiting for a mark, freshest first: today's that are over and
 * the earlier days' (unconfirmedInMonth — what the teachers see in their banner).
 */
export function adminUnconfirmed<T extends LessonTiming>(lessons: readonly T[], now: number): T[] {
  const today = bishkekDate(now)
  const endedToday = lessons
    .filter((l) => l.lesson_date === today && isUnconfirmed(l, now))
    .sort((a, b) => byStart(b, a))
  return [...endedToday, ...unconfirmedInMonth(lessons, now).lessons]
}

/** А1 widget shows this many; the rest — «ещё N занятий» → А2 with the filter. */
export const WIDGET_SHOWN = 3

const DAYS = ['день', 'дня', 'дней'] as const
const TEACHERS = ['учитель', 'учителя', 'учителей'] as const

/** «за 3 дня · 3 учителя» under the KPI; «2 учителя» on АМ1. */
export function unconfirmedSpread(
  lessons: readonly Pick<AdminLesson, 'lesson_date' | 'teacher'>[],
) {
  const days = new Set(lessons.map((l) => l.lesson_date)).size
  const teachers = new Set(lessons.map((l) => l.teacher.id)).size
  return {
    days: `за ${days} ${pluralRu(days, DAYS)}`,
    teachers: `${teachers} ${pluralRu(teachers, TEACHERS)}`,
  }
}

/** «Сегодня 09:00» / «Вчера 15:00» / «6 окт 19:00». */
export function unconfirmedWhen(
  l: Pick<LessonTiming, 'lesson_date' | 'planned_start'>,
  today: string,
) {
  const time = l.planned_start.slice(0, 5)
  if (l.lesson_date === today) return `Сегодня ${time}`
  if (l.lesson_date === addDays(today, -1)) return `Вчера ${time}`
  return `${dayShort(l.lesson_date)} ${time}`
}

/** «Вчера 15:00 · Математика · 5 класс · Гульзат». */
export const unconfirmedLine = (l: AdminLesson, today: string) =>
  `${unconfirmedWhen(l, today)} · ${lessonLabel(l)} · ${teacherName(l)}`

const LESSONS = ['занятие', 'занятия', 'занятий'] as const

/** «ещё 5 занятий · самое старое 5 окт →» under the three freshest. */
export function unconfirmedMore(lessons: readonly AdminLesson[]): string | null {
  const more = lessons.length - WIDGET_SHOWN
  const oldest = lessons.at(-1)
  if (more <= 0 || !oldest) return null
  return `ещё ${more} ${pluralRu(more, LESSONS)} · самое старое ${dayShort(oldest.lesson_date)} →`
}

// ─── Today on А1 / АМ1 ──────────────────────────────────────────────────────

export interface DayKpi {
  /** Not cancelled. */
  total: number
  held: number
  current: number
  upcoming: number
  unconfirmed: number
}

export function dayKpi(lessons: readonly LessonTiming[], now: number): DayKpi {
  const states = lessons.map((l) => lessonState(l, now))
  const count = (s: LessonState) => states.filter((x) => x === s).length
  return {
    total: states.filter((s) => s !== 'cancelled').length,
    held: count('held'),
    current: count('current'),
    upcoming: count('upcoming'),
    unconfirmed: count('ended_unconfirmed'),
  }
}

/** «9 проведено · 2 идут · 3 впереди» (+ «· 1 не подтв.» while any of today's waits for a mark). */
export function dayKpiCaption(k: DayKpi, { short = false } = {}): string {
  const parts = [`${k.held} проведено`]
  if (k.current > 0 || !short) parts.push(`${k.current} ${k.current === 1 ? 'идёт' : 'идут'}`)
  if (!short) parts.push(`${k.upcoming} впереди`)
  if (k.unconfirmed > 0) parts.push(`${k.unconfirmed} не подтв.`)
  return parts.join(' · ')
}

/** Today's lessons by start time. */
export const sortByStart = <T extends LessonTiming>(lessons: readonly T[]) =>
  [...lessons].sort(byStart)

/** «Гульзат · был 7 · заморозка 1» (held) / «Гульзат · 8 учеников · каб. 2» — А1 row caption. */
export function dashboardCaption(l: AdminLesson): string {
  const who = teacherName(l)
  if (l.status === 'held') {
    const n = (s: string) => l.attendance.filter((a) => a.status === s).length
    const [present, frozen, burned] = [n('present'), n('absent_frozen'), n('absent_burned')]
    return [
      who,
      `был ${present}`,
      frozen ? `заморозка ${frozen}` : null,
      burned ? `не был ${burned}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (l.status === 'cancelled') {
    return [who, l.cancel_reason ? CANCEL_REASON_LABEL[l.cancel_reason] : null]
      .filter(Boolean)
      .join(' · ')
  }
  return [who, studentsWord(l.students), l.group.room ? `каб. ${l.group.room}` : null]
    .filter(Boolean)
    .join(' · ')
}

/** «Гульзат · 7 из 8» / «Гульзат · 8 уч · идёт» — АМ1 row caption. */
export function mobileCaption(l: AdminLesson, now: number): string {
  const who = teacherName(l)
  const state = lessonState(l, now)
  if (state === 'held') {
    const present = l.attendance.filter((a) => a.status === 'present').length
    return `${who} · ${present} из ${l.attendance.length}`
  }
  if (state === 'current') return `${who} · ${l.students} уч · идёт`
  if (state === 'ended_unconfirmed') return `${who} · не подтверждено`
  if (state === 'cancelled') return `${who} · отменено`
  return `${who} · ${l.students} уч`
}

/** Chip of an А1 row: «Проведено 10:02», «Идёт», «Далее», «Не подтверждено», «Отменено». */
export function dashboardChip(l: AdminLesson, now: number): { state: LessonState; label: string } {
  const state = lessonState(l, now)
  const label = {
    held: l.confirmed_at ? `Проведено ${bishkekTime(l.confirmed_at)}` : 'Проведено',
    current: 'Идёт',
    upcoming: 'Далее',
    ended_unconfirmed: 'Не подтверждено',
    cancelled: 'Отменено',
  }[state]
  return { state, label }
}

/** «Сентябрь» on 1–15 October (the period the accountant is closing), «Октябрь» from the 16th. */
export function payrollMonth(today: string): { month: string; closeBy: string } {
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number)
  const period = d <= 15 ? new Date(Date.UTC(y, m - 2, 1)) : new Date(Date.UTC(y, m - 1, 1))
  const pay = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 15))
  return {
    month: period.toISOString().slice(0, 7),
    closeBy: formatDayMonth(pay.toISOString().slice(0, 10)),
  }
}

// ─── А2 week grid ───────────────────────────────────────────────────────────

/** Monday of the ISO week of `date`. */
export function weekStart(date: string): string {
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(date, -wd)
}

/** ПН–СБ as on the artboard; ВС only when something is scheduled on it. */
export function weekDays(monday: string, lessons: readonly Pick<LessonTiming, 'lesson_date'>[]) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const sunday = days[6] as string
  return lessons.some((l) => l.lesson_date === sunday) ? days : days.slice(0, 6)
}

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/** «5 – 10 октября» / «28 сентября – 3 октября». */
export function weekTitle(days: readonly string[]): string {
  const first = days[0] ?? ''
  const last = days.at(-1) ?? ''
  const [, m1 = 1, d1 = 1] = first.split('-').map(Number)
  const [, m2 = 1, d2 = 1] = last.split('-').map(Number)
  return m1 === m2
    ? `${d1} – ${d2} ${MONTHS_GEN[m2 - 1]}`
    : `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]}`
}

const WEEKDAY_SHORT = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

/** «ПН 5», «ЧТ 8 · сегодня». */
export function dayHeader(date: string, today: string): string {
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const label = `${WEEKDAY_SHORT[wd]} ${Number(date.slice(8, 10))}`
  return date === today ? `${label} · сегодня` : label
}

/** Hour rows of the grid: only the hours something starts in, as on the artboard (09:00, 11:00 …). */
export function hourRows(lessons: readonly Pick<LessonTiming, 'planned_start'>[]): string[] {
  return [...new Set(lessons.map((l) => `${l.planned_start.slice(0, 2)}:00`))].sort()
}

export const inHour = (l: Pick<LessonTiming, 'planned_start'>, hour: string) =>
  l.planned_start.slice(0, 2) === hour.slice(0, 2)

export type CardTone =
  'held' | 'current' | 'upcoming' | 'unconfirmed' | 'cancelled' | 'extra' | 'forming'

/**
 * Card colour on А2: the lesson state; a coming extra lesson is teal, a coming lesson of a group
 * still in «набор» — violet dashed («группа на пробном»).
 */
export function cardTone(l: AdminLesson, now: number): CardTone {
  const state = lessonState(l, now)
  if (state === 'held') return 'held'
  if (state === 'cancelled') return 'cancelled'
  if (state === 'ended_unconfirmed') return 'unconfirmed'
  if (l.group.status === 'forming') return 'forming'
  if (state === 'current') return 'current'
  return l.is_extra ? 'extra' : 'upcoming'
}

/** Title and caption of an А2 card: «Математика · 8 класс Б · идёт» / «Гульзат · 8 уч». */
export function cardText(l: AdminLesson, now: number): { title: string; caption: string } {
  const label = lessonLabel(l)
  const who = teacherName(l)
  switch (cardTone(l, now)) {
    case 'held':
      return { title: label, caption: `${who} · ${attendanceSummary(l.attendance)}` }
    case 'current':
      return { title: `${label} · идёт`, caption: `${who} · ${l.students} уч` }
    case 'unconfirmed':
      return { title: label, caption: `${who} · не подтверждено` }
    case 'cancelled':
      return {
        title: `${label} · отменено`,
        caption: [who, l.cancel_reason ? CANCEL_REASON_LABEL[l.cancel_reason] : null]
          .filter(Boolean)
          .join(' · '),
      }
    case 'extra':
      return {
        title: `${label} · доп`,
        caption: l.makesUpFor ? `${who} · за ${dayShort(l.makesUpFor)}` : who,
      }
    case 'forming':
      return { title: `${label} · набор`, caption: who }
    default:
      return { title: label, caption: who }
  }
}

export interface ScheduleFilter {
  teacher?: string
  unconfirmed?: boolean
}

export function filterLessons<T extends AdminLesson>(
  lessons: readonly T[],
  { teacher, unconfirmed }: ScheduleFilter,
  now: number,
): T[] {
  return lessons.filter(
    (l) => (!teacher || l.teacher.id === teacher) && (!unconfirmed || isUnconfirmed(l, now)),
  )
}

/** With the filter on: weeks other than the shown one that still hold unconfirmed lessons. */
export function otherWeeks(
  lessons: readonly Pick<LessonTiming, 'lesson_date'>[],
  monday: string,
): { monday: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const l of lessons) {
    const w = weekStart(l.lesson_date)
    if (w !== monday) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([w, count]) => ({ monday: w, count }))
}
