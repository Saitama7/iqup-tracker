import { formatSom } from '@/features/tariffs/model'

export interface StudentDeletePreview {
  enrollments: number
  active_enrollments: number
  marks: number
  consumed_marks: number
  payments: number
  paid_som: number
  refunded_som: number
  trials: number
  locked_marks: number
  blockers: string[]
}

export const STUDENT_REFUSAL_ACTIVE =
  'Нельзя удалить: у ученика активное зачисление с оплатами или посещениями. Сначала оформите «Ушёл» или «Записан по ошибке» (⋯ у зачисления).'
export const STUDENT_REFUSAL_LOCKED = 'Есть отметки в закрытом периоде — сначала откройте период'

/** Refusal texts for the blockers of student_delete_preview; none — no refusal. */
export function studentRefusals(blockers: readonly string[]): string[] {
  const out: string[] = []
  if (blockers.includes('active_enrollment')) out.push(STUDENT_REFUSAL_ACTIVE)
  if (blockers.includes('locked')) out.push(STUDENT_REFUSAL_LOCKED)
  return out
}

/** «Удалится: 1 зачислений, 12 отметок, 2 оплат на 8 000 сом (возвраты 0 сом), 0 пробных». */
export function studentDeleteSummary(p: StudentDeletePreview): string {
  return `Удалится: ${p.enrollments} зачислений, ${p.marks} отметок, ${p.payments} оплат на ${formatSom(p.paid_som)} сом (возвраты ${formatSom(p.refunded_som)} сом), ${p.trials} пробных`
}

export const studentDeletedText = (name: string) => `Ученик удалён: ${name}`
