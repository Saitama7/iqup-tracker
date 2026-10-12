// Teacher's pay — docs/01-domain-model.md §6, 05-decisions А1–А3, А6–А7, Ж2, И18, К6.
// The one place the formula lives in TS (У5 / УД2 / УД3 / У6 / УД4 / А1 / Б1). The same rules are
// the SQL view v_payroll_preview (0011) — change both together; tests/integration/payroll.test.ts
// compares them on the seed.
//
// Pure: callers pass the rows they already have, nothing here reads the database.
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

/** The subscription a mark was written off (attendance.subscription_id) — its full price (К6). */
export interface PaySubscription {
  price_full: number
  lessons_total: number
}

export interface PayAttendance {
  status: PayMark
  /** null — no subscription behind the mark (И5 breach): the mark pays 0, flagged on У6 / Б1. */
  subscription: PaySubscription | null
}

/** Full price of one lesson of a subscription: price_full / lessons_total (А1.1, К3, К6). */
export const subscriptionLessonPrice = (s: PaySubscription) => s.price_full / s.lessons_total

/**
 * Exact pay for one consumed mark: the price of the subscription it was written off — not the
 * tariff of the lesson date, so a tariff changed after the purchase never reprices it (К6) —
 * × the teacher's percent on the lesson date. No subscription or no percent → 0.
 */
export function markPay(subscription: PaySubscription | null, percent: number | null): number {
  if (!subscription || percent === null) return 0
  return calcLessonPay({
    consumedCount: 1,
    packagePrice: subscription.price_full,
    lessonsInPackage: subscription.lessons_total,
    percent,
  })
}

export interface PayLesson {
  id: string
  group_id: string
  lesson_date: string
  duration_min: number
  status: PayLessonStatus
  attendance: readonly PayAttendance[]
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

export interface LessonPay {
  lesson: PayLesson
  studentLessons: number
  /** Consumed marks without a subscription — counted, paid 0. */
  noSubscription: number
  /** Exact, not rounded. 0 when the date has no percent. */
  pay: number
}

export interface PayTotals {
  lessonsHeld: number
  /** duration_min / 60 summed: 1 h a lesson, 3 h an after-school day (А3). */
  hours: number
  studentLessons: number
  /** Student-lessons paid 0 for want of a subscription («нет абонемента», И5). */
  noSubscription: number
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
 * count: planned (not confirmed yet) and cancelled ones pay nothing (А6, Б2). Each consumed mark is
 * priced by its subscription (markPay, К6); the percent is taken on each lesson date
 * (`valid_from`), so a rate changed mid-month splits the month.
 */
export function calcMonth(lessons: readonly PayLesson[], rates: readonly PayRate[]): MonthPay {
  const paid: LessonPay[] = []
  for (const lesson of lessons) {
    if (lesson.status !== 'held') continue
    const percent = rateOn(rates, lesson.lesson_date)
    const consumed = lesson.attendance.filter((m) => consumesCredit(m.status))
    paid.push({
      lesson,
      studentLessons: consumed.length,
      noSubscription: consumed.filter((m) => !m.subscription).length,
      pay: consumed.reduce((sum, m) => sum + markPay(m.subscription, percent), 0),
    })
  }
  return { ...totals(paid), lessons: paid }
}

/** Totals of some of the paid lessons (a group, a list page) — rounded once, like the month. */
export function totals(paid: readonly LessonPay[]): PayTotals {
  let minutes = 0
  let studentLessons = 0
  let noSubscription = 0
  let exact = 0
  for (const p of paid) {
    minutes += p.lesson.duration_min
    studentLessons += p.studentLessons
    noSubscription += p.noSubscription
    exact += p.pay
  }
  return {
    lessonsHeld: paid.length,
    hours: Math.round((minutes / 60) * 100) / 100,
    studentLessons,
    noSubscription,
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
