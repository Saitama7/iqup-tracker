// #94 · «Изменить» / «Вернуть в воронку» a trial for the admin (update_trial / reopen_trial, 0028 §8).
// The database decides and checks everything; the errors are shown under the form, no optimistic update.
import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'
import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types.gen'
import { TRIAL_SOURCES, type Trial, type TrialStatus } from './model'

/** Postgres error of update_trial / reopen_trial / trials_guard → Russian text. */
export function editTrialErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (m.includes('reason is required')) return 'Укажите причину'
  if (m.includes('reason is too long')) return 'Причина — не длиннее 500 символов'
  if (m.includes('keeps its lesson')) return 'Занятие решённого пробного не меняется'
  if (m.includes('planned lesson today or later'))
    return 'Выберите запланированное занятие сегодня или позже'
  if (m.includes('must have taken place')) return 'Выберите прошедшее занятие'
  if (m.includes('archived')) return 'Группа в архиве'
  if (m.includes('is not closed')) return 'Пробное уже не закрыто — обновите страницу'
  if (m.includes('name must be')) return 'Имя — от 1 до 200 символов'
  if (m.includes('note is too long')) return 'Заметка — не длиннее 500 символов'
  if (error.code === '23505') return 'Этот человек уже записан на это занятие'
  if (error.code === '42501') return 'Недостаточно прав'
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

export class TrialEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrialEditError'
  }
}

const fail = (error: { code?: string; message?: string }): never => {
  throw new TrialEditError(editTrialErrorMessage(error))
}

const reasonField = z
  .string()
  .trim()
  .min(1, { error: 'Укажите причину' })
  .max(500, { error: 'Причина — не длиннее 500 символов' })

/** Form of «Изменить пробное»; empty lessonId = keep the lesson (p_lesson_id null). */
export const editTrialForm = z.object({
  trialId: z.uuid(),
  fullName: z
    .string()
    .trim()
    .min(1, { error: 'Введите имя' })
    .max(200, { error: 'Имя — не длиннее 200 символов' }),
  grade: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number().int().min(1).max(11).nullable()),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null
      try {
        return normalizePhone(v)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Телефон родителя: 0XXX XXX XXX' })
        return z.NEVER
      }
    }),
  source: z.union([z.enum(TRIAL_SOURCES), z.literal('')]).transform((v) => (v === '' ? null : v)),
  note: z.string().trim().max(500, { error: 'Заметка — не длиннее 500 символов' }),
  lessonId: z.union([z.uuid(), z.literal('')]).transform((v) => (v === '' ? null : v)),
  reason: reasonField,
})

export type EditTrialInput = z.output<typeof editTrialForm>

export async function updateTrial(input: EditTrialInput): Promise<void> {
  // the generated Args are not nullable, the function takes null (clear the value / keep the lesson)
  const args = {
    p_trial_id: input.trialId,
    p_full_name: input.fullName,
    p_grade: input.grade,
    p_parent_phone: input.phone,
    p_source: input.source,
    p_note: input.note,
    p_lesson_id: input.lessonId,
    p_reason: input.reason,
  } as unknown as Database['public']['Functions']['update_trial']['Args']
  const { error } = await supabase.rpc('update_trial', args)
  if (error) fail(error)
}

export const reopenTrialForm = z.object({ trialId: z.uuid(), reason: reasonField })

export type ReopenTrialInput = z.output<typeof reopenTrialForm>

const reopenedStatus = z.enum(['scheduled', 'attended', 'no_show'])

/** Returns the status the closed trial went back to. */
export async function reopenTrial(
  input: ReopenTrialInput,
): Promise<'scheduled' | 'attended' | 'no_show'> {
  const { data, error } = await supabase.rpc('reopen_trial', {
    p_trial_id: input.trialId,
    p_reason: input.reason,
  })
  if (error) fail(error)
  return reopenedStatus.parse(data)
}

/** Where a closed trial lands (mirrors reopen_trial; the toast uses the status the RPC returns). */
export function reopenTarget(
  t: Pick<Trial, 'came' | 'lessonDate' | 'lessonStatus'>,
  today: string,
): 'scheduled' | 'attended' | 'no_show' {
  if (t.came) return 'attended'
  if (t.came === null && t.lessonStatus === 'planned' && t.lessonDate >= today) return 'scheduled'
  return 'no_show'
}

export const REOPEN_LABEL: Record<'scheduled' | 'attended' | 'no_show', string> = {
  attended: 'был на пробном → «Оплатил → зачислить»',
  no_show: 'не пришёл → «Позвонить»',
  scheduled: 'занятие впереди → «Записан»',
}

/** Which lessons the picker offers: planned ahead, took place, or none (a decided trial keeps it). */
export function lessonPickerKind(status: TrialStatus): 'ahead' | 'past' | null {
  if (status === 'scheduled') return 'ahead'
  if (status === 'attended' || status === 'no_show') return 'past'
  return null
}
