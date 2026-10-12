// У3 / УД2 «Посещаемость»: roster of a lesson, the subscription each mark is charged to, counters.
// Pure: callers pass rows they already have; time comes in as arguments (§7.1).
import {
  markPay,
  roundSom,
  subscriptionLessonPrice,
  type PaySubscription,
} from '@/features/payroll/calc'
import {
  availableLessons,
  debtOverLimit,
  payState,
  subscriptionBalances,
  totalDebt,
  type PayState,
} from '@/features/payments/balance'
import { initials } from '@/features/students/model'
import { pluralRu } from './select'
import { formatSom } from '@/features/tariffs/model'

export type Mark = 'present' | 'absent_frozen' | 'absent_burned'
export const MARKS: readonly Mark[] = ['present', 'absent_frozen', 'absent_burned']

/** Button and counter labels (У3: «Был / Заморозка / Не был»). */
export const MARK_LABEL: Record<Mark, string> = {
  present: 'Был',
  absent_frozen: 'Заморозка',
  absent_burned: 'Не был',
}

/** attendance.consumes_credit (invariant 5). */
export const consumesCredit = (m: Mark) => m !== 'absent_frozen'

export interface SubscriptionSource {
  id: string
  status: 'active' | 'exhausted' | 'refunded'
  started_at: string
  created_at: string
  lessons_total: number
  price_full: number
  price_final: number
  freeze_limit: number
  /** Σ payments.amount of the subscription (refunds are negative). */
  paid: number
  /** Every mark charged to this subscription. */
  marks: readonly { lesson_id: string; status: Mark }[]
}

export interface EnrollmentSource {
  start_date: string
  end_date: string | null
  status: 'active' | 'finished'
  student: { id: string; full_name: string; parent_phone: string | null }
  subscriptions: readonly SubscriptionSource[]
}

/** Enrolled on `date`; an enrollment finished without end_date is not (same rule as confirm_lesson). */
export function enrolledOn(
  e: Pick<EnrollmentSource, 'start_date' | 'end_date' | 'status'>,
  date: string,
) {
  if (e.start_date > date) return false
  return e.end_date !== null ? e.end_date >= date : e.status === 'active'
}

export interface Balance {
  subscriptionId: string
  total: number
  /** Without the mark of `lessonId`; negative — lessons «в долг» (В7). */
  left: number
  freezes: number
  freezeLimit: number
  /** price_final / lessons_total — price of one lesson with the discount (В8). */
  lessonPrice: number
}

function balanceOf(s: SubscriptionSource, lessonId: string | null): Balance {
  const marks = s.marks.filter((m) => m.lesson_id !== lessonId)
  return {
    subscriptionId: s.id,
    total: s.lessons_total,
    left: s.lessons_total - marks.filter((m) => consumesCredit(m.status)).length,
    freezes: marks.filter((m) => m.status === 'absent_frozen').length,
    freezeLimit: s.freeze_limit,
    lessonPrice: s.lessons_total > 0 ? s.price_final / s.lessons_total : 0,
  }
}

/** Money side of a student in one group (В7, В7.1): debt, paid lessons, the pay state. */
export interface StudentPay {
  /** debt — lessons «в долг»; soon — ≤ 2 paid lessons left; partial — not all paid; paid — all paid. */
  state: PayState
  /** Paid lessons of the current subscription (floor(paid × total / price_final)). */
  paidLessons: number
  /** Paid and not used yet on the current subscription. */
  available: number
  /** Lessons «в долг» over all subscriptions of the student in the group. */
  debtLessons: number
  debtSom: number
}

/**
 * Balances of all subscriptions of one student in a group (same math as v_student_balance);
 * used = consuming marks, without the marks of `lessonId`. Null — no live subscription.
 * Which subscription a mark is charged to stays with pickSubscription (mirrors the SQL).
 */
export function studentPay(
  subscriptions: readonly SubscriptionSource[],
  lessonId: string | null,
): StudentPay | null {
  const balances = subscriptionBalances(
    subscriptions.map((s) => ({
      id: s.id,
      status: s.status,
      started_at: s.started_at,
      created_at: s.created_at,
      lessons_total: s.lessons_total,
      price_final: s.price_final,
      paid: s.paid,
      used: s.marks.filter((m) => m.lesson_id !== lessonId && consumesCredit(m.status)).length,
    })),
  )
  const current = balances.find((b) => b.isCurrent)
  if (!current) return null
  const debt = totalDebt(balances)
  return {
    state: debt.lessons > 0 ? 'debt' : payState(current),
    paidLessons: current.paidLessons,
    available: availableLessons(current),
    debtLessons: debt.lessons,
    debtSom: debt.som,
  }
}

