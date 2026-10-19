// Subjects reference table (#42, 0013): everyone signed in reads, admin adds, renames and hides.
// Groups point at it by subject_id; selects embed the name as `subject:subjects(name)`.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'

/** Embedded `subject:subjects(name)` of a group → the subject name. */
export const subjectName = z.object({ name: z.string() }).transform((s) => s.name)

const subjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
})

export type Subject = z.output<typeof subjectSchema>

export const SUBJECTS_KEY = ['subjects'] as const

export const subjectsQuery = () =>
  queryOptions({
    queryKey: SUBJECTS_KEY,
    queryFn: async (): Promise<Subject[]> => {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, name, sort_order, is_active')
        .order('sort_order')
        .order('name')
      if (error) throw error
      return z.array(subjectSchema).parse(data)
    },
  })

export const subjectForm = z.object({
  name: z.string().trim().min(1, 'Введите название предмета').max(60, 'Слишком длинное название'),
})

export class SubjectsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubjectsApiError'
  }
}

function fail(error: { code?: string }): never {
  throw new SubjectsApiError(
    error.code === '23505'
      ? 'Такой предмет уже есть'
      : error.code === '42501'
        ? 'Предметы ведёт администратор'
        : error.code === '23514'
          ? 'Проверьте название предмета'
          : 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.',
  )
}

/** New subject goes to the end of the list. */
export async function createSubject(name: string, subjects: readonly Subject[]): Promise<Subject> {
  const sortOrder = Math.max(0, ...subjects.map((s) => s.sort_order)) + 10
  const { data, error } = await supabase
    .from('subjects')
    .insert({ name, sort_order: sortOrder })
    .select('id, name, sort_order, is_active')
    .single()
  if (error) fail(error)
  return subjectSchema.parse(data)
}

export async function updateSubject(id: string, patch: { name?: string; is_active?: boolean }) {
  const { error } = await supabase.from('subjects').update(patch).eq('id', id)
  if (error) fail(error)
}

/** «Удалить» a subject no group uses (delete_subject, #94); a reason goes to the journal. */
export const deleteSubjectForm = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, 'Укажите причину').max(500, 'Причина — не длиннее 500 символов'),
})
export type DeleteSubjectInput = z.output<typeof deleteSubjectForm>

/** Postgres error of delete_subject → admin-facing text. */
export function deleteSubjectErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === '23503') return 'Предмет используется в группах — его можно только скрыть'
  if (error.code === '42501') return 'Предметы ведёт администратор'
  if (error.code === 'P0002') return 'Предмет уже удалён — обновите страницу'
  if (error.code === '23514' && error.message?.includes('reason')) return 'Укажите причину'
  return 'Не удалось удалить. Проверьте интернет и попробуйте ещё раз.'
}

export async function deleteSubject(input: DeleteSubjectInput) {
  const { error } = await supabase.rpc('delete_subject', {
    p_subject_id: input.id,
    p_reason: input.reason,
  })
  if (error) throw new SubjectsApiError(deleteSubjectErrorMessage(error))
}
