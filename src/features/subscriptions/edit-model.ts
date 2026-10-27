// #109 · «Изменить абонемент» (К12, И90): the words of the preview. Pure — the numbers come from
// subscription_update_preview / subscription_balance_preview (0033).
import { pluralRu } from '@/features/lessons/select'
import { formatSom } from '@/features/tariffs/model'
import { MONTHS_NOM } from '@/lib/time'

/** One teacher × month of the held lessons charged to the package. */
export interface PayrollPreview {
  teacherId: string
  teacherName: string
  /** YYYY-MM-DD, the 1st. */
  month: string
  marks: number
  /** One mark's pay before / after, whole сом. */
  markBefore: number
  markAfter: number
  /** The month's accrued payroll (v_payroll_preview.base_amount) before / after. */
  amountBefore: number
  amountAfter: number
}

export interface BalancePreview {
  lessonsTotal: number
  priceFinal: number
  paidSom: number
  lessonsUsed: number
  lessonsLeft: number
  debtLessons: number
  debtSom: number
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatSom(Math.abs(n))}`
const LESSONS = ['урок', 'урока', 'уроков'] as const
const first = (name: string) => name.split(/\s+/)[0] ?? name

/** «Айпери: сентябрь 300 → 450 за занятие, +150 × 8 = +1 200 сом». */
export function payrollLine(r: PayrollPreview): string {
  const month = (MONTHS_NOM[Number(r.month.slice(5, 7)) - 1] ?? '').toLowerCase()
  const delta = r.amountAfter - r.amountBefore
  return `${first(r.teacherName)}: ${month} ${formatSom(r.markBefore)} → ${formatSom(r.markAfter)} за занятие, ${signed(r.markAfter - r.markBefore)} × ${r.marks} = ${signed(delta)} сом`
}

/** «Оплачено 5 400 из 5 400 · остаток 2 урока» / «… · долг 2 урока · 1 200 сом». */
export function balanceLine(b: BalancePreview): string {
  const paid = `Оплачено ${formatSom(b.paidSom)} из ${formatSom(b.priceFinal)}`
  if (b.debtLessons > 0)
    return `${paid} · долг ${b.debtLessons} ${pluralRu(b.debtLessons, LESSONS)}${b.debtSom > 0 ? ` · ${formatSom(b.debtSom)} сом` : ''}`
  const left = Math.max(0, b.lessonsLeft)
  return `${paid} · остаток ${left} ${pluralRu(left, LESSONS)}`
}

/** «12 уроков · 7 200» — the package in short. */
export const termsCaption = (lessons: number, price: number) =>
  `${lessons} ${pluralRu(lessons, LESSONS)} · ${formatSom(price)}`
