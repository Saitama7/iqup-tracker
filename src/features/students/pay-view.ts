// Payment state of a student for А5 / А6: pure helpers over the balances of features/payments.
import { formatSom } from '@/features/tariffs/model'
import { debtOverLimit, PAY_STATE_LABEL, type PayState } from '@/features/payments/balance'
import { formatHours } from '@/features/afterschool/model'

/** Lessons of a package — «6 ур»; hours of an after-school month (#82) — «6 ч». */
export type Unit = 'lesson' | 'hour'
const amount = (n: number, unit: Unit, lesson: string) =>
  unit === 'hour' ? `${formatHours(n)} ч` : `${n} ${lesson}`

/** Most urgent first: a student shows the worst state among his groups. */
const SEVERITY: readonly PayState[] = ['debt', 'soon', 'partial', 'paid']

export function worstState(states: readonly PayState[]): PayState | null {
  return SEVERITY.find((s) => states.includes(s)) ?? null
}

/** «Оплачено» / «Частично · 6 ур» / «Пора оплачивать» / «Долг». */
export function payChipLabel(state: PayState, paidLessons: number, unit: Unit = 'lesson'): string {
  return state === 'partial'
    ? `${PAY_STATE_LABEL.partial} · ${amount(paidLessons, unit, 'ур')}`
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

/** «долг 2 ур. · 533 сом»; after-school days (К13) — «долг 1 дн. · 450 сом». */
export const debtCaption = (lessons: number, som: number, unit: Unit = 'lesson', word = 'ур.') =>
  `долг ${amount(lessons, unit, word)} · ${formatSom(som)} сом`

/** «долг 2 ур. + 6 ч · 779 сом» — package lessons and after-school hours apart (А5, #82). */
export function listDebtCaption(lessons: number, hours: number, som: number): string {
  const parts = [
    lessons > 0 ? `${lessons} ур.` : null,
    hours > 0 ? `${formatHours(hours)} ч` : null,
  ].filter((p) => p !== null)
  return `долг ${parts.join(' + ')} · ${formatSom(som)} сом`
}

/** «−3» for a debt, else «4 / 12» (А5 «Осталось уроков»). */
export function remainingLabel(b: {
  debtLessons: number
  lessonsLeft: number
  lessonsTotal: number
  unit?: Unit
}): string {
  if (b.unit === 'hour') {
    return b.debtLessons > 0
      ? `−${formatHours(b.debtLessons)} ч`
      : `${formatHours(Math.max(0, b.lessonsLeft))} / ${formatHours(b.lessonsTotal)} ч`
  }
  return b.debtLessons > 0
    ? `−${b.debtLessons}`
    : `${Math.max(0, b.lessonsLeft)} / ${b.lessonsTotal}`
}

export const METHOD_LABEL = { cash: 'Наличные', mbank: 'Mbank' } as const
