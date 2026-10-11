// Teacher's pay — docs/01-domain-model.md §6, 05-decisions А1–А3, А6–А7, Ж2, И18.
// The one place the formula lives in TS (У5 / УД2 / УД3 / У6 / УД4 / А1 / Б1). The same rules are
// the SQL view v_payroll_preview (0011) — change both together; tests/integration/payroll.test.ts
// compares them on the seed.
//
// Pure: callers pass the rows they already have, nothing here reads the database.
import { tariffFor, type GroupType, type TariffTerms } from '@/features/tariffs/current'

export type PayLessonStatus = 'planned' | 'held' | 'cancelled'
export type PayMark = 'present' | 'absent_frozen' | 'absent_burned'

export interface PayTerms {
  /** present + absent_burned marks — the lessons written off subscriptions (А1.3). */
  consumedCount: number
  packagePrice: number
  lessonsInPackage: number
  /** Teacher's percent, 45 or 50 (А2). */
  percent: number
}

/**
 * Exact pay for one lesson: consumedCount × package_price / lessons_in_package × percent / 100 —
 * full tariff price, discounts never apply (А1.1). Not rounded: rounding happens once per total.
 */
export function calcLessonPay({
  consumedCount,
  packagePrice,
  lessonsInPackage,
  percent,
}: PayTerms): number {
  return (consumedCount * packagePrice * percent) / (lessonsInPackage * 100)
}

/** Whole som. Float noise is cut at 6 decimals first so x.5 rounds like SQL `round()` does. */
export function roundSom(amount: number): number {
  return Math.round(Math.round(amount * 1e6) / 1e6)
}

/** A mark consumes a lesson ⇔ present or absent_burned (invariant 5). */
export const consumesCredit = (status: PayMark) => status !== 'absent_frozen'

export const consumedCount = (marks: readonly { status: PayMark }[]) =>
  marks.filter((m) => consumesCredit(m.status)).length

export interface PayLesson {
  id: string
  group_id: string
  group_type: GroupType
  lesson_date: string
  duration_min: number
  status: PayLessonStatus
  attendance: readonly { status: PayMark }[]
}

export interface PayRate {
  percent: number
  valid_from: string
}

/** Teacher's percent on `date`: the latest `valid_from <= date`; null — no rate yet. */
export function rateOn(rates: readonly PayRate[], date: string): number | null {
  let found: PayRate | null = null
  for (const r of rates) {
    if (r.valid_from > date) continue
    if (!found || r.valid_from > found.valid_from) found = r
  }
  return found?.percent ?? null
}

/** The tariff and percent of a lesson date as calcLessonPay() terms (without the count). */
export function termsOn(
  groupType: GroupType,
  date: string,
  rates: readonly PayRate[],
  tariffs: readonly TariffTerms[],
): Omit<PayTerms, 'consumedCount'> | null {
  const tariff = tariffFor(groupType, date, tariffs)
  const percent = rateOn(rates, date)
  if (!tariff || percent === null) return null
  return {
    packagePrice: tariff.package_price,
    lessonsInPackage: tariff.lessons_in_package,
    percent,
  }
}

export interface LessonPay {
  lesson: PayLesson
  studentLessons: number
  /** Exact, not rounded. 0 when the date has no tariff or no percent. */
  pay: number
}

export interface PayTotals {
  lessonsHeld: number
  /** duration_min / 60 summed: 1 h a lesson, 3 h an after-school day (А3). */
  hours: number
  studentLessons: number
  /** Whole som, rounded once (not per lesson). */
  amount: number
}

export interface MonthPay extends PayTotals {
  /** Held lessons with their pay, in the order given. */
  lessons: LessonPay[]
}

/**
 * One teacher's pay for the lessons given — callers pass one calendar month of one teacher's groups
 * (groups.teacher_id; substitutes never matter, А7) and that teacher's rates. Only `held` lessons
 * count: planned (not confirmed yet) and cancelled ones pay nothing (А6, Б2). Tariff and percent are
 * taken on each lesson date (`valid_from`), so a rate changed mid-month splits the month.
 */
export function calcMonth(
  lessons: readonly PayLesson[],
  rates: readonly PayRate[],
  tariffs: readonly TariffTerms[],
): MonthPay {
  const paid: LessonPay[] = []
  for (const lesson of lessons) {
    if (lesson.status !== 'held') continue
    const studentLessons = consumedCount(lesson.attendance)
    const terms = termsOn(lesson.group_type, lesson.lesson_date, rates, tariffs)
    paid.push({
      lesson,
      studentLessons,
      pay: terms ? calcLessonPay({ consumedCount: studentLessons, ...terms }) : 0,
    })
  }
  return { ...totals(paid), lessons: paid }
}

/** Totals of some of the paid lessons (a group, a list page) — rounded once, like the month. */
export function totals(paid: readonly LessonPay[]): PayTotals {
  let minutes = 0
  let studentLessons = 0
  let exact = 0
  for (const p of paid) {
    minutes += p.lesson.duration_min
    studentLessons += p.studentLessons
    exact += p.pay
  }
  return {
    lessonsHeld: paid.length,
    hours: Math.round((minutes / 60) * 100) / 100,
    studentLessons,
    amount: roundSom(exact),
  }
}

/** Paid lessons per group id, in the order groups first appear. */
export function byGroup(paid: readonly LessonPay[]): Map<string, LessonPay[]> {
  const groups = new Map<string, LessonPay[]>()
  for (const p of paid) {
    const list = groups.get(p.lesson.group_id)
    if (list) list.push(p)
    else groups.set(p.lesson.group_id, [p])
  }
  return groups
}
