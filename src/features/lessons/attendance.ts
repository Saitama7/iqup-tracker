// У3 / УД2 «Посещаемость»: roster of a lesson, the subscription each mark is charged to, counters.
// Pure: callers pass rows they already have; time comes in as arguments (§7.1).
import {
  isHourSubscription,
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
import { dayHours, formatHours, type PlanVersion } from '@/features/afterschool/model'
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
  /** Every mark charged to this subscription; after-school — with its planned hours (#82). */
  marks: readonly { lesson_id: string; status: Mark; hours?: number | null }[]
  /** After-school monthly subscription: billed hours (#82); null / absent — a lesson package. */
  hours_total?: number | null
  /** Its month (first day) and the credit hours it holds on top of hours_total (И61). */
  period_month?: string | null
  credit_hours?: number | null
}

/** An after-school monthly subscription counts hours, a package — lessons (#82). */
export const isHourSource = (s: Pick<SubscriptionSource, 'hours_total'>) =>
  s.hours_total != null && s.hours_total > 0

/** Billed units of a subscription: hours_total or lessons_total. */
const unitsTotal = (s: SubscriptionSource) =>
  isHourSource(s) ? (s.hours_total ?? 0) : s.lessons_total

/** Credit hours an hour invoice holds on top of its billed hours. */
const creditOf = (s: SubscriptionSource) => (isHourSource(s) ? (s.credit_hours ?? 0) : 0)

/** Units a consuming mark takes: its hours on an hour subscription, else one lesson. */
const unitsUsed = (s: SubscriptionSource, marks: SubscriptionSource['marks']) =>
  marks
    .filter((m) => consumesCredit(m.status))
    .reduce((n, m) => n + (isHourSource(s) ? (m.hours ?? 0) : 1), 0)

