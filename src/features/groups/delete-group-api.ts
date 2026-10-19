import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import {
  deleteErrorMessage,
  deleteReasonSchema,
  impactRowSchema,
} from '@/features/students/delete-impact'
import { supabase } from '@/lib/supabase/client'

const previewSchema = z.object({
  lessons: z.number().int(),
  held_lessons: z.number().int(),
  marks: z.number().int(),
  consumed_marks: z.number().int(),
  enrollments: z.number().int(),
  trials: z.number().int(),
  payments: z.number().int(),
  payments_som: z.number().int(),
  locked_lessons: z.number().int(),
  blockers: z.array(z.string()),
})

export const groupDeletePreviewQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['group-delete-preview', groupId],
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const [preview, impact] = await Promise.all([
        supabase.rpc('group_delete_preview', { p_group_id: groupId }),
        supabase.rpc('group_payroll_impact', { p_group_id: groupId }),
      ])
      if (preview.error) throw new Error(deleteErrorMessage(preview.error, 'group'))
      if (impact.error) throw new Error(deleteErrorMessage(impact.error, 'group'))
      const row = z.array(previewSchema).parse(preview.data)[0]
      if (!row) throw new Error('Группа уже удалена — обновите страницу')
      return { preview: row, impact: z.array(impactRowSchema).parse(impact.data) }
    },
  })

export const deleteGroupForm = z.object({ groupId: z.uuid(), reason: deleteReasonSchema })
export type DeleteGroupInput = z.output<typeof deleteGroupForm>

export async function deleteGroup(input: DeleteGroupInput): Promise<number> {
  const { data, error } = await supabase.rpc('delete_group', {
    p_group_id: input.groupId,
    p_reason: input.reason,
  })
  if (error) throw new Error(deleteErrorMessage(error, 'group'))
  return z.number().int().parse(data)
}
