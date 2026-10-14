// Student balance — docs/01-domain-model.md §5, 05-decisions В7, В7.1, В8, И37.
// The one place the rules live in TS (А5 / А6 / А7 / У4 / У5 / УД3). The same numbers are the SQL view
// v_student_balance (0016) — change both together; tests/integration/balance.test.ts compares them
// on the seed.
//
// Pure: callers pass the rows they already have, nothing here reads the database.
import { roundSom } from '@/features/payroll/calc'

/** Up to 3 lessons «в долг» are allowed (В7): highlighted, never blocked. The 4th is red. */
export const DEBT_LIMIT = 3

/** A package counts lessons; an after-school monthly subscription counts hours (#82). */
export type BalanceUnit = 'lesson' | 'hour'

export interface BalanceSubscription {
  id: string
  status: 'active' | 'exhausted' | 'refunded'
  started_at: string
  created_at: string
  /** Units the price is for: lessons_total, or hours_total (billed hours) of an hour subscription. */
  lessons_total: number
  /**
   * An hour invoice: credit hours taken off it (paid on earlier invoices, И61) — it holds
   * lessons_total + credit, and the credit counts as paid. Default 0.
   */
  credit?: number
  price_final: number
  /**
   * present + absent_burned marks written off this subscription (attendance.subscription_id);
   * an hour subscription — Σ their hours.
   */
  used: number
  /** Default lesson. */
  unit?: BalanceUnit
  /** Σ payments.amount — refunds are negative. */
  paid: number
}

export interface SubscriptionBalance {
  subscriptionId: string
  refunded: boolean
  /** Capacity: lessons_total, an hour invoice + its credit hours. */
  lessonsTotal: number
  priceFinal: number
  paidSom: number
  /**
   * floor(paid × lessons_total / price_final) — partial payment opens that many lessons (В7.1); a debt
   * carried in by a transfer (paid < 0) gives a negative number — lessons owed before the first one (#81).
   */
  paidLessons: number
  /** Lessons «в долг» of the previous subscription taken over by this one (И37). */
  carriedIn: number
  /** Own marks + carried; on a subscription that is not the last — at most its capacity. */
  lessonsUsed: number
  /** lessons_total − used; negative — beyond the package. */
  lessonsLeft: number
  debtLessons: number
  /** What the debt lessons cost beyond the money paid, rounded up to whole som (И37) — paying it closes the debt. */
  debtSom: number
  /**
   * Remaining paid lessons × price_final / lessons_total (В8); the admin may correct it. 0 on an
   * exhausted subscription — closed by a transfer / «ушёл», its rest moved, refunded or left to the center.
   */
  refundSuggested: number
  /** The newest live subscription — the one shown as «Абонемент». */
  isCurrent: boolean
}

/**
 * Partial payment opens a proportional number of lessons (В7.1), integer math — no float noise. A
 * negative paid (a debt carried by a transfer, #81) floors too: −600 at 3 800 / 12 → −2, a debt of 2.
 * Hours open by 0,5 h (#82).
 */
export function paidLessons(
  paid: number,
  lessonsTotal: number,
  priceFinal: number,
  unit: BalanceUnit = 'lesson',
): number {
  if (priceFinal <= 0) return lessonsTotal
  if (unit === 'hour') return Math.floor((paid * lessonsTotal * 2) / priceFinal) / 2
  return Math.floor((paid * lessonsTotal) / priceFinal)
}

/** Float noise of half-hour sums (0,5 + 1 + …) cut before comparing / showing. */
const units = (n: number) => Math.round(n * 1e6) / 1e6

const byStart = (a: BalanceSubscription, b: BalanceSubscription) =>
  a.started_at.localeCompare(b.started_at) ||
  a.created_at.localeCompare(b.created_at) ||
  a.id.localeCompare(b.id)

const creditOf = (s: BalanceSubscription) => s.credit ?? 0

/** Capacity: lessons_total (+ credit hours of an hour invoice). */
const capacityOf = (s: BalanceSubscription) => s.lessons_total + creditOf(s)

/** Paid units: by money (В7.1), + the credit hours of an hour invoice; free — the capacity. */
function paidUnits(s: BalanceSubscription, unit: BalanceUnit): number {
  if (s.price_final <= 0) return capacityOf(s)
  return creditOf(s) + paidLessons(s.paid, s.lessons_total, s.price_final, unit)
}

