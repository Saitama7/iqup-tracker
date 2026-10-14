// #73: undo of an enrollment made by mistake — remove it, or move it (with its payments) to another
// group of the same type. Admin-only RPCs of 0020; the database checks every rule.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { EnrollError } from './api'

export function removeEnrollmentErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Убирать из группы может только администратор'
  if (error.code === '23514') {
    if (m.includes('present or burned marks'))
      return 'У ученика есть отметки «был» — за них начислена ЗП. Завершите зачисление вместо удаления'
    if (m.includes('closed period')) return 'Есть отметки в закрытом периоде'
    if (m.includes('has payments'))
      return 'Есть оплаты — они не удаляются. Переведите ученика в другую группу того же типа'
    return 'Зачисление нельзя убрать'
  }
  if (error.code === '23503') return 'Зачисление не найдено — обновите страницу'
  return 'Не удалось убрать из группы. Проверьте интернет и попробуйте ещё раз.'
}

export function transferErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Переводить может только администратор'
  if (error.code === '23505') return 'Ученик уже зачислен в выбранную группу'
  if (error.code === '23514') {
    if (m.includes('already in this group')) return 'Ученик уже в этой группе'
    if (m.includes('archived')) return 'Группа в архиве'
    if (m.includes('another type')) return 'Группа другого типа — сначала оформите возврат'
    if (m.includes('present or burned marks'))
      return 'У ученика есть отметки «был» — за них начислена ЗП. Завершите зачисление вместо перевода'
    if (m.includes('closed period')) return 'Есть отметки в закрытом периоде'
    if (m.includes('outside the group dates')) return 'Дата — вне дат выбранной группы'
    if (m.includes('after the enrollment end')) return 'Дата позже окончания зачисления'
    return 'Перевод невозможен. Проверьте группу и дату'
  }
  if (error.code === '23503') return 'Группа или зачисление не найдены — обновите страницу'
  return 'Не удалось перевести. Проверьте интернет и попробуйте ещё раз.'
}

const infoRow = z.object({
  present_marks: z.number().int(),
  burned_marks: z.number().int(),
  frozen_marks: z.number().int(),
  locked_marks: z.number().int(),
  subscriptions: z.number().int(),
  payments: z.number().int(),
  paid_total: z.number().int(),
  trial_id: z.uuid().nullable(),
})

export interface UndoInfo {
  /** «был» + «сгорело»: written off and paid to the teacher — the enrollment cannot be undone. */
  consumed: number
  frozen: number
  locked: number
  subscriptions: number
  payments: number
  paidTotal: number
  hasTrial: boolean
}

export const undoInfoQuery = (enrollmentId: string) =>
  queryOptions({
    queryKey: ['enrollment-undo-info', enrollmentId],
    gcTime: 0,
    queryFn: async (): Promise<UndoInfo> => {
      const { data, error } = await supabase.rpc('enrollment_undo_info', {
        p_enrollment_id: enrollmentId,
      })
      if (error) throw new EnrollError(removeEnrollmentErrorMessage(error))
      const r = z.array(infoRow).parse(data)[0]
      if (!r) throw new EnrollError('Зачисление не найдено — обновите страницу')
      return {
        consumed: r.present_marks + r.burned_marks,
        frozen: r.frozen_marks,
        locked: r.locked_marks,
        subscriptions: r.subscriptions,
        payments: r.payments,
        paidTotal: r.paid_total,
        hasTrial: r.trial_id !== null,
      }
    },
  })

export async function removeEnrollment(enrollmentId: string) {
  const { error } = await supabase.rpc('remove_enrollment', { p_enrollment_id: enrollmentId })
  if (error) throw new EnrollError(removeEnrollmentErrorMessage(error))
}

export async function transferEnrollment(enrollmentId: string, groupId: string, startDate: string) {
  const { data, error } = await supabase.rpc('transfer_enrollment', {
    p_enrollment_id: enrollmentId,
    p_group_id: groupId,
    p_start_date: startDate,
  })
  if (error) throw new EnrollError(transferErrorMessage(error))
  return z.string().parse(data)
}
