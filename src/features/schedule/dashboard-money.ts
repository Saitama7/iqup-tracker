// А1 / АМ1 money tiles (#132): «Долги и „пора оплачивать“» from the А5 rows (same filter as
// «Не оплатили», И75) and «Оплат сегодня» from the А7 month payments.
import type { PaymentRow } from '@/features/payments/api'
import { monthPrep, paidOnDate, totals } from '@/features/payments/model'
import { pluralRu } from '@/features/lessons/select'
import { payCounts, shortName, type StudentListRow } from '@/features/students/model'
import { listDebtCaption } from '@/features/students/pay-view'
import { formatSom } from '@/features/tariffs/model'

/** «Долги» list shows this many debtors, the rest behind «и ещё N →». */
export const DEBTORS_SHOWN = 5

export interface DebtSummary {
  debt: number
  soon: number
  debtSom: number
  /** payState = debt, the biggest debt first. */
  debtors: StudentListRow[]
}

export function debtSummary(rows: readonly StudentListRow[]): DebtSummary {
  const counts = payCounts(rows)
  const debtors = rows
    .filter((r) => r.payState === 'debt')
    .sort((a, b) => b.debtSom - a.debtSom || a.fullName.localeCompare(b.fullName, 'ru'))
  return {
    debt: counts.debt,
    soon: counts.soon,
    debtSom: debtors.reduce((t, r) => t + r.debtSom, 0),
    debtors,
  }
}

/** А1 value «5 · 11» — debtors · ending soon (payState soon). */
export const debtTileValue = (s: Pick<DebtSummary, 'debt' | 'soon'>) => `${s.debt} · ${s.soon}`

/** А1 caption «долг 2 933 сом · 11 заканчивают». */
export const debtTileCaption = (s: Pick<DebtSummary, 'debtSom' | 'soon'>) =>
  `долг ${formatSom(s.debtSom)} сом · ${s.soon} заканчивают`

/** «Айжан Б. · Математика · 8 класс А · долг 2 ур. · 534 сом». */
export const debtorLine = (
  r: Pick<StudentListRow, 'fullName' | 'groups' | 'debtLessons' | 'debtHours' | 'debtSom'>,
) =>
  [shortName(r.fullName), r.groups, listDebtCaption(r.debtLessons, r.debtHours, r.debtSom)]
    .filter(Boolean)
    .join(' · ')

/** «и ещё 3 →» — null when every debtor is shown. */
export const debtorsMore = (debtors: readonly unknown[]) =>
  debtors.length > DEBTORS_SHOWN ? `и ещё ${debtors.length - DEBTORS_SHOWN} →` : null

const PAYMENTS = ['платёж', 'платежа', 'платежей'] as const

export interface TodayPayments {
  total: number
  payments: number
  monthTotal: number
}

/** Σ payments (not refunds, not transfers — `totals`) paid today in Bishkek, and of the month. */
export function todayPayments(monthRows: readonly PaymentRow[], today: string): TodayPayments {
  const day = totals(monthRows.filter((p) => paidOnDate(p.paid_at) === today))
  return { total: day.total, payments: day.payments, monthTotal: totals(monthRows).total }
}

/** «3 платежа · в октябре 148 200». */
export const todayPaymentsCaption = (t: TodayPayments, today: string) =>
  `${t.payments} ${pluralRu(t.payments, PAYMENTS)} · в ${monthPrep(today.slice(0, 7))} ${formatSom(t.monthTotal)}`