const byStart = (a: SubscriptionSource, b: SubscriptionSource) =>
  a.started_at.localeCompare(b.started_at) ||
  a.created_at.localeCompare(b.created_at) ||
  a.id.localeCompare(b.id)

/**
 * The subscription a mark on `lessonId` is charged to — the same rule as attendance_subscription()
 * in 0010: the oldest active one with lessons left, else the newest non-refunded one («в долг»).
 * `lessonId = null` — the subscription the next lesson goes to (У5 «осталось»).
 */
export function pickSubscription(
  subscriptions: readonly SubscriptionSource[],
  lessonId: string | null,
): Balance | null {
  const subs = subscriptions.filter((s) => s.status !== 'refunded').sort(byStart)
  for (const s of subs) {
    const b = balanceOf(s, lessonId)
    if (s.status === 'active' && b.left > 0) return b
  }
  const last = subs[subs.length - 1]
  return last ? balanceOf(last, lessonId) : null
}

export interface RosterRow {
  studentId: string
  fullName: string
  initials: string
  parentPhone: string | null
  balance: Balance | null
  /** Money: debt and pay state over the student's subscriptions in the group. */
  pay: StudentPay | null
  /**
   * The subscription the mark is charged to — of a held lesson the one holding the mark — whose
   * full price is the teacher's base (К6); null — no subscription, the mark pays 0.
   */
  paySubscription: PaySubscription | null
}

/**
 * Students of a lesson: a planned one — enrolled on the lesson date (all must be marked);
 * a held one — those with a mark. By name.
 */
