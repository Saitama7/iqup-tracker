// А9 / А9а data: straight to Postgres. RLS — everyone reads, admin writes; guard 0006 keeps
// tariffs in effect and past holidays unchanged whatever the client sends.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import { GROUP_TYPES, tariffFor, type GroupType } from './current'
import type { SettingsSource, Tariff } from './model'

const groupTypeSchema = z.enum(GROUP_TYPES as [GroupType, ...GroupType[]])

const tariffSchema = z.object({
  id: z.uuid(),
  group_type: groupTypeSchema,
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
  max_students: z.number().int(),
  lesson_duration_min: z.number().int(),
  freeze_limit: z.number().int(),
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

const priceField = z
  .string()
  .trim()
  .transform((v) => Number(v.replace(/\s/g, '')))
  .pipe(
    z
      .number({ error: 'Цена — целое число сом' })
      .int('Цена — целое число сом')
      .positive('Цена должна быть больше нуля'),
  )

/** «Запланировать новый тариф с даты…»: one date for every group type, strictly after today. */
export const planTariffsForm = (today: string) =>
  z.object({
    validFrom: dateField.refine((d) => d > today, 'Новый тариф — только с будущей даты'),
    prices: z.object(
      Object.fromEntries(GROUP_TYPES.map((t) => [t, priceField])) as Record<
        GroupType,
        typeof priceField
      >,
    ),
  })

export type PlanTariffsInput = z.output<ReturnType<typeof planTariffsForm>>

/** «+ Добавить» праздник: today or later (a past day is history — guard 0006). */
export const holidayForm = (today: string) =>
  z.object({
    day: dateField.refine((d) => d >= today, 'Прошедшую дату добавить нельзя'),
    name: z.string().trim().min(1, 'Введите название').max(100, 'Слишком длинное название'),
  })

export type HolidayInput = z.output<ReturnType<typeof holidayForm>>

// ─── Writes ─────────────────────────────────────────────────────────────────

export class SettingsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsApiError'
  }
}

function fail(error: { code?: string }, messages: Record<string, string>): never {
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
      valid_from: input.validFrom,
    }
  })
}

export async function planTariffs(input: PlanTariffsInput, tariffs: readonly Tariff[]) {
  const { error } = await supabase.from('tariffs').insert(planRows(input, tariffs))
  if (error) {
    fail(error, {
      '23505': 'С этой даты тариф уже запланирован — удалите его в истории и создайте заново',
      '23514': 'Новый тариф — только с будущей даты',
      '42501': 'Менять тарифы может только администратор',
    })
  }
}

/** Removes a planned version (all its rows). A version in effect is refused by the guard. */
export async function deleteTariffVersion(validFrom: string) {
  const { error } = await supabase.from('tariffs').delete().eq('valid_from', validFrom)
  if (error) {
    fail(error, {
      '23514': 'Тариф уже действует — его можно только заменить новой версией',
      '23503': 'По этой версии уже куплены абонементы',
    })
  }
}

export async function addHoliday(input: HolidayInput) {
  const { error } = await supabase.from('holidays').insert(input)
  if (error) {
    fail(error, {
      '23505': 'Этот день уже в списке',
      '23514': 'Прошедшую дату добавить нельзя',
      '42501': 'Праздники ведёт администратор',
    })
  }
}

export async function deleteHolidays(days: readonly string[]) {
  const { error } = await supabase.from('holidays').delete().in('day', days)
  if (error) fail(error, { '23514': 'Прошедший праздник удалить нельзя' })
}
