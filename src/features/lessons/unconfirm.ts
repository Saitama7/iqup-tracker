// #95 · «Отменить проведение» (admin): the dialog's texts — pure, from the sheet and
// lesson_payroll_impact (0027).
import { firstName } from '@/features/students/model'
import { monthNom } from '@/features/payroll/model'
import { formatSom } from '@/features/tariffs/model'
import { formatDateRu } from '@/lib/time'
import { pluralRu } from './select'

/** What the lesson's teacher loses (lesson_payroll_impact). */
export interface LessonPayrollImpact {
  teacherName: string
  /** Consumed marks («был» + «не был»). */
  marks: number
  /** The drop of the month's payroll, сом. */
  amount: number
}

/**
 * «Отметки 6 учеников будут удалены: учителю Гульзат −1 050 сом за октябрь»;
 * nothing accrued — «…: начислений по занятию нет».
 */
export function unconfirmImpactText(
  marks: number,
  impact: LessonPayrollImpact,
  lessonDate: string,
): string {
  const effect =
    impact.amount > 0
      ? `учителю ${firstName(impact.teacherName)} −${formatSom(impact.amount)} сом за ${monthNom(lessonDate.slice(0, 7)).toLowerCase()}`
      : 'начислений по занятию нет'
  if (marks === 0) return `Отметок у занятия нет, ${effect}`
  return `Отметки ${marks} ${pluralRu(marks, ['ученика', 'учеников', 'учеников'])} будут удалены: ${effect}`
}

/** «Запросы учителя на исправление (1) будут отклонены»; none — null. */
export const unconfirmRequestsText = (pending: number): string | null =>
  pending > 0 ? `Запросы учителя на исправление (${pending}) будут отклонены` : null

/** «Проведение отменено: 8 класс А · 14.10». */
export const unconfirmDoneText = (groupName: string, lessonDate: string) =>
  `Проведение отменено: ${groupName} · ${formatDateRu(lessonDate).slice(0, 5)}`

/** Postgres error of unconfirm_lesson → admin-facing text (0027). */
export function unconfirmErrorReason(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Отменить проведение может только администратор'
  if (m.includes('reason is required')) return 'Укажите причину'
  if (m.includes('reason is too long')) return 'Причина — не длиннее 500 символов'
  if (m.includes('closed period')) return 'Период закрыт — сначала откройте период'
  if (m.includes('is not held')) return 'Занятие уже не проведено — обновите страницу'
  return 'Не удалось отменить проведение. Проверьте интернет и попробуйте ещё раз.'
}