export interface EnrollmentSource {
  start_date: string
  end_date: string | null
  status: 'active' | 'finished'
  student: { id: string; full_name: string; parent_phone: string | null }
  subscriptions: readonly SubscriptionSource[]
  /** After-school plan versions (#82); empty — not after-school or the old 20-lesson model. */
  plans?: readonly PlanVersion[]
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
  /** lesson — a package; hour — an after-school month (#82): total / left in hours. */
  unit: 'lesson' | 'hour'
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
  const billed = unitsTotal(s)
  const total = billed + creditOf(s)
  return {
    subscriptionId: s.id,
    unit: isHourSource(s) ? 'hour' : 'lesson',
    total,
    left: Math.round((total - unitsUsed(s, marks)) * 10) / 10,
    freezes: marks.filter((m) => m.status === 'absent_frozen').length,
    freezeLimit: s.freeze_limit,
    lessonPrice: billed > 0 ? s.price_final / billed : 0,
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
      lessons_total: unitsTotal(s),
      credit: creditOf(s),
      price_final: s.price_final,
      paid: s.paid,
      used: unitsUsed(
        s,
        s.marks.filter((m) => m.lesson_id !== lessonId),
      ),
      unit: isHourSource(s) ? 'hour' : 'lesson',
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
 * The subscription a mark on `lessonId` (on `date`) is charged to — the same rule as
 * attendance_subscription() in 0025: packages — the oldest active one with lessons left, else the
 * newest one («в долг»); after-school by hours, from the first billed day on — the invoice of the
 * month of `date`, none while the month is not invoiced. `lessonId = null` — the subscription the
 * next lesson goes to (У5 «осталось»).
 */
export function pickSubscription(
  subscriptions: readonly SubscriptionSource[],
  lessonId: string | null,
  date: string,
): Balance | null {
  const live = subscriptions.filter((s) => s.status !== 'refunded').sort(byStart)
  const invoices = live.filter(isHourSource)
  const hoursSince = invoices[0]?.started_at
  if (hoursSince !== undefined && date >= hoursSince) {
    const month = `${date.slice(0, 7)}-01`
    const invoice = invoices.filter((s) => s.period_month === month && s.started_at <= date).at(-1)
    return invoice ? balanceOf(invoice, lessonId) : null
  }
  const subs = live.filter((s) => !isHourSource(s))
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
  /** After-school: the student's planned hours that day (#82); null — not after-school. */
  hours: number | null
}

/**
 * Students of a lesson: a planned one — enrolled on the lesson date (all must be marked), an
 * after-school student only with hours that day (confirm_lesson, 0025); a held one — those with a
 * mark. By name.
 */
export function lessonRoster(
  enrollments: readonly EnrollmentSource[],
  lesson: { id: string; lesson_date: string; status: 'planned' | 'held' | 'cancelled' },
  saved: ReadonlyMap<string, Mark>,
): RosterRow[] {
  const rows = new Map<string, RosterRow>()
  for (const e of enrollments) {
    const hours = dayHours(e.plans ?? [], lesson.lesson_date)
    const on =
      lesson.status === 'held'
        ? saved.has(e.student.id)
        : enrolledOn(e, lesson.lesson_date) && hours !== 0
    if (!on || rows.has(e.student.id)) continue
    // A student enrolled twice in a row keeps all subscriptions of the group.
    const subs = enrollments
      .filter((x) => x.student.id === e.student.id)
      .flatMap((x) => x.subscriptions)
    const balance = pickSubscription(subs, lesson.id, lesson.lesson_date)
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
        ? {
            price_full: charged.price_full,
            lessons_total: charged.lessons_total,
            hours_total: charged.hours_total ?? null,
          }
        : null,
      hours,
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

/** «2 ур.» / «1,5 ч» — the unit of the subscription the mark goes to (#82). */
const short = (b: Pick<Balance, 'unit'>, n: number) =>
  b.unit === 'hour' ? `${formatHours(n)} ч` : `${n} ур.`

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
    return {
      text: `Долг ${short(b, p.debtLessons)} · ${som(p.debtSom)}`,
      tone: debtTone(p.debtLessons),
    }
  }
  if (p.state === 'soon') {
    const text = partlyPaid(b, p)
      ? `Оплачено ещё ${short(b, p.available)}`
      : `Осталось ${short(b, b.left)}`
    return { text: `${text} · пора оплачивать`, tone: 'warn' }
  }
  if (p.state === 'partial') {
    return {
      text: `Частично · оплачено ${b.unit === 'hour' ? short(b, p.paidLessons) : `${p.paidLessons} ур`} · ${freezes}`,
      tone: 'warn',
    }
  }
  return { text: `Осталось ${short(b, b.left)} · ${freezes}`, tone: 'muted' }
}

/** «Абонемент» column (УД2): «4 из 12 · заморозок 1/2», «долг 2 урока · 533 сом», «… — лимит». */
export function desktopMeta(row: Meta): { text: string; tone: Tone } {
  const b = row.balance
  const p = row.pay
  if (!b || !p) return { text: 'нет абонемента', tone: 'debt' }
  const hour = b.unit === 'hour'
  if (p.state === 'debt') {
    return {
      text: `долг ${hour ? short(b, p.debtLessons) : `${p.debtLessons} ${pluralRu(p.debtLessons, LESSONS_GEN)}`} · ${som(p.debtSom)}`,
      tone: debtTone(p.debtLessons),
    }
  }
  const ofTotal = hour
    ? `${formatHours(b.left)} из ${formatHours(b.total)} ч`
    : `${b.left} из ${b.total}`
  if (p.state === 'soon') {
    const text = partlyPaid(b, p) ? `оплачено ещё ${short(b, p.available)}` : ofTotal
    return { text: `${text} · пора оплачивать`, tone: 'warn' }
  }
  const freezes = `заморозок ${b.freezes}/${b.freezeLimit}${b.freezes >= b.freezeLimit ? ' — лимит' : ''}`
  if (p.state === 'partial') {
    return {
      text: `частично · оплачено ${hour ? short(b, p.paidLessons) : `${p.paidLessons} ур`} · ${freezes}`,
      tone: 'warn',
    }
  }
  return { text: `${ofTotal} · ${freezes}`, tone: 'muted' }
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
  rows: readonly (Pick<RosterRow, 'studentId' | 'paySubscription'> & { hours?: number | null })[],
  marks: ReadonlyMap<string, Mark>,
  percent: number,
): LessonAccrual {
  let pay = 0
  for (const r of rows) {
    const m = marks.get(r.studentId)
    if (m && consumesCredit(m)) pay += markPay(r.paySubscription, percent, r.hours ?? null)
  }
  const subs = rows.flatMap((r) => (r.paySubscription ? [r.paySubscription] : []))
  // hour subscriptions pay by each student's hours — no single «за ученико-урок» (#82)
  const prices = new Set(subs.map(subscriptionLessonPrice))
  const single = prices.size === 1 && subs[0] && !isHourSubscription(subs[0]) ? subs[0] : null
  return {
    pay: roundSom(pay),
    perStudentLesson: single ? roundSom(markPay(single, percent)) : null,
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