function finish(
  s: BalanceSubscription,
  paid: number,
  carriedIn: number,
  used: number,
  isCurrent: boolean,
): SubscriptionBalance {
  const refunded = s.status === 'refunded'
  const closed = refunded || s.status === 'exhausted'
  const total = capacityOf(s)
  const debtLessons = refunded ? 0 : units(Math.max(0, used - paid))
  // Ceil, not round: paying debtSom must open every debt lesson (paidLessons floors). Money is per
  // billed unit — the credit hours were paid on an earlier invoice.
  const owed = Math.ceil(
    ((used - creditOf(s)) * s.price_final - s.paid * s.lessons_total) / s.lessons_total,
  )
  const remaining = Math.max(0, Math.min(paid, total) - used)
  return {
    subscriptionId: s.id,
    refunded,
    lessonsTotal: total,
    priceFinal: s.price_final,
    paidSom: s.paid,
    paidLessons: paid,
    carriedIn: units(carriedIn),
    lessonsUsed: units(used),
    lessonsLeft: units(total - used),
    debtLessons,
    debtSom: debtLessons > 0 ? Math.max(0, owed) : 0,
    refundSuggested: closed ? 0 : roundSom((remaining * s.price_final) / s.lessons_total),
    isCurrent,
  }
}

/**
 * Balances of all subscriptions of one student in one group (any enrollments), in the input order.
 * Lessons charged «в долг» beyond a subscription move to the next one once it is bought: a
 * subscription that is not the last holds at most max(lessons_total, paid lessons), the rest is
 * carried (И37). A refunded subscription is closed — it neither carries nor owes. Carrying stays
 * within one unit (an old 20-lesson package never carries into hours, #82); the current one is the
 * newest live subscription of any unit.
 */
export function subscriptionBalances(
  subscriptions: readonly BalanceSubscription[],
): SubscriptionBalance[] {
  const live = subscriptions.filter((s) => s.status !== 'refunded').sort(byStart)
  const newest = live.at(-1)?.id
  const result = new Map<string, SubscriptionBalance>()
  for (const unit of ['lesson', 'hour'] as const) {
    const chain = live.filter((s) => (s.unit ?? 'lesson') === unit)
    let carry = 0
    chain.forEach((s, i) => {
      const paid = paidUnits(s, unit)
      const last = i === chain.length - 1
      const capacity = Math.max(capacityOf(s), paid)
      const total = s.used + carry
      const used = last ? total : Math.min(total, capacity)
      result.set(s.id, finish(s, paid, carry, used, s.id === newest))
      carry = Math.max(0, total - capacity)
    })
  }
  return subscriptions.map(
    (s) => result.get(s.id) ?? finish(s, paidUnits(s, s.unit ?? 'lesson'), 0, s.used, false),
  )
}

// ─── Pay state (А5 / А6 / У4 / У5 / УД3) ────────────────────────────────────

/** debt — lessons «в долг»; soon — ≤ 2 paid lessons left; partial — not all paid; paid — all paid. */
export type PayState = 'debt' | 'soon' | 'partial' | 'paid'

export const PAY_STATE_LABEL: Record<PayState, string> = {
  debt: 'Долг',
  soon: 'Пора оплачивать',
  partial: 'Частично',
  paid: 'Оплачено',
}

/** Lessons left to attend before the next one goes «в долг». */
export const availableLessons = (b: Pick<SubscriptionBalance, 'paidLessons' | 'lessonsUsed'>) =>
  b.paidLessons - b.lessonsUsed

export function payState(
  b: Pick<SubscriptionBalance, 'debtLessons' | 'paidLessons' | 'lessonsUsed' | 'lessonsTotal'>,
): PayState {
  if (b.debtLessons > 0) return 'debt'
  if (b.paidLessons < b.lessonsTotal) return availableLessons(b) <= 2 ? 'soon' : 'partial'
  return b.lessonsTotal - b.lessonsUsed <= 2 ? 'soon' : 'paid'
}

/** Within the limit (≤ 3) the debt is a warning, beyond it — red (В7). */
export const debtOverLimit = (debtLessons: number) => debtLessons > DEBT_LIMIT

/** The whole debt of a student in a group: every subscription that still owes (old ones too). */
export function totalDebt(balances: readonly SubscriptionBalance[]): {
  lessons: number
  som: number
} {
  return balances.reduce(
    (t, b) => ({ lessons: t.lessons + b.debtLessons, som: t.som + b.debtSom }),
    { lessons: 0, som: 0 },
  )
}
