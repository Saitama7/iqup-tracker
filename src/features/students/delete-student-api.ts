import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { deleteErrorMessage, deleteReasonSchema, impactRowSchema } from './delete-impact'

const previewSchema = z.object({
  enrollments: z.number().int(),
  active_enrollments: z.number().int(),
  marks: z.number().int(),
  consumed_marks: z.number().int(),
  payments: z.number().int(),
  paid_som: z.number().int(),
  refunded_som: z.number().int(),
  trials: z.number().int(),
  locked_marks: z.number().int(),
  blockers: z.array(z.string()),
})

export const studentDeletePreviewQuery = (studentId: string) =>
  queryOptions({
    queryKey: ['student-delete-preview', studentId],
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const [preview, impact] = await Promise.all([
        supabase.rpc('student_delete_preview', { p_student_id: studentId }),
        supabase.rpc('student_payroll_impact', { p_student_id: studentId }),
      ])
      if (preview.error) throw new Error(deleteErrorMessage(preview.error, 'student'))
      if (impact.error) throw new Error(deleteErrorMessage(impact.error, 'student'))
      const row = z.array(previewSchema).parse(preview.data)[0]
      if (!row) throw new Error('Ученик уже удалён')
      return { preview: row, impact: z.array(impactRowSchema).parse(impact.data) }
    },
  })

export const deleteStudentForm = z.object({ studentId: z.uuid(), reason: deleteReasonSchema })
export type DeleteStudentInput = z.output<typeof deleteStudentForm>

export async function deleteStudent(input: DeleteStudentInput): Promise<void> {
  const { error } = await supabase.rpc('delete_student', {
    p_student_id: input.studentId,
    p_reason: input.reason,
  })
  if (error) throw new Error(deleteErrorMessage(error, 'student'))
}
