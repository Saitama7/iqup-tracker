// #73: undo actions for a group — change the teacher from a date, delete an empty group.
// Admin-only RPCs of 0020; the database checks every rule, the texts here only explain refusals.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { GroupsApiError } from './api'

export function teacherChangeErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Учителя группы меняет администратор'
  if (error.code === '23514' && m.includes('closed period'))
    return 'С этой даты есть занятия в закрытом периоде — выберите дату позже'
  if (error.code === '23514' && m.includes('in the future'))
    return 'Дата смены учителя — не позже сегодня'
  if (error.code === '23503') return 'Группа или учитель не найдены'
  return 'Не удалось сменить учителя. Проверьте интернет и попробуйте ещё раз.'
}

const previewRow = z.object({
  lessons_total: z.number().int(),
  lessons_held: z.number().int(),
  lessons_locked: z.number().int(),
})
export type TeacherPreview = { total: number; held: number; locked: number }

export const teacherPreviewKey = (groupId: string, teacherId: string, from: string) =>
  ['group-teacher-preview', groupId, teacherId, from] as const

export const teacherPreviewQuery = (groupId: string, teacherId: string, from: string) =>
  queryOptions({
    queryKey: teacherPreviewKey(groupId, teacherId, from),
    queryFn: async (): Promise<TeacherPreview> => {
      const { data, error } = await supabase.rpc('change_group_teacher_preview', {
        p_group_id: groupId,
        p_teacher_id: teacherId,
        p_from: from,
      })
      if (error) throw new GroupsApiError(teacherChangeErrorMessage(error))
      const row = z.array(previewRow).parse(data)[0]
      return {
        total: row?.lessons_total ?? 0,
        held: row?.lessons_held ?? 0,
        locked: row?.lessons_locked ?? 0,
      }
    },
  })

export async function changeGroupTeacher(groupId: string, teacherId: string, from: string) {
  const { data, error } = await supabase.rpc('change_group_teacher', {
    p_group_id: groupId,
    p_teacher_id: teacherId,
    p_from: from,
  })
  if (error) throw new GroupsApiError(teacherChangeErrorMessage(error))
  const row = z
    .array(z.object({ lessons_moved: z.number().int(), lessons_held: z.number().int() }))
    .parse(data)[0]
  return { moved: row?.lessons_moved ?? 0, held: row?.lessons_held ?? 0 }
}
