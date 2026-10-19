// #94 · «Изменить занятие» (admin): update_lesson + its payroll preview lesson_edit_payroll_impact (0028 §5).
// The database decides and checks everything; the errors are shown under the form, no optimistic update.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { monthNom } from '@/features/payroll/model'
import { firstName } from '@/features/students/model'
import { formatSom } from '@/features/tariffs/model'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'

/** Postgres error of update_lesson / lesson_edit_payroll_impact / lessons_guard → Russian text. */
export function editLessonErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (!error.code) return 'Нет связи с сервером — проверьте интернет'
  if (m.includes('reason is required')) return 'Укажите причину'
  if (m.includes('reason is too long')) return 'Причина — не длиннее 500 символов'
  if (m.includes('cannot move to the future'))
    return 'Проведённое занятие нельзя перенести в будущее'
  if (m.includes('keeps its date and duration'))
    return 'У занятия продлёнки есть часы — дата и длительность не меняются. Отмените проведение и проведите заново'
  if (m.includes('is not enrolled in the group'))
    return 'На новую дату в группе не все отмеченные ученики — выберите другую дату'
  if (m.includes('payroll month') && m.includes('closed'))
    return 'Месяц ЗП закрыт — сначала откройте период'
  if (m.includes('closed period')) return 'Период закрыт — сначала откройте период'
  if (m.includes('is cancelled')) return 'Отменённое занятие не меняется'
  if (m.includes('duration must be')) return 'Длительность — от 15 до 600 минут'
  if (m.includes('date, time and teacher')) return 'Укажите дату, время и учителя'
  if (m.includes('teacher') && m.includes('not found')) return 'Учитель не найден'
  if (m.includes('lesson') && m.includes('not found'))
    return 'Занятие не найдено — обновите страницу'
  if (error.code === '42501') return 'Изменить занятие может только администратор'
  if (error.code === 'PGRST202' || error.code === '42883')
    return 'Сервер не обновлён — сообщите администратору'
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

export class EditLessonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditLessonError'
  }
}

const fail = (error: { code?: string; message?: string }): never => {
  throw new EditLessonError(editLessonErrorMessage(error))
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** «9:00» / «09:00» / «09:00:00» → «09:00:00»; anything else — null. */
export function parseTimeInput(input: string): string | null {
  const m = TIME_RE.exec(input.trim().slice(0, 5).replace(/:$/, ''))
  return m?.[1] && m[2] ? `${m[1].padStart(2, '0')}:${m[2]}:00` : null
}

export const editLessonForm = z.object({
  lessonId: z.uuid(),
  date: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const iso = parseDateRu(v)
      if (!iso) ctx.addIssue({ code: 'custom', message: 'Дата: ДД.ММ.ГГГГ' })
      return iso ?? z.NEVER
    }),
  start: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const t = parseTimeInput(v)
      if (!t) ctx.addIssue({ code: 'custom', message: 'Время начала: ЧЧ:ММ' })
      return t ?? z.NEVER
    }),
  durationMin: z
    .string()
    .trim()
    .transform((v) => Number(v))
    .pipe(
      z
        .number({ error: 'Длительность — число минут' })
        .int({ error: 'Длительность — целое число минут' })
        .min(15, { error: 'Длительность — от 15 до 600 минут' })
        .max(600, { error: 'Длительность — от 15 до 600 минут' }),
    ),
  teacherId: z.uuid({ error: 'Выберите учителя' }),
  substituteId: z.union([z.uuid(), z.literal('')]).transform((v) => (v === '' ? null : v)),
  reason: z
    .string()
    .trim()
    .min(1, { error: 'Укажите причину' })
    .max(500, { error: 'Причина — не длиннее 500 символов' }),
})
export type EditLessonInput = z.output<typeof editLessonForm>

export async function updateLesson(input: EditLessonInput): Promise<void> {
  const { error } = await supabase.rpc('update_lesson', {
    p_lesson_id: input.lessonId,
    p_date: input.date,
    p_start: input.start,
    p_duration_min: input.durationMin,
    p_teacher_id: input.teacherId,
    // the generated Args are not nullable, the function takes null (no substitute)
    p_substitute_teacher_id: input.substituteId as string,
    p_reason: input.reason,
  })
  if (error) fail(error)
}

export interface EditImpactRow {
  teacherId: string
  teacherName: string
  /** First day of the month, ISO. */
  month: string
  /** Change of the teacher's payroll for the month, сом (±). */
  amount: number
}

const impactSchema = z.array(
  z.object({
    teacher_id: z.uuid(),
    teacher_name: z.string(),
    month: z.string(),
    amount: z.number().int(),
  }),
)

/** Who gains / loses what if the held lesson moves to `date` / `teacherId` (admin only). */
export const lessonEditImpactQuery = (lessonId: string, date: string, teacherId: string) =>
  queryOptions({
    queryKey: ['lesson-edit-impact', lessonId, date, teacherId],
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<EditImpactRow[]> => {
      const { data, error } = await supabase.rpc('lesson_edit_payroll_impact', {
        p_lesson_id: lessonId,
        p_date: date,
        p_teacher_id: teacherId,
      })
      if (error) return fail(error)
      return impactSchema.parse(data).map((r) => ({
        teacherId: r.teacher_id,
        teacherName: r.teacher_name,
        month: r.month,
        amount: r.amount,
      }))
    },
  })

/** «Гульзат −1 050 сом за октябрь», «Айжан +1 050 сом за октябрь»; zero rows are dropped. */
export function impactLines(rows: readonly EditImpactRow[]): string[] {
  return rows
    .filter((r) => r.amount !== 0)
    .map((r) => {
      const sign = r.amount > 0 ? '+' : '−'
      const month = monthNom(r.month.slice(0, 7)).toLowerCase()
      return `${firstName(r.teacherName)} ${sign}${formatSom(Math.abs(r.amount))} сом за ${month}`
    })
}