export function lessonRoster(
  enrollments: readonly EnrollmentSource[],
  lesson: { id: string; lesson_date: string; status: 'planned' | 'held' | 'cancelled' },
  saved: ReadonlyMap<string, Mark>,
): RosterRow[] {
  const rows = new Map<string, RosterRow>()
  for (const e of enrollments) {
    const on =
      lesson.status === 'held' ? saved.has(e.student.id) : enrolledOn(e, lesson.lesson_date)
    if (!on || rows.has(e.student.id)) continue
    // A student enrolled twice in a row keeps all subscriptions of the group.
    const subs = enrollments
      .filter((x) => x.student.id === e.student.id)
      .flatMap((x) => x.subscriptions)
    const balance = pickSubscription(subs, lesson.id)
    const charged =
      subs.find((s) => s.marks.some((m) => m.lesson_id === lesson.id)) ??
      subs.find((s) => s.id === balance?.subscriptionId)
    rows.set(e.student.id, {
      studentId: e.student.id,
      fullName: e.student.full_name,
      initials: initials(e.student.full_name),
      parentPhone: e.student.parent_phone,
      balance,
      pay: studentPay(subs, lesson.id),
      paySubscription: charged
        ? { price_full: charged.price_full, lessons_total: charged.lessons_total }
        : null,
    })
  }
  return [...rows.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
}

/** Freeze limit reached on the subscription this mark goes to (В2: 2 per subscription). */
export function freezeBlocked(row: Pick<RosterRow, 'balance'>, mark: Mark | undefined): boolean {
  const b = row.balance
  return !!b && mark !== 'absent_frozen' && b.freezes >= b.freezeLimit
}

/** «Лимит 2 на абонемент» — hint next to the disabled «Заморозка». */
export const freezeLimitHint = (b: Pick<Balance, 'freezeLimit'>) =>
  `лимит ${b.freezeLimit} на абонемент`

const LESSONS_GEN = ['урок', 'урока', 'уроков'] as const
const som = (n: number) => `${formatSom(n)} сом`

export type Tone = 'muted' | 'warn' | 'debt'

type Meta = Pick<RosterRow, 'balance' | 'pay'>

/** Up to 3 lessons «в долг» are a warning, beyond — red (В7). */
const debtTone = (lessons: number): Tone => (debtOverLimit(lessons) ? 'debt' : 'warn')

/** Paid ahead only partly (the package is not fully paid). */
const partlyPaid = (b: Balance, p: StudentPay) => p.paidLessons < b.total

/**
 * Second line under the name (У3): «Долг 2 ур. · 533 сом» / «Осталось 1 ур. · пора оплачивать» /
 * «Частично · оплачено 6 ур · заморозок 1/2» / «Осталось 4 ур. · заморозок 1/2».
 */
export function mobileMeta(row: Meta): { text: string; tone: Tone } {
  const b = row.balance
  const p = row.pay
  if (!b || !p) return { text: 'Нет абонемента', tone: 'debt' }
  const freezes = `заморозок ${b.freezes}/${b.freezeLimit}`
  if (p.state === 'debt') {
    return { text: `Долг ${p.debtLessons} ур. · ${som(p.debtSom)}`, tone: debtTone(p.debtLessons) }
  }
  if (p.state === 'soon') {
    const text = partlyPaid(b, p) ? `Оплачено ещё ${p.available} ур.` : `Осталось ${b.left} ур.`
    return { text: `${text} · пора оплачивать`, tone: 'warn' }
  }
  if (p.state === 'partial') {
    return { text: `Частично · оплачено ${p.paidLessons} ур · ${freezes}`, tone: 'warn' }
  }
  return { text: `Осталось ${b.left} ур. · ${freezes}`, tone: 'muted' }
}

/** «Абонемент» column (УД2): «4 из 12 · заморозок 1/2», «долг 2 урока · 533 сом», «… — лимит». */
export function desktopMeta(row: Meta): { text: string; tone: Tone } {
  const b = row.balance
  const p = row.pay
  if (!b || !p) return { text: 'нет абонемента', tone: 'debt' }
  if (p.state === 'debt') {
    return {
      text: `долг ${p.debtLessons} ${pluralRu(p.debtLessons, LESSONS_GEN)} · ${som(p.debtSom)}`,
      tone: debtTone(p.debtLessons),
    }
  }
  if (p.state === 'soon') {
    const text = partlyPaid(b, p) ? `оплачено ещё ${p.available} ур.` : `${b.left} из ${b.total}`
    return { text: `${text} · пора оплачивать`, tone: 'warn' }
  }
  const freezes = `заморозок ${b.freezes}/${b.freezeLimit}${b.freezes >= b.freezeLimit ? ' — лимит' : ''}`
  if (p.state === 'partial') {
    return { text: `частично · оплачено ${p.paidLessons} ур · ${freezes}`, tone: 'warn' }
  }
  return { text: `${b.left} из ${b.total} · ${freezes}`, tone: 'muted' }
}

export interface Tally {
  present: number
  frozen: number
  burned: number
  marked: number
  total: number
  unmarked: number
  /** present + burned — what the teacher is paid for (А1.3). */
  studentLessons: number
}

export function tally(
  rows: readonly Pick<RosterRow, 'studentId'>[],
  marks: ReadonlyMap<string, Mark>,
): Tally {
  let present = 0
  let frozen = 0
  let burned = 0
  for (const r of rows) {
    const m = marks.get(r.studentId)
    if (m === 'present') present++
    else if (m === 'absent_frozen') frozen++
    else if (m === 'absent_burned') burned++
  }
  const marked = present + frozen + burned
  return {
    present,
    frozen,
    burned,
    marked,
    total: rows.length,
    unmarked: rows.length - marked,
    studentLessons: present + burned,
  }
}

export interface LessonAccrual {
  /** «Начислено / Начислится», whole som: each consumed mark by its subscription (И18, К6). */
  pay: number
  /** «N сом за ученико-урок» when every subscription of the roster has one price; else null. */
  perStudentLesson: number | null
}

/** Teacher's pay of one lesson — same rule as payroll/calc.ts calcMonth(), `percent` on its date. */
export function lessonAccrual(
  rows: readonly Pick<RosterRow, 'studentId' | 'paySubscription'>[],
  marks: ReadonlyMap<string, Mark>,
  percent: number,
): LessonAccrual {
  let pay = 0
  for (const r of rows) {
    const m = marks.get(r.studentId)
    if (m && consumesCredit(m)) pay += markPay(r.paySubscription, percent)
  }
  const subs = rows.flatMap((r) => (r.paySubscription ? [r.paySubscription] : []))
  const prices = new Set(subs.map(subscriptionLessonPrice))
  return {
    pay: roundSom(pay),
    perStudentLesson: prices.size === 1 && subs[0] ? roundSom(markPay(subs[0], percent)) : null,
  }
}

/** «Все были»: everyone not marked yet → present; existing marks stay. */
export function markAllPresent(
  rows: readonly Pick<RosterRow, 'studentId'>[],
  marks: ReadonlyMap<string, Mark>,
): Map<string, Mark> {
  const next = new Map(marks)
  for (const r of rows) if (!next.has(r.studentId)) next.set(r.studentId, 'present')
  return next
}

/** p_marks of confirm_lesson: one mark per roster student, in roster order. */
export function marksPayload(
  rows: readonly Pick<RosterRow, 'studentId'>[],
  marks: ReadonlyMap<string, Mark>,
): { student_id: string; status: Mark }[] {
  return rows.flatMap((r) => {
    const status = marks.get(r.studentId)
    return status ? [{ student_id: r.studentId, status }] : []
  })
}
