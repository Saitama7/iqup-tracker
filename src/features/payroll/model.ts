// «Мой месяц» (У6 / УД4) and Б1 «Расчёт ЗП»: what the screens show, as pure functions of the
// loaded rows and `now` (§7.1). Money comes from calc.ts (teacher) or v_payroll_preview (staff).
import { addDays, dayShort } from '@/features/groups/model'
import { enrolledOn } from '@/features/lessons/attendance'
import {
  lessonStartMs,
  lessonState,
  lessonsWord,
  pluralRu,
  type LessonTiming,
} from '@/features/lessons/select'
import { ATTENDANCE_LABEL, formatMarkedAt, groupLabel } from '@/features/students/model'
import { tariffFor, type GroupType, type TariffTerms } from '@/features/tariffs/current'
import { formatLessonPrice, formatSom } from '@/features/tariffs/model'
import { bishkekDate, formatDayMonth } from '@/lib/time'
import {
  byGroup,
  calcLessonPay,
  calcMonth,
  consumesCredit,
  rateOn,
  roundSom,
  subscriptionLessonPrice,
  totals,
  type MonthPay,
  type PayAttendance,
  type PayMark,
  type PayRate,
  type PayTotals,
} from './calc'

// TODO(R3, docs/03-project-plan.md «R3 — закрытие периода»): payroll_periods does not exist yet,
// so every month is open and every sum is preliminary; «закрыт DD.MM», advances and «К выплате»
// minus advances come with close_period / payroll_adjustments.
export const PRELIMINARY_NOTE = 'Предварительно — пока бухгалтер не закрыл месяц'

// ─── Months (`YYYY-MM`) ─────────────────────────────────────────────────────

const MONTHS_NOM = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]
const MONTHS_PREP = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
]

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export const monthOf = (date: string) => date.slice(0, 7)
export const monthStart = (month: string) => `${month}-01`
/** Last day of the month. */
export const monthEnd = (month: string) => addDays(monthStart(shiftMonth(month, 1)), -1)

