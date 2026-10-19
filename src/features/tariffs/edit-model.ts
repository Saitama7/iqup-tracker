// #94 · Pure helpers of the «Изменить цены» dialog (А9а).
import { GROUP_TYPES, type GroupType } from './current'
import type { TariffVersion } from './model'

export const IN_EFFECT_WARNING =
  'Действующие абонементы не пересчитываются — ЗП по ним не меняется (К6). Новая цена — для новых абонементов.'
export const AFTERSCHOOL_WARNING =
  'Отметки продлёнки без выставленного счёта оцениваются по цене часа на дату (И69) — их ЗП изменится.'

/** The version already applies (valid_from ≤ today); a planned one has no subscriptions yet. */
export const versionInEffect = (v: Pick<TariffVersion, 'validFrom'>, today: string) =>
  v.validFrom <= today

/** Prices as form strings: package price per type + hour price (empty = derived). */
export function versionFormDefaults(v: TariffVersion) {
  const prices = Object.fromEntries(
    GROUP_TYPES.map((t) => [
      t,
      String(v.rows.find((r) => r.type === t)?.after.package_price ?? ''),
    ]),
  ) as Record<GroupType, string>
  const hour = v.rows.find((r) => r.type === 'afterschool')?.after.hour_price
  return { prices, hourPrice: hour == null ? '' : String(hour) }
}

/** Did the afterschool package price or the hour price change against the stored version? */
export function afterschoolChanged(
  v: TariffVersion,
  next: { afterschoolPrice: number; hourPrice: number | null },
): boolean {
  const row = v.rows.find((r) => r.type === 'afterschool')?.after
  if (!row) return false
  return row.package_price !== next.afterschoolPrice || (row.hour_price ?? null) !== next.hourPrice
}
