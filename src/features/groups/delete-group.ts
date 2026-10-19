import { formatSom } from '@/features/tariffs/model'

export interface GroupDeletePreview {
  lessons: number
  held_lessons: number
  marks: number
  enrollments: number
  trials: number
  payments: number
  payments_som: number
  blockers: string[]
}

/** Refusal texts for the blockers of group_delete_preview; none — the group can go. */
export function groupRefusals(
  p: Pick<GroupDeletePreview, 'blockers' | 'payments' | 'payments_som'>,
) {
  const out: string[] = []
  if (p.blockers.includes('payments'))
    out.push(
      `Нельзя удалить: в группе оплаты учеников на ${formatSom(p.payments_som)} сом (${p.payments} платежей). Деньги учеников не удаляются молча — переведите учеников в другую группу («⋯ → Перевести» у ученика) или архивируйте группу.`,
    )
  if (p.blockers.includes('locked'))
    out.push('Есть занятия в закрытом периоде — сначала откройте период на «Расчёт ЗП»')
  return out
}

/** «Удалится: 24 занятий (8 проведённых), 40 отметок, 5 зачислений, 1 пробных». */
export function groupDeleteSummary(p: GroupDeletePreview): string {
  return `Удалится: ${p.lessons} занятий (${p.held_lessons} проведённых), ${p.marks} отметок, ${p.enrollments} зачислений, ${p.trials} пробных`
}

export const groupDeletedText = (name: string) => `Группа удалена: ${name}`
