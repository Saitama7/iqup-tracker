// Payment state of a student for А5 / А6: pure helpers over the balances of features/payments.
import { formatSom } from '@/features/tariffs/model'
import { debtOverLimit, PAY_STATE_LABEL, type PayState } from '@/features/payments/balance'

/** Most urgent first: a student shows the worst state among his groups. */
const SEVERITY: readonly PayState[] = ['debt', 'soon', 'partial', 'paid']

export function worstState(states: readonly PayState[]): PayState | null {
  return SEVERITY.find((s) => states.includes(s)) ?? null
}

/** «Оплачено» / «Частично · 6 ур» / «Пора оплачивать» / «Долг». */
export function payChipLabel(state: PayState, paidLessons: number): string {
  return state === 'partial'
    ? `${PAY_STATE_LABEL.partial} · ${paidLessons} ур`
    : PAY_STATE_LABEL[state]
}

export type PayTone = 'ok' | 'warn' | 'burned'

export const PAY_TONE: Record<PayState, PayTone> = {
  paid: 'ok',
  partial: 'warn',
  soon: 'warn',
  debt: 'warn',
}

/** Debt up to the limit (3 lessons) is a warning, beyond it — red (В7). */
export const debtTone = (debtLessons: number): 'warn' | 'burned' =>
  debtOverLimit(debtLessons) ? 'burned' : 'warn'

/** The chip tone: a debt past the limit is red, other debts and reminders are yellow. */
export function chipTone(state: PayState, debtLessons: number): PayTone {
  if (state === 'debt') return debtTone(debtLessons)
  return PAY_TONE[state]
}

/** «долг 2 ур. · 533 сом» */
export const debtCaption = (lessons: number, som: number) =>
  `долг ${lessons} ур. · ${formatSom(som)} сом`

/** «−3» for a debt, else «4 / 12» (А5 «Осталось уроков»). */
export function remainingLabel(b: {
  debtLessons: number
  lessonsLeft: number
  lessonsTotal: number
}): string {
  return b.debtLessons > 0
    ? `−${b.debtLessons}`
    : `${Math.max(0, b.lessonsLeft)} / ${b.lessonsTotal}`
}

export const METHOD_LABEL = { cash: 'Наличные', mbank: 'Mbank' } as const
