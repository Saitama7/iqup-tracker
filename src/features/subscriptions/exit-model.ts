// #81: words and dates of the «⋯» dialogs of an enrollment (transfer / left / mistake). The numbers come
// from the database (enrollment_settlement, transfer_preview, enrollment_payroll_impact, 0024).
import { pluralRu } from '@/features/lessons/select'
import { groupLabel, firstName, type GroupBrief } from '@/features/students/model'
import { formatLessonPrice, formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import type { PayrollImpact, Settlement, TransferPreview } from './exit-api'

const LESSONS = ['урок', 'урока', 'уроков'] as const

const som = (n: number) => `${formatSom(n)} сом`

/** Active groups other than the current one, any type — «Математика · 8 класс А · Мини-группа». */
export function exitTargets(groups: readonly GroupBrief[], from: GroupBrief | null) {
  return groups
    .filter((g) => g.id !== from?.id && g.status !== 'archived')
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), 'ru'))
}

export const targetLabel = (g: GroupBrief) => `${groupLabel(g)} · ${GROUP_TYPE_LABEL[g.group_type]}`

/** «учителю Гульзат −1 050 сом за 3 урока». */
export const impactCaption = (i: PayrollImpact) =>
  `учителю ${firstName(i.teacherName)} −${som(i.amount)} за ${i.lessons} ${pluralRu(i.lessons, LESSONS)}`

export interface MoneyLine {
  label: string
  value: string
  tone?: 'debt' | 'left'
}

/** Оплачено / Отучено N × цена / Остаток (или Долг) — the money of an enrollment. */
export function settlementLines(s: Settlement): MoneyLine[] {
  const price = s.lessonPrice !== null ? ` × ${formatLessonPrice(s.lessonPrice, true)}` : ''
  return [
    { label: 'Оплачено', value: som(s.paidSom) },
    {
      label: 'Отучено',
      value: `${s.lessonsUsed} ${pluralRu(s.lessonsUsed, LESSONS)}${price} = ${som(s.usedSom)}`,
    },
    s.remainder < 0
      ? { label: 'Долг', value: som(-s.remainder), tone: 'debt' }
      : { label: 'Остаток', value: som(s.remainder), tone: 'left' },
  ]
}

/** «3 800 − 1 800 = 2 000 сом» / «3 800 + долг 600 = 4 400 сом» — to pay in the new group. */
export function toPayCaption(p: TransferPreview): string {
  if (p.price === null) return 'Нет тарифа на эту дату'
  if (p.remainder === 0) return som(p.price)
  if (p.remainder < 0)
    return `${formatSom(p.price)} + долг ${formatSom(-p.remainder)} = ${som(p.toPay)}`
  return `${formatSom(p.price)} − ${formatSom(Math.min(p.remainder, p.price))} = ${som(p.toPay)}`
}

/** The last day in the group: not before the start and the last «был» / «не был». */
export const withdrawMinDate = (startDate: string, lastMarkDate: string | null) =>
  lastMarkDate && lastMarkDate > startDate ? lastMarkDate : startDate

/** Default last day — today, or the minimum when today is earlier. */
export const withdrawDefaultDate = (today: string, min: string) => (today > min ? today : min)

/** What «Записан по ошибке» deletes: «3 отметки «был», 1 «не был», 2 «заморожен»». */
export function marksCaption(s: Settlement): string | null {
  const parts = [
    s.present > 0 ? `«был» — ${s.present}` : null,
    s.burned > 0 ? `«не был» — ${s.burned}` : null,
    s.frozen > 0 ? `«заморожен» — ${s.frozen}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Отметки: ${parts.join(', ')}` : null
}
