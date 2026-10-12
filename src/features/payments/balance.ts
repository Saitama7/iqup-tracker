// Student balance — docs/01-domain-model.md §5, 05-decisions В7, В7.1, В8, И37.
// The one place the rules live in TS (А5 / А6 / А7 / У4 / У5 / УД3). The same numbers are the SQL view
// v_student_balance (0016) — change both together; tests/integration/balance.test.ts compares them
// on the seed.
//
// Pure: callers pass the rows they already have, nothing here reads the database.
import { roundSom } from '@/features/payroll/calc'

/** Up to 3 lessons «в долг» are allowed (В7): highlighted, never blocked. The 4th is red. */
export const DEBT_LIMIT = 3

export interface BalanceSubscription {
  id: string
  status: 'active' | 'exhausted' | 'refunded'
  started_at: string
  created_at: string
  lessons_total: number
  price_final: number
  /** present + absent_burned marks written off this subscription (attendance.subscription_id). */
  used: number
  /** Σ payments.amount — refunds are negative. */
  paid: number
}

export interface SubscriptionBalance {
  subscriptionId: string
  refunded: boolean
  lessonsTotal: number
  priceFinal: number
  paidSom: number
  /** floor(paid × lessons_total / price_final) — partial payment opens that many lessons (В7.1). */
  paidLessons: number
  /** Lessons «в долг» of the previous subscription taken over by this one (И37). */
  carriedIn: number
  /** Own marks + carried; on a subscription that is not the last — at most its capacity. */
  lessonsUsed: number
  /** lessons_total − used; negative — beyond the package. */
  lessonsLeft: number
  debtLessons: number
  /** What the debt lessons cost beyond the money paid, whole som, at least 1. */
  debtSom: number
  /** Remaining paid lessons × price_final / lessons_total (В8); the admin may correct it. */
  refundSuggested: number
  /** The newest live subscription — the one shown as «Абонемент». */
  isCurrent: boolean
}

/** Partial payment opens a proportional number of lessons (В7.1), integer math — no float noise. */
export function paidLessons(paid: number, lessonsTotal: number, priceFinal: number): number {
  if (priceFinal <= 0) return lessonsTotal
  return Math.floor((Math.max(0, paid) * lessonsTotal) / priceFinal)
}

const byStart = (a: BalanceSubscription, b: BalanceSubscription) =>
  a.started_at.localeCompare(b.started_at) ||
  a.created_at.localeCompare(b.created_at) ||
  a.id.localeCompare(b.id)

function finish(
  s: BalanceSubscription,
  paid: number,
  carriedIn: number,
  used: number,
  isCurrent: boolean,
): SubscriptionBalance {
  const refunded = s.status === 'refunded'
  const debtLessons = refunded ? 0 : Math.max(0, used - paid)
  const owed = (used * s.price_final - s.paid * s.lessons_total) / s.lessons_total
  const remaining = Math.max(0, Math.min(paid, s.lessons_total) - used)
  return {
    subscriptionId: s.id,
    refunded,
    lessonsTotal: s.lessons_total,
    priceFinal: s.price_final,
    paidSom: s.paid,
    paidLessons: paid,
    carriedIn,
    lessonsUsed: used,
    lessonsLeft: s.lessons_total - used,
    debtLessons,
    debtSom: debtLessons > 0 ? Math.max(1, roundSom(owed)) : 0,
    refundSuggested: refunded ? 0 : roundSom((remaining * s.price_final) / s.lessons_total),
    isCurrent,
  }
}

/**
 * Balances of all subscriptions of one student in one group (any enrollments), in the input order.
 * Lessons charged «в долг» beyond a subscription move to the next one once it is bought: a
 * subscription that is not the last holds at most max(lessons_total, paid lessons), the rest is
 * carried (И37). A refunded subscription is closed — it neither carries nor owes.
 */
export function subscriptionBalances(
  subscriptions: readonly BalanceSubscription[],
): SubscriptionBalance[] {
  const live = subscriptions.filter((s) => s.status !== 'refunded').sort(byStart)
  const result = new Map<string, SubscriptionBalance>()
  let carry = 0
  live.forEach((s, i) => {
    const paid = paidLessons(s.paid, s.lessons_total, s.price_final)
    const last = i === live.length - 1
    const capacity = Math.max(s.lessons_total, paid)
    const total = s.used + carry
    const used = last ? total : Math.min(total, capacity)
    result.set(s.id, finish(s, paid, carry, used, last))
    carry = Math.max(0, total - capacity)
  })
  return subscriptions.map(
    (s) =>
      result.get(s.id) ??
      finish(s, paidLessons(s.paid, s.lessons_total, s.price_final), 0, s.used, false),
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
