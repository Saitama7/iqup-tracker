// #95 · «Отменить проведение»: admin RPCs of 0027 — the payroll preview and the unconfirm itself.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { unconfirmErrorReason, type LessonPayrollImpact } from './unconfirm'

const impactSchema = z.array(
  z.object({
    teacher_id: z.uuid(),
    teacher_name: z.string(),
    marks: z.number().int(),
    amount: z.number().int(),
  }),
)

/** What the lesson's teacher loses if the lesson goes back to planned (lesson_payroll_impact). */
export const lessonPayrollImpactQuery = (lessonId: string) =>
  queryOptions({
    queryKey: ['lesson-payroll-impact', lessonId],
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<LessonPayrollImpact | null> => {
      const { data, error } = await supabase.rpc('lesson_payroll_impact', {
        p_lesson_id: lessonId,
      })
      if (error) throw new Error(unconfirmErrorReason(error))
      const row = impactSchema.parse(data)[0]
      return row ? { teacherName: row.teacher_name, marks: row.marks, amount: row.amount } : null
    },
  })

export const unconfirmForm = z.object({
  lessonId: z.uuid(),
  reason: z.string().trim().min(1, 'Укажите причину').max(500, 'Причина — не длиннее 500 символов'),
})
export type UnconfirmInput = z.output<typeof unconfirmForm>

export async function unconfirmLesson(input: UnconfirmInput): Promise<void> {
  const { error } = await supabase.rpc('unconfirm_lesson', {
    p_lesson_id: input.lessonId,
    p_reason: input.reason,
  })
  if (error) throw new Error(unconfirmErrorReason(error))
}
