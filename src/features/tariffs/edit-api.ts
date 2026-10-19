// #94 · Admin edits of tariff versions and holidays: update_tariff_version / delete_tariff_version /
// save_holiday / delete_holidays (0028). The database decides; its errors are mapped to Russian here.
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { GROUP_TYPES, type GroupType } from './current'
import { priceField, SettingsApiError } from './api'

export const reasonField = z
  .string()
  .trim()
  .min(1, 'Укажите причину')
  .max(500, 'Причина — не длиннее 500 символов')

const FALLBACK = 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'

/** Postgres error of the #94 admin RPCs → admin-facing text. */
export function editErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Менять тарифы и праздники может только администратор'
  if (error.code === 'P0002') return 'Запись уже удалена — обновите страницу'
  if (error.code === '23503') {
    return 'По этой версии уже куплены абонементы — удалить нельзя, исправьте цену'
  }
  if (error.code === '23505') return 'Этот день уже в списке'
  if (error.code === '23514') {
    if (m.includes('reason is required')) return 'Укажите причину'
    if (m.includes('reason is too long')) return 'Причина — не длиннее 500 символов'
    if (m.includes('is closed')) {
      return 'Месяц закрыт — сначала откройте период на «Расчёт ЗП»'
    }
    if (m.includes('no earlier version')) return 'Это первая версия тарифа — удалить нельзя'
    if (m.includes('positive')) return 'Цена должна быть больше нуля'
    return 'Проверьте поля формы'
  }
  return FALLBACK
}

// ─── Tariff versions ────────────────────────────────────────────────────────

const hourPriceField = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(priceField.nullable())

/** «Изменить цены»: all five package prices and the hour price (empty — derived from the package). */
export const updateTariffForm = z.object({
  validFrom: z.string(),
  prices: z.object(
    Object.fromEntries(GROUP_TYPES.map((t) => [t, priceField])) as Record<
      GroupType,
      typeof priceField
    >,
  ),
  hourPrice: hourPriceField,
  reason: reasonField,
})
export type UpdateTariffInput = z.output<typeof updateTariffForm>

export const deleteTariffForm = z.object({ validFrom: z.string(), reason: reasonField })
export type DeleteTariffInput = z.output<typeof deleteTariffForm>

export async function updateTariffVersion(input: UpdateTariffInput) {
  const { error } = await supabase.rpc('update_tariff_version', {
    p_valid_from: input.validFrom,
    p_prices: input.prices,
    // generated types say number; the RPC takes null for «derive from the package»
    p_hour_price: input.hourPrice as number,
    p_reason: input.reason,
  })
  if (error) throw new SettingsApiError(editErrorMessage(error))
}

export async function deleteTariffVersion(input: DeleteTariffInput) {
  const { error } = await supabase.rpc('delete_tariff_version', {
    p_valid_from: input.validFrom,
    p_reason: input.reason,
  })
  if (error) throw new SettingsApiError(editErrorMessage(error))
}

// ─── Holidays ───────────────────────────────────────────────────────────────

export interface HolidayImpact {
  planned: number
  restored: number
  held: number
  locked: number
}

const impactSchema = z.object({
  planned: z.number(),
  restored: z.number(),
  held: z.number(),
  locked: z.number(),
})

/** Lessons a holiday on `day` would cancel / its removal bring back. */
export async function holidayLessons(day: string): Promise<HolidayImpact> {
  const { data, error } = await supabase.rpc('holiday_lessons', { p_day: day })
  if (error) throw new SettingsApiError(editErrorMessage(error))
  return impactSchema.parse(data[0] ?? { planned: 0, restored: 0, held: 0, locked: 0 })
}

/** Returns the number of lessons cancelled. */
export async function saveHoliday(input: {
  day: string
  name: string
  reason: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('save_holiday', {
    p_day: input.day,
    p_name: input.name,
    p_reason: input.reason ?? undefined,
  })
  if (error) throw new SettingsApiError(editErrorMessage(error))
  return z.number().parse(data)
}

/** Returns the number of lessons planned again. */
export async function deleteHolidays(input: {
  days: readonly string[]
  reason: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('delete_holidays', {
    p_days: [...input.days],
    p_reason: input.reason ?? undefined,
  })
  if (error) throw new SettingsApiError(editErrorMessage(error))
  return z.number().parse(data)
}

/** «N занятий» with the Russian plural. */
export function lessonsWord(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return `${n} занятий`
  if (mod10 === 1) return `${n} занятие`
  if (mod10 >= 2 && mod10 <= 4) return `${n} занятия`
  return `${n} занятий`
}
