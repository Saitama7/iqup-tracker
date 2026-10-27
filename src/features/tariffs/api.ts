// А9 / А9а data: straight to Postgres. RLS — everyone reads, admin writes; guard 0006 keeps
// tariffs in effect and past holidays unchanged whatever the client sends.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { formatDayMonth, parseDateRu } from '@/lib/time'
import { GROUP_TYPES, tariffFor, type GroupType } from './current'
import type { PlanMinDate, SettingsSource, Tariff } from './model'

const groupTypeSchema = z.enum(GROUP_TYPES as [GroupType, ...GroupType[]])

const tariffSchema = z.object({
  id: z.uuid(),
  group_type: groupTypeSchema,
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
  max_students: z.number().int(),
  lesson_duration_min: z.number().int(),
  freeze_limit: z.number().int().nullable(),
  hour_price: z.number().int().nullable(),
  valid_from: z.string(),
  created_at: z.string(),
  created_by: z.uuid().nullable(),
})

const holidaySchema = z.object({ day: z.string(), name: z.string() })

const subscriptionSchema = z.object({
  tariff_id: z.uuid(),
  status: z.enum(['active', 'exhausted', 'refunded']),
})

const authorSchema = z.object({ id: z.uuid(), full_name: z.string() })

export const settingsQuery = () =>
  queryOptions({
    queryKey: ['admin-settings'],
    queryFn: async (): Promise<SettingsSource> => {
      const [tariffs, holidays, subscriptions] = await Promise.all([
        supabase.from('tariffs').select('*').order('valid_from'),
        supabase.from('holidays').select('day, name').order('day'),
        supabase.from('subscriptions').select('tariff_id, status'),
      ])
      if (tariffs.error) throw tariffs.error
      if (holidays.error) throw holidays.error
      if (subscriptions.error) throw subscriptions.error
      const rows = z.array(tariffSchema).parse(tariffs.data)

      const authorIds = [...new Set(rows.flatMap((t) => (t.created_by ? [t.created_by] : [])))]
      let authors: Record<string, string> = {}
      if (authorIds.length > 0) {
        const res = await supabase.from('profiles').select('id, full_name').in('id', authorIds)
        if (res.error) throw res.error
        authors = Object.fromEntries(
          z
            .array(authorSchema)
            .parse(res.data)
            .map((p) => [p.id, p.full_name.split(' ')[0] ?? p.full_name]),
        )
      }

      return {
        tariffs: rows,
        holidays: z.array(holidaySchema).parse(holidays.data),
        subscriptions: z.array(subscriptionSchema).parse(subscriptions.data),
        authors,
      }
    },
  })

// ─── Form input ─────────────────────────────────────────────────────────────

const dateField = z.string().transform((v, ctx) => {
  const iso = parseDateRu(v)
  if (!iso) {
    ctx.addIssue({ code: 'custom', message: 'Дата в формате ДД.ММ.ГГГГ' })
    return z.NEVER
  }
  return iso
})

export const priceField = z
  .string()
  .trim()
  .transform((v) => Number(v.replace(/\s/g, '')))
  .pipe(
    z
      .number({ error: 'Цена — целое число сом' })
      .int('Цена — целое число сом')
      .positive('Цена должна быть больше нуля'),
  )

/** Form error for a date before `min` (planMinDate, К6). */
export const planMinDateMessage = (min: PlanMinDate) =>
  min.paid
    ? `Для действующих групп — не раньше ${formatDayMonth(min.date)}`
    : 'Новый тариф — не раньше сегодняшнего дня'

/** «Запланировать новый тариф с даты…»: one date for every group type, from `min` on (К6). */
export const planTariffsForm = (min: PlanMinDate) =>
  z.object({
    validFrom: dateField.refine((d) => d >= min.date, planMinDateMessage(min)),
    prices: z.object(
      Object.fromEntries(GROUP_TYPES.map((t) => [t, priceField])) as Record<
        GroupType,
        typeof priceField
      >,
    ),
    /** Продлёнка: цена часа (#82); absent — package / (lessons × h). */
    hourPrice: priceField.optional(),
  })

export type PlanTariffsInput = z.output<ReturnType<typeof planTariffsForm>>

/**
 * «+ Добавить» праздник: a past day is allowed (#94) but needs a reason for the journal;
 * today or later does not.
 */
export const holidayForm = (today: string) =>
  z
    .object({
      day: dateField,
      name: z.string().trim().min(1, 'Введите название').max(100, 'Слишком длинное название'),
      reason: z.string().trim().max(500, 'Причина — не длиннее 500 символов').default(''),
    })
    .superRefine((v, ctx) => {
      if (v.day < today && v.reason === '') {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Укажите причину' })
      }
    })
    .transform((v) => ({ ...v, reason: v.reason === '' ? null : v.reason }))

export type HolidayInput = z.output<ReturnType<typeof holidayForm>>

// ─── Writes ─────────────────────────────────────────────────────────────────

export class SettingsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsApiError'
  }
}

export function fail(error: { code?: string }, messages: Record<string, string>): never {
  throw new SettingsApiError(
    (error.code && messages[error.code]) ??
      'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.',
  )
}

/**
 * New tariff set from `validFrom`: one row per group type with the new price; seats, lessons,
 * duration and freezes are carried over from the version in effect on that date.
 */
export function planRows(input: PlanTariffsInput, tariffs: readonly Tariff[]) {
  return GROUP_TYPES.map((type) => {
    const base = tariffFor(type, input.validFrom, tariffs)
    if (!base) throw new SettingsApiError('Нет действующего тарифа, от которого считать новый')
    return {
      group_type: type,
      lessons_in_package: base.lessons_in_package,
      package_price: input.prices[type],
      max_students: base.max_students,
      lesson_duration_min: base.lesson_duration_min,
      freeze_limit: base.freeze_limit,
      hour_price: type === 'afterschool' ? (input.hourPrice ?? null) : null,
      valid_from: input.validFrom,
    }
  })
}

export async function planTariffs(input: PlanTariffsInput, tariffs: readonly Tariff[]) {
  const { error } = await supabase.from('tariffs').insert(planRows(input, tariffs))
  if (error) {
    fail(error, {
      '23505': 'С этой даты тариф уже запланирован — удалите его в истории и создайте заново',
      '23514': 'Дата раньше допустимой: для типов с абонементами — с 1-го числа следующего месяца',
      '42501': 'Менять тарифы может только администратор',
    })
  }
}

/**
 * «Применить с сегодняшнего дня» (#94): К6 «с 1-го числа следующего месяца» is lifted for this
 * version; valid_from is set by the database (plan_tariffs_from_today).
 */
export async function planTariffsFromToday(
  input: PlanTariffsInput,
  tariffs: readonly Tariff[],
  today: string,
) {
  // valid_from is ignored by the RPC (jsonb_to_recordset without that column).
  const rows = planRows({ ...input, validFrom: today }, tariffs)
  const { error } = await supabase.rpc('plan_tariffs_from_today', { p_rows: rows })
  if (error) {
    fail(error, {
      '23505': 'С сегодняшнего дня тариф уже есть — измените его цены в истории',
      '42501': 'Менять тарифы может только администратор',
    })
  }
}
