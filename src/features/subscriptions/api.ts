// Enrollment + first subscription: one RPC (enroll_student, 0007) — one transaction, admin only,
// tariff and discount rules checked in the database whatever the client sends.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import { discountByPct, lessonsErrorMessage, subscriptionLessons } from './model'

const tariffTermsSchema = z.object({
  group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
  valid_from: z.string(),
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
  freeze_limit: z.number().int(),
  lesson_duration_min: z.number().int(),
  /** After-school price per hour (#82); null — package / (lessons × h). */
  hour_price: z.number().int().nullable(),
})

export type TariffRow = z.infer<typeof tariffTermsSchema>

/** Every tariff version — the enrollment form picks the one in effect on the start date. */
export const tariffsQuery = () =>
  queryOptions({
    queryKey: ['tariffs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tariffs')
        .select(
          'group_type, valid_from, lessons_in_package, package_price, freeze_limit, lesson_duration_min, hour_price',
        )
        .order('valid_from')
      if (error) throw error
      return z.array(tariffTermsSchema).parse(data)
    },
  })

// ─── Form input ─────────────────────────────────────────────────────────────

/** «Зачислить в группу»: group, start date (ДД.ММ.ГГГГ), discount 0 / 5 / 15, package size (И89). */
export const enrollForm = (groupStart: string | null) =>
  z.object({
    studentId: z.uuid({ error: 'Выберите ученика' }),
    groupId: z.uuid({ error: 'Выберите группу' }),
    startDate: z.string().transform((v, ctx) => {
      const iso = parseDateRu(v)
      if (!iso) {
        ctx.addIssue({ code: 'custom', message: 'Дата в формате ДД.ММ.ГГГГ' })
        return z.NEVER
      }
      if (groupStart && iso < groupStart) {
        ctx.addIssue({ code: 'custom', message: 'Дата начала — не раньше старта группы' })
        return z.NEVER
      }
      return iso
    }),
    discount: z.union([z.literal(0), z.literal(5), z.literal(15)]),
    /** «Уроков» (И89); null — the tariff's package; after-school ignores it. */
    lessons: subscriptionLessons.default(null),
  })

export type EnrollInput = z.output<ReturnType<typeof enrollForm>> & {
  /** After-school: hours per ISO weekday (#82); absent — the default plan. */
  plan?: number[]
}

// ─── RPC ────────────────────────────────────────────────────────────────────

export class EnrollError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnrollError'
  }
}

const resultSchema = z.array(z.object({ enrollment_id: z.uuid(), subscription_id: z.uuid() }))

/** Postgres error → admin-facing text; the RPC raises one code per rule (0007). */
export function enrollErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Зачислять может только администратор'
  if (error.code === '23505') return 'Ученик уже зачислен в эту группу'
  if (error.code === '23514') {
    if (m.includes('outside the group dates')) return 'Дата начала — вне дат группы'
    if (m.includes('archived')) return 'Группа в архиве'
    if (m.includes('15 %')) return '15 % — только на первый абонемент бывшего ученика'
    if (m.includes('5 %')) return '5 % — один абонемент за каждого приведённого друга'
    if (m.includes('no tariff')) return 'На эту дату нет тарифа для группы'
    if (m.includes('lessons must be')) return lessonsErrorMessage(m)
    if (m.includes('no planned hours'))
      return 'По графику нет часов ни в этом, ни в следующем месяце'
    if (m.includes('no hours') || m.includes('hours must'))
      return 'График: часы хотя бы на один день (0,5–4 ч)'
    return 'Проверьте дату и скидку'
  }
  return 'Не удалось зачислить. Проверьте интернет и попробуйте ещё раз.'
}

export async function enrollStudent(input: EnrollInput) {
  const discount = discountByPct(input.discount)
  const { data, error } = await supabase.rpc('enroll_student', {
    p_student_id: input.studentId,
    p_group_id: input.groupId,
    p_start_date: input.startDate,
    p_discount_pct: discount.pct,
    p_discount_reason: discount.reason,
    ...(input.plan ? { p_plan: input.plan } : {}),
    p_lessons: input.lessons ?? undefined,
  })
  if (error) throw new EnrollError(enrollErrorMessage(error))
  const row = resultSchema.parse(data)[0]
  if (!row) throw new EnrollError('Не удалось зачислить. Попробуйте ещё раз.')
  return { enrollmentId: row.enrollment_id, subscriptionId: row.subscription_id }
}

/** Postgres error of set_enrollment_start (0017) → admin-facing text. */
export function enrollmentStartErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Дату зачисления меняет администратор'
  if (error.code === '23505') return 'На эти даты у ученика уже есть другое зачисление в эту группу'
  if (error.code === '23514') {
    if (m.includes('outside the group dates'))
      return 'Дата — вне дат группы (раньше её старта или позже окончания)'
    if (m.includes('after the enrollment end')) return 'Дата позже окончания зачисления'
    if (m.includes('attendance before'))
      return 'Раньше этой даты у ученика уже есть отметки в группе — перенести позже нельзя'
    return 'Проверьте дату'
  }
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

/** «Изменить дату зачисления» (#60): the subscription that started with the enrollment follows. */
export async function setEnrollmentStart(enrollmentId: string, startDate: string) {
  const { error } = await supabase.rpc('set_enrollment_start', {
    p_enrollment_id: enrollmentId,
    p_start_date: startDate,
  })
  if (error) throw new EnrollError(enrollmentStartErrorMessage(error))
}
