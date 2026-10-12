// У4 / У5 / УД3 — the teacher's own groups. Pure functions of (rows, today, now).
import {
  debtLessons,
  enrolledOn,
  pickSubscription,
  type Balance,
  type EnrollmentSource,
} from '@/features/lessons/attendance'
import { lessonState, lessonsWord, pluralRu, type LessonTiming } from '@/features/lessons/select'
import { calcMonth, type PayAttendance } from '@/features/payroll/calc'
import { initials } from '@/features/students/model'
import { tariffFor, type GroupType, type TariffTerms } from '@/features/tariffs/current'
import { currentRules, weekdaysCaption, type ScheduleRule } from './model'
import { formatSom } from '@/features/tariffs/model'

export interface MonthLesson extends LessonTiming {
  attendance: PayAttendance[]
}

export interface TeacherGroup {
  id: string
  name: string
  subject: string
  group_type: GroupType
  status: 'forming' | 'active' | 'archived'
  room: string | null
  schedule_rules: ScheduleRule[]
  enrollments: EnrollmentSource[]
  /** Lessons of the current month only. */
  lessons: MonthLesson[]
}

export interface TeacherTariff extends TariffTerms {
  max_students: number
  lesson_duration_min: number
}

export interface TeacherGroupsSource {
  rates: { percent: number; valid_from: string }[]
  groups: TeacherGroup[]
  tariffs: TeacherTariff[]
}

// ─── Students ───────────────────────────────────────────────────────────────

export type PayState = 'debt' | 'soon' | 'ok'

export interface MemberRow {
  studentId: string
  fullName: string
  initials: string
  parentPhone: string | null
  startDate: string
  balance: Balance | null
  /** Lessons «в долг» (В7) and their price with the discount. */
  debt: number
  debtSom: number
  pay: PayState
}

