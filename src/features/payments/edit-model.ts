// #92 · «Удалить оплату» / «Изменить оплату» (Г10): what deleting a row does — the same rules as
// delete_payment (0026), the debt from balance.ts on the enrollment's rows without that payment. Pure.
import { formatHours, monthAccusative } from '@/features/afterschool/model'
import { pluralRu } from '@/features/lessons/select'
import { formatDateRu } from '@/lib/time'
import { subscriptionBalances, type BalanceSubscription, type SubscriptionBalance } from './balance'
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

const ddmm = (s: Pick<ImpactSubscription, 'started_at'>) => formatDateRu(s.started_at).slice(0, 5)
const startOf = (s: Pick<ImpactSubscription, 'started_at'>) => `абонемент с ${ddmm(s)}`

/** Current balances of the enrollment's subscriptions, by id. */
function balancesOf(
  subs: readonly ImpactSubscription[],
  moved?: { from: string; to: string; id: string; amount: number },
) {
  const list = subscriptionBalances(
    subs.map((s) => {
      let payments = s.payments
      if (moved && s.id === moved.from) payments = payments.filter((p) => p.id !== moved.id)
      if (moved && s.id === moved.to)
        payments = [...payments, { id: moved.id, amount: moved.amount }]
      return { ...s, paid: payments.reduce((n, p) => n + p.amount, 0) }
    }),
  )
  return new Map(list.map((b) => [b.subscriptionId, b]))
}

type Owing = { state: 'paid' } | { state: 'debt' | 'short'; som: number }

/** debt — lessons «в долг» or nothing paid; short — paid in part; paid — all of it (И94 wording). */
function owing(b: SubscriptionBalance | undefined): Owing {
  if (!b || b.priceFinal <= 0) return { state: 'paid' }
  if (b.debtLessons > 0) return { state: 'debt', som: b.debtSom }
  if (b.paidSom <= 0) return { state: 'debt', som: b.priceFinal }
  if (b.paidLessons < b.lessonsTotal) return { state: 'short', som: b.priceFinal - b.paidSom }
  return { state: 'paid' }
}

const owingLabel = (o: Owing) =>
  o.state === 'paid'
    ? 'оплачен'
    : `${o.state === 'debt' ? 'долг' : 'не хватает'} ${formatSom(o.som)}`

/**
 * «Абонемент» of «Изменить оплату» (#119): the enrollment's subscriptions but refunded, oldest first,
 * signed by their current state (#122) — «· долг 7 400», «· не хватает 2 400», «· оплачен», own «(сейчас)».
 */
export function moveTargets(
  subs: readonly ImpactSubscription[],
  own: string,
): { id: string; label: string }[] {
  const balances = balancesOf(subs)
  return subs
    .filter((s) => s.id === own || s.status !== 'refunded')
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((s) => ({
      id: s.id,
      label: `${startOf(s)} · ${s.hours ? `${formatHours(s.lessons_total)} ч` : `${s.lessons_total} ур`} · ${formatSom(s.price_final)} · ${owingLabel(owing(balances.get(s.id)))}${s.id === own ? ' (сейчас)' : ''}`,
    }))
}

/**
 * «Похоже, оплата не на тот абонемент» (#122): the oldest other live subscription not fully paid,
 * unless a subscription that owes is already chosen. null — nothing to suggest.
 */
export function moveHint(
  subs: readonly ImpactSubscription[],
  own: string,
  chosen: string,
): { id: string; text: string; button: string } | null {
  const balances = balancesOf(subs)
  const owes = (s: ImpactSubscription) => {
    const b = balances.get(s.id)
    // an exhausted package was closed by a transfer / «ушёл» — only a real debt counts there
    return !!b && (b.debtLessons > 0 || (s.status === 'active' && b.paidLessons < b.lessonsTotal))
  }
  const current = subs.find((s) => s.id === chosen)
  if (current && current.id !== own && owes(current)) return null
  const target = subs
    .filter((s) => s.id !== own && s.status !== 'refunded' && owes(s))
    .sort((a, b) => a.started_at.localeCompare(b.started_at))[0]
  const b = target && balances.get(target.id)
  if (!target || !b) return null
  const o = owing(b)
  const what =
    o.state === 'paid'
      ? ''
      : b.debtLessons > 0
        ? `долг ${target.hours ? `${formatHours(b.debtLessons)} ч` : `${b.debtLessons} ур.`} · ${formatSom(o.som)}`
        : `${o.state === 'debt' ? 'долг' : 'не хватает'} ${formatSom(o.som)}`
  return {
    id: target.id,
    text: `Абонемент с ${ddmm(target)} ${b.paidSom > 0 ? 'оплачен не полностью' : 'не оплачен'}${what ? ` (${what})` : ''}. Перенести эту оплату на него?`,
    button: `Перенести на ${startOf(target)}`,
  }
}

/**
 * The line under «Абонемент» when another one is chosen (#122): «Оплата перейдёт на абонемент с 22.09 —
 * долг по нему 1 480; абонемент с 29.10 останется оплачен». null — the payment stays where it is.
 */
export function moveImpactText(
  subs: readonly ImpactSubscription[],
  own: string,
  chosen: string,
  paymentId: string,
  amount: number,
): string | null {
  const from = subs.find((s) => s.id === own)
  const to = subs.find((s) => s.id === chosen)
  if (!from || !to || from.id === to.id) return null
  const after = balancesOf(subs, { from: own, to: chosen, id: paymentId, amount })
  const t = owing(after.get(to.id))
  const f = owing(after.get(from.id))
  const target =
    t.state === 'paid'
      ? 'он будет оплачен'
      : t.state === 'debt'
        ? `долг по нему ${formatSom(t.som)}`
        : `по нему не хватит ${formatSom(t.som)}`
  const source =
    f.state === 'paid'
      ? `${startOf(from)} останется оплачен`
      : f.state === 'debt'
        ? `по абонементу с ${ddmm(from)} будет долг ${formatSom(f.som)}`
        : `по абонементу с ${ddmm(from)} не хватит ${formatSom(f.som)}`
  return `Оплата перейдёт на ${startOf(to)} — ${target}; ${source}`
}

/** «12 ур · 3 200», «60 ч за октябрь · 7 400» — the subscription of a payment, for the dialogs. */
export function packageLabel(p: Pick<PaymentRow, 'subscription'>): string {
  const s = p.subscription
  return s.hours_total
    ? `${formatHours(s.hours_total)} ч${s.period_month ? ` за ${monthAccusative(s.period_month)}` : ''} · ${formatSom(s.price_final)}`
    : `${s.lessons_total} ур · ${formatSom(s.price_final)}`
}
