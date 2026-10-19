// #92 · «Удалить оплату» / «Изменить оплату» (Г10): what deleting a row does — the same rules as
// delete_payment (0026), the debt from balance.ts on the enrollment's rows without that payment. Pure.
import { formatHours, monthAccusative } from '@/features/afterschool/model'
import { pluralRu } from '@/features/lessons/select'
import { formatDateRu } from '@/lib/time'
import { subscriptionBalances, type BalanceSubscription } from './balance'
import { formatSom } from '@/features/tariffs/model'
import type { PaymentRow } from './api'
import { som } from './model'

export type EditableKind = 'payment' | 'refund'

/** A subscription of the enrollment with its payments and marks, as the client reads them. */
export interface ImpactSubscription extends Omit<BalanceSubscription, 'paid'> {
  payments: { id: string; amount: number }[]
  /** Marks written off it (attendance.subscription_id), any status. */
  marks: number
  /** After-school invoice in hours (И60) — never deleted with its payment. */
  hours: boolean
}

export type DeleteImpact =
  | { outcome: 'subscription_deleted'; startedAt: string }
  | { outcome: 'reactivated' }
  | { outcome: 'stays'; marks: number; debt: number; debtSom: number; unit: 'lesson' | 'hour' }

/** delete_payment's outcome for payment `paymentId` of subscription `subscriptionId`. */
export function deleteImpact(
  subs: readonly ImpactSubscription[],
  subscriptionId: string,
  paymentId: string,
  kind: EditableKind,
): DeleteImpact | null {
  const sub = subs.find((s) => s.id === subscriptionId)
  if (!sub) return null
  if (kind === 'refund' && sub.status === 'refunded') return { outcome: 'reactivated' }
  const rest = sub.payments.filter((p) => p.id !== paymentId)
  if (kind === 'payment' && !sub.hours && rest.length === 0 && sub.marks === 0 && subs.length > 1) {
    return { outcome: 'subscription_deleted', startedAt: sub.started_at }
  }
  const after = subscriptionBalances(
    subs.map((s) => ({
      ...s,
      paid: (s.id === subscriptionId ? rest : s.payments).reduce((n, p) => n + p.amount, 0),
    })),
  ).find((b) => b.subscriptionId === subscriptionId)
  return {
    outcome: 'stays',
    marks: sub.marks,
    debt: after?.debtLessons ?? 0,
    debtSom: after?.debtSom ?? 0,
    unit: sub.unit ?? 'lesson',
  }
}

const marksLabel = (n: number) => `${n} ${pluralRu(n, ['отметка', 'отметки', 'отметок'])}`

/** The line of the dialog «Удалить оплату»: what will happen to the subscription. */
export function deleteImpactText(impact: DeleteImpact): string {
  if (impact.outcome === 'reactivated') return 'Абонемент снова станет действующим'
  if (impact.outcome === 'subscription_deleted') {
    return `Абонемент с ${formatDateRu(impact.startedAt).slice(0, 5)} будет удалён — по нему нет других оплат и отметок`
  }
  const debt =
    impact.debt > 0
      ? ` — появится долг ${impact.unit === 'hour' ? `${formatHours(impact.debt)} ч` : `${impact.debt} ур.`} · ${som(impact.debtSom)}`
      : impact.debtSom > 0
        ? ` — появится долг ${som(impact.debtSom)}`
        : ''
  if (impact.marks === 0) return `Абонемент останется${debt}`
  return `Абонемент останется: по нему ${marksLabel(impact.marks)}${debt}`
}

/** «12 ур · 3 200», «60 ч за октябрь · 7 400» — the subscription of a payment, for the dialogs. */
export function packageLabel(p: Pick<PaymentRow, 'subscription'>): string {
  const s = p.subscription
  return s.hours_total
    ? `${formatHours(s.hours_total)} ч${s.period_month ? ` за ${monthAccusative(s.period_month)}` : ''} · ${formatSom(s.price_final)}`
    : `${s.lessons_total} ур · ${formatSom(s.price_final)}`
}