/** Students enrolled in the group today, with the subscription their next lesson goes to. */
export function memberRows(group: Pick<TeacherGroup, 'enrollments'>, today: string): MemberRow[] {
  const rows = new Map<string, MemberRow>()
  for (const e of group.enrollments) {
    if (!enrolledOn(e, today) || rows.has(e.student.id)) continue
    const subs = group.enrollments
      .filter((x) => x.student.id === e.student.id)
      .flatMap((x) => x.subscriptions)
    const balance = pickSubscription(subs, null)
    const debt = balance ? debtLessons(balance) : 0
    rows.set(e.student.id, {
      studentId: e.student.id,
      fullName: e.student.full_name,
      initials: initials(e.student.full_name),
      parentPhone: e.student.parent_phone,
      startDate: e.start_date,
      balance,
      debt,
      debtSom: balance ? Math.round(debt * balance.lessonPrice) : 0,
      pay: !balance || debt > 0 ? 'debt' : balance.left <= 2 ? 'soon' : 'ok',
    })
  }
  return [...rows.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
}

// ─── Group summary ──────────────────────────────────────────────────────────

export interface GroupSummary {
  students: number
  maxStudents: number | null
  /** Held lessons this month. */
  held: number
  /** present + absent_burned marks of held lessons this month (А1.3). */
  studentLessons: number
  /** Teacher's pay for those — payroll/calc.ts, preliminary until the period is closed (И18). */
  accrued: number
  debtors: number
  /** Students with ≤ 2 lessons left (not in debt). */
  ending: number
  /** Planned lessons of this month that are over and not confirmed (Б2). */
  unconfirmed: number
  /** A lesson of the group is on now. */
  isNow: boolean
}

export function groupSummary(
  group: TeacherGroup,
  source: Pick<TeacherGroupsSource, 'rates' | 'tariffs'>,
  today: string,
  now: number,
): GroupSummary {
  const members = memberRows(group, today)
  let unconfirmed = 0
  let isNow = false
  for (const l of group.lessons) {
    const state = lessonState(l, now)
    if (state === 'current') isNow = true
    if (state === 'ended_unconfirmed') unconfirmed++
  }
  const pay = calcMonth(
    group.lessons.map((l) => ({ ...l, group_id: group.id })),
    source.rates,
  )
  return {
    students: members.length,
    maxStudents: tariffFor(group.group_type, today, source.tariffs)?.max_students ?? null,
    held: pay.lessonsHeld,
    studentLessons: pay.studentLessons,
    accrued: pay.amount,
    debtors: members.filter((m) => m.pay === 'debt').length,
    ending: members.filter((m) => m.pay === 'soon').length,
    unconfirmed,
    isNow,
  }
}

/** «8 / 10» (or «8» without a tariff). */
export const capacity = (s: Pick<GroupSummary, 'students' | 'maxStudents'>, sep = ' / ') =>
  s.maxStudents !== null ? `${s.students}${sep}${s.maxStudents}` : String(s.students)

/** Days of the rules in effect today: «ВТ · ЧТ · СБ» (filter chips of У4). */
export function daysKey(rules: readonly ScheduleRule[], today: string): string {
  return weekdaysCaption(
    currentRules(rules, today).map((r) => r.weekday),
    ' · ',
  )
}

/** «ВТ · ЧТ · СБ · 09:00» (У4 / УД3 list). */
export function scheduleDots(rules: readonly ScheduleRule[], today: string): string {
  const current = currentRules(rules, today)
  const times = [...new Set(current.map((r) => r.start_time.slice(0, 5)))].sort()
  return [daysKey(rules, today), ...times].filter(Boolean).join(' · ')
}

/** «ВТ · ЧТ · СБ · 09:00–10:00» (У5 header). */
export function scheduleRange(
  rules: readonly ScheduleRule[],
  today: string,
  durationMin: number | null,
): string {
  const current = currentRules(rules, today)
  const times = [...new Set(current.map((r) => r.start_time.slice(0, 5)))].sort()
  const ranges = times.map((t) => (durationMin ? `${t}–${endOf(t, durationMin)}` : t))
  return [daysKey(rules, today), ...ranges].filter(Boolean).join(' · ')
}

function endOf(start: string, minutes: number): string {
  const [h = 0, m = 0] = start.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export interface Badge {
  text: string
  tone: 'neutral' | 'debt' | 'warn'
}

const DEBTS = ['долг', 'долга', 'долгов'] as const
const ENDING = ['заканчивает', 'заканчивают', 'заканчивают'] as const
const UNCONFIRMED = ['не подтверждено', 'не подтверждено', 'не подтверждено'] as const

/** У4 card badges: «Групповая», «В октябре: 4 занятия», «1 долг», «2 заканчивают абонемент». */
export function groupBadges(
  s: GroupSummary,
  typeLabel: string,
  monthPrepositional: string,
): Badge[] {
  const badges: Badge[] = [{ text: typeLabel, tone: 'neutral' }]
  if (s.held > 0)
    badges.push({ text: `${monthPrepositional}: ${lessonsWord(s.held)}`, tone: 'neutral' })
  if (s.debtors > 0)
    badges.push({ text: `${s.debtors} ${pluralRu(s.debtors, DEBTS)}`, tone: 'debt' })
  if (s.ending > 0) {
    badges.push({ text: `${s.ending} ${pluralRu(s.ending, ENDING)} абонемент`, tone: 'warn' })
  }
  if (s.unconfirmed > 0) {
    badges.push({ text: `${s.unconfirmed} ${pluralRu(s.unconfirmed, UNCONFIRMED)}`, tone: 'debt' })
  }
  return badges
}

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
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сент',
  'окт',
  'нояб',
  'дек',
]

/** «В октябре». */
export const inMonth = (iso: string) => `В ${MONTHS_PREP[Number(iso.slice(5, 7)) - 1] ?? ''}`
/** «окт» — «занятия в окт» on У5. */
export const monthShort = (iso: string) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''

/** «с 15 сент» (У5). */
export const sinceShort = (iso: string) => `с ${Number(iso.slice(8, 10))} ${monthShort(iso)}`

const GROUPS = ['группа', 'группы', 'групп'] as const
const STUDENTS = ['ученик', 'ученика', 'учеников'] as const

/** «4 группы · 28 учеников» — eyebrow of У4 / УД3. */
export function groupsCaption(summaries: readonly Pick<GroupSummary, 'students'>[]): string {
  const students = summaries.reduce((n, s) => n + s.students, 0)
  return `${summaries.length} ${pluralRu(summaries.length, GROUPS)} · ${students} ${pluralRu(students, STUDENTS)}`
}

/** «пора оплачивать · заморозок 2 / 2», «долг 2 урока · 533 сом · родитель 0555 123 456». */
export function memberCaption(m: MemberRow, phone: string | null): string {
  const b = m.balance
  if (!b) return 'нет абонемента'
  const freezes = `заморозок ${b.freezes} / ${b.freezeLimit}`
  if (m.pay === 'debt') {
    return [
      `долг ${m.debt} ${pluralRu(m.debt, ['урок', 'урока', 'уроков'])} · ${formatSom(m.debtSom)} сом`,
      phone ? `родитель ${phone}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (m.pay === 'soon') return `пора оплачивать · ${freezes}`
  return `${sinceShort(m.startDate)} · ${freezes}`
}
