import { z } from 'zod'
import { monthNom } from '@/features/payroll/model'
import { formatSom } from '@/features/tariffs/model'
import { firstName } from './model'

/** One row of group_payroll_impact / student_payroll_impact: what a teacher loses in a month. */
export const impactRowSchema = z.object({
  teacher_id: z.uuid(),
  teacher_name: z.string(),
  month: z.string(),
  marks: z.number().int(),
  amount: z.number().int(),
})
export type ImpactRow = z.output<typeof impactRowSchema>

export const deleteReasonSchema = z
  .string()
  .trim()
  .min(1, 'Укажите причину')
  .max(500, 'Причина — не длиннее 500 символов')

/** «учителю Гульзат −1 050 сом за сентябрь» per row with a loss; none — []. */
export function payrollImpactLines(rows: readonly ImpactRow[]): string[] {
  return rows
    .filter((r) => r.amount > 0)
    .map(
      (r) =>
        `учителю ${firstName(r.teacher_name)} −${formatSom(r.amount)} сом за ${monthNom(r.month.slice(0, 7)).toLowerCase()}`,
    )
}

/** Postgres error of delete_group / delete_student (0028) → admin-facing text. */
export function deleteErrorMessage(
  error: { code?: string; message?: string },
  what: 'group' | 'student',
): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Удалять может только администратор'
  if (m.includes('reason is required')) return 'Укажите причину'
  if (m.includes('reason is too long')) return 'Причина — не длиннее 500 символов'
  if (error.code === 'P0002' || m.includes('not found'))
    return what === 'group' ? 'Группа уже удалена — обновите страницу' : 'Ученик уже удалён'
  if (m.includes('locked')) return 'Есть данные в закрытом периоде — сначала откройте период'
  if (m.includes('payments')) return 'В группе есть оплаты — удалить нельзя, архивируйте группу'
  if (m.includes('active_enrollment'))
    return 'У ученика активное зачисление — сначала оформите «Ушёл» или «Записан по ошибке»'
  if (error.code === '23514') return 'Удалить уже нельзя — обновите страницу'
  return what === 'group'
    ? 'Не удалось удалить группу. Проверьте интернет и попробуйте ещё раз.'
    : 'Не удалось удалить ученика. Проверьте интернет и попробуйте ещё раз.'
}