export function shiftMonth(month: string, by: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

const monthIndex = (month: string) => Number(month.slice(5, 7)) - 1
/** «Октябрь». */
export const monthNom = (month: string) => MONTHS_NOM[monthIndex(month)] ?? ''
/** «Октябрь 2026». */
export const monthTitle = (month: string) => `${monthNom(month)} ${month.slice(0, 4)}`
/** «Занятия в октябре». */
export const inMonthPrep = (month: string) => `в ${MONTHS_PREP[monthIndex(month)] ?? ''}`
/** Pay day — the 15th of the next month (А9): «15 ноября». */
export const payday = (month: string) => formatDayMonth(`${shiftMonth(month, 1)}-15`)

/**
 * The month asked for in the URL, never later than the current one; else the current month.
 */
export function pickMonth(search: string | undefined, today: string): string {
  const current = monthOf(today)
  return search && MONTH_RE.test(search) && search <= current ? search : current
}

/** «Предварительно · 1–8 окт» for the running month, «Предварительно · период открыт» for a past one. */
export function periodCaption(month: string, today: string): string {
  if (month === monthOf(today)) {
    const day = Number(today.slice(8, 10))
    const [, short = ''] = dayShort(today).split(' ')
    return `Предварительно · ${day === 1 ? '1' : `1–${day}`} ${short}`
  }
  return 'Предварительно · период открыт'
}

// ─── Rows from the API ──────────────────────────────────────────────────────

export interface MyMonthLesson extends LessonTiming {
  confirmed_at: string | null
  confirmed_late: boolean
  attendance: PayAttendance[]
}

export interface MyMonthGroup {
  id: string
  name: string
  subject: string
  group_type: GroupType
  enrollments: {
    student_id: string
    start_date: string
    end_date: string | null
    status: 'active' | 'finished'
  }[]
  lessons: MyMonthLesson[]
}

export interface MyMonthSource {
  teacherId: string
  rates: PayRate[]
  groups: MyMonthGroup[]
  tariffs: TariffTerms[]
}

/** One row of v_payroll_preview. */
export interface PreviewRow extends PayTotals {
  teacherId: string
}

export interface PayrollSource {
  preview: PreviewRow[]
  teachers: {
    id: string
    full_name: string
    rates: PayRate[]
    groups: { subject: string; status: 'forming' | 'active' | 'archived' }[]
  }[]
  /** Planned lessons of the month up to today. */
  planned: LessonTiming[]
}

// ─── «Мой месяц» ────────────────────────────────────────────────────────────

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** «8 окт, чт · 11:00». */
export function lessonWhen(l: Pick<LessonTiming, 'lesson_date' | 'planned_start'>): string {
  const dow = WEEKDAYS[new Date(`${l.lesson_date}T00:00:00Z`).getUTCDay()] ?? ''
  return `${dayShort(l.lesson_date)}, ${dow} · ${l.planned_start.slice(0, 5)}`
}

/** «Был 7 · Заморозка 1» (УД4 «Отметка»). */
export function marksCaption(marks: readonly { status: PayMark }[]): string {
  const order: PayMark[] = ['present', 'absent_frozen', 'absent_burned']
  return order
    .map((s) => [s, marks.filter((m) => m.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${ATTENDANCE_LABEL[s]} ${n}`)
    .join(' · ')
}

/** «10:02», or «7 окт 08:40 · поздно» when confirmed on a later day (Б2). */
export function confirmedCaption(
  l: Pick<MyMonthLesson, 'confirmed_at' | 'confirmed_late' | 'lesson_date'>,
): { text: string; late: boolean } | null {
  if (!l.confirmed_at) return null
  const text = formatMarkedAt(l.confirmed_at, l.lesson_date)
  const late = l.confirmed_late || text.includes(' ')
  return { text: late ? `${text} · поздно` : text, late }
}

export interface MonthLessonLine {
  id: string
  groupId: string
  when: string
  group: string
  /** Held lessons and the ones over but not confirmed (Б2 — not in the sum). */
  state: 'held' | 'unconfirmed'
  marks: string
  studentLessons: number
  /** Whole som; 0 for unconfirmed. */
  amount: number
  /** Student-lessons paid 0 — no subscription behind the mark (И5). */
  noSubscription: number
  confirmed: { text: string; late: boolean } | null
}

export interface MonthGroupLine extends PayTotals {
  id: string
  label: string
  /** «8 класс А». */
  name: string
  students: number
  unconfirmed: number
  /** Lessons later today, still to come. */
  laterToday: number
}

export interface MyMonthView {
  pay: MonthPay
  percent: number | null
  /** Full lesson price when every group has the same one (266,67); null otherwise. */
  lessonPrice: number | null
  /** «120 сом за ученико-урок» for that price; null otherwise. */
  share: number | null
  groups: MonthGroupLine[]
  /** Newest first. */
  lessons: MonthLessonLine[]
  unconfirmed: MonthLessonLine[]
  /** Shown when the rounded lesson or group sums do not add up to the total (У6 / УД4). */
  roundingNote: string | null
}

export const ROUNDING_NOTE = 'Суммы занятий и групп округлены до сома, итог — по точной сумме'

const sum = (ns: readonly number[]) => ns.reduce((n, x) => n + x, 0)

export function myMonthView(source: MyMonthSource, month: string, now: number): MyMonthView {
  const today = bishkekDate(now)
  // Rate and roster as of today in the running month, as of its last day for a past one.
  const asOf = monthEnd(month) < today ? monthEnd(month) : today
  const all = source.groups.flatMap((g) =>
    g.lessons.map((l) => ({ ...l, group_id: g.id, group_type: g.group_type, group: g })),
  )
  const pay = calcMonth(all, source.rates)
  const paid = byGroup(pay.lessons)

  const lessons: MonthLessonLine[] = []
  const newestFirst = [...all].sort((a, b) => lessonStartMs(b) - lessonStartMs(a))
  for (const l of newestFirst) {
    const state = lessonState(l, now)
    if (state !== 'held' && state !== 'ended_unconfirmed') continue
    const held = pay.lessons.find((p) => p.lesson.id === l.id)
    lessons.push({
      id: l.id,
      groupId: l.group_id,
      when: lessonWhen(l),
      group: groupLabel(l.group),
      state: state === 'held' ? 'held' : 'unconfirmed',
      marks: state === 'held' ? marksCaption(l.attendance) : 'Не отмечено',
      studentLessons: held?.studentLessons ?? 0,
      amount: held ? roundSom(held.pay) : 0,
      noSubscription: held?.noSubscription ?? 0,
      confirmed: confirmedCaption(l),
    })
  }

  const groups: MonthGroupLine[] = source.groups
    .map((g) => {
      const states = g.lessons.map((l) => lessonState(l, now))
      return {
        ...totals(paid.get(g.id) ?? []),
        id: g.id,
        label: groupLabel(g),
        name: g.name,
        students: new Set(g.enrollments.filter((e) => enrolledOn(e, asOf)).map((e) => e.student_id))
          .size,
        unconfirmed: states.filter((s) => s === 'ended_unconfirmed').length,
        laterToday: g.lessons.filter(
          (l, i) =>
            l.lesson_date === today && (states[i] === 'upcoming' || states[i] === 'current'),
        ).length,
      }
    })
    .filter((g) => g.lessonsHeld > 0 || g.unconfirmed > 0 || g.laterToday > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'ru'))

  // One lesson price for the month (the usual case — all group lessons) → «120 сом за ученико-урок».
  // Prices of the subscriptions paid for (К6); nothing held yet — the groups' tariffs as of asOf.
  const percent = rateOn(source.rates, asOf)
  const lessonPrice = singlePrice(source, pay, asOf)

  return {
    pay,
    percent,
    lessonPrice,
    share:
      lessonPrice !== null && percent !== null
        ? roundSom(
            calcLessonPay({
              consumedCount: 1,
              packagePrice: lessonPrice,
              lessonsInPackage: 1,
              percent,
            }),
          )
        : null,
    groups,
    lessons,
    unconfirmed: lessons.filter((l) => l.state === 'unconfirmed'),
    roundingNote:
      sum(lessons.map((l) => l.amount)) !== pay.amount ||
      sum(groups.map((g) => g.amount)) !== pay.amount
        ? ROUNDING_NOTE
        : null,
  }
}

export interface MonthLessonsFilter {
  /** The group shown; null — all (no filter, or the group has nothing this month). */
  group: string | null
  lessons: MonthLessonLine[]
  unconfirmed: MonthLessonLine[]
}

/** «Мой месяц» lesson lists narrowed to one group of the month (#72); sums stay for the month. */
export function filterMonthLessons(
  view: MyMonthView,
  group: string | undefined,
): MonthLessonsFilter {
  const active = group && view.groups.some((g) => g.id === group) ? group : null
  if (!active) return { group: null, lessons: view.lessons, unconfirmed: view.unconfirmed }
  const mine = (l: MonthLessonLine) => l.groupId === active
  return {
    group: active,
    lessons: view.lessons.filter(mine),
    unconfirmed: view.unconfirmed.filter(mine),
  }
}

/** The one full lesson price of the month, null when there are several (or none). */
function singlePrice(source: MyMonthSource, pay: MonthPay, asOf: string): number | null {
  const paid = pay.lessons.flatMap((p) =>
    p.lesson.attendance.flatMap((m) =>
      consumesCredit(m.status) && m.subscription ? [subscriptionLessonPrice(m.subscription)] : [],
    ),
  )
  const prices = new Set(
    paid.length > 0
      ? paid
      : source.groups.flatMap((g) => {
          const t = tariffFor(g.group_type, asOf, source.tariffs)
          return t ? [t.package_price / t.lessons_in_package] : []
        }),
  )
  return prices.size === 1 ? ([...prices][0] ?? null) : null
}

const STUDENT_LESSONS = ['ученико-урок', 'ученико-урока', 'ученико-уроков'] as const
const STUDENTS = ['ученик', 'ученика', 'учеников'] as const

export const studentLessonsWord = (n: number) => `${n} ${pluralRu(n, STUDENT_LESSONS)}`

/** «4 занятия · 30 ученико-уроков · 8 учеников», «… · 1 не подтверждено — не в сумме» (У6). */
export function groupCaption(g: MonthGroupLine): string {
  return [
    lessonsWord(g.lessonsHeld),
    studentLessonsWord(g.studentLessons),
    g.unconfirmed > 0
      ? `${g.unconfirmed} не подтверждено — не в сумме`
      : g.laterToday > 0
        ? `сегодня ещё ${g.laterToday === 1 ? 'одно' : g.laterToday}`
        : `${g.students} ${pluralRu(g.students, STUDENTS)}`,
  ].join(' · ')
}

/**
 * «нет абонемента», «нет абонемента: 2» — marks written off no subscription: counted, paid 0 (И5).
 * Shown on the lesson line (У6 / УД4) and the teacher's row (Б1) until an admin fixes the marks.
 */
export const noSubscriptionCaption = (n: number) =>
  n === 1 ? 'нет абонемента' : `нет абонемента: ${n}`

/** «Сумма = ученико-уроки × 266,67 сом × 45 %. Цифры предварительные, …» (УД4). */
export function formulaNote(v: Pick<MyMonthView, 'lessonPrice' | 'percent'>): string {
  const price = v.lessonPrice !== null ? `${formatLessonPrice(v.lessonPrice)} сом` : 'цена урока'
  const percent = v.percent !== null ? `${v.percent} %` : 'ваш процент'
  return `Сумма = ученико-уроки × ${price} × ${percent}. Цифры предварительные, пока бухгалтер не закрыл месяц.`
}

/** «14 ч», «66 ч», «1,5 ч». */
export const hoursCaption = (hours: number) => `${String(hours).replace('.', ',')} ч`

// ─── Б1 «Расчёт ЗП» ─────────────────────────────────────────────────────────

export interface PayrollRow extends PayTotals {
  teacherId: string
  name: string
  /** «Математика · 4 группы». */
  caption: string
  percent: number | null
}

export interface PayrollView {
  rows: PayrollRow[]
  total: PayTotals
  teachers: number
  unconfirmed: number
}

const GROUPS = ['группа', 'группы', 'групп'] as const

export function payrollView(source: PayrollSource, month: string, now: number): PayrollView {
  const today = bishkekDate(now)
  const asOf = monthEnd(month) < today ? monthEnd(month) : today
  const byTeacher = new Map(source.preview.map((r) => [r.teacherId, r]))
  const rows = source.teachers
    .map((t): PayrollRow => {
      const p = byTeacher.get(t.id)
      const groups = t.groups.filter((g) => g.status !== 'archived')
      const subjects = [...new Set(groups.map((g) => g.subject))].join(', ')
      return {
        teacherId: t.id,
        name: t.full_name,
        caption: [subjects || null, `${groups.length} ${pluralRu(groups.length, GROUPS)}`]
          .filter(Boolean)
          .join(' · '),
        percent: rateOn(t.rates, asOf),
        lessonsHeld: p?.lessonsHeld ?? 0,
        hours: p?.hours ?? 0,
        studentLessons: p?.studentLessons ?? 0,
        noSubscription: p?.noSubscription ?? 0,
        amount: p?.amount ?? 0,
      }
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ru'))
  return {
    rows,
    total: {
      lessonsHeld: rows.reduce((n, r) => n + r.lessonsHeld, 0),
      // hours come with 2 decimals (1,33 ч) — cut the float noise of the sum the same way
      hours: Math.round(sum(rows.map((r) => r.hours)) * 100) / 100,
      studentLessons: rows.reduce((n, r) => n + r.studentLessons, 0),
      noSubscription: rows.reduce((n, r) => n + r.noSubscription, 0),
      amount: rows.reduce((n, r) => n + r.amount, 0),
    },
    teachers: rows.length,
    unconfirmed: source.planned.filter((l) => lessonState(l, now) === 'ended_unconfirmed').length,
  }
}

const TEACHERS = ['учитель', 'учителя', 'учителей'] as const

/** «Выплата 15 октября · 5 учителей · 109 занятий проведено · 0 не подтверждено» (Б1). */
export function payrollCaption(v: PayrollView, month: string): string {
  return [
    `Выплата ${payday(month)}`,
    `${v.teachers} ${pluralRu(v.teachers, TEACHERS)}`,
    `${lessonsWord(v.total.lessonsHeld)} проведено`,
    `${v.unconfirmed} не подтверждено`,
  ].join(' · ')
}

/** «118 340» → with «сом» where the screen needs it. */
export const som = (n: number) => `${formatSom(n)} сом`
