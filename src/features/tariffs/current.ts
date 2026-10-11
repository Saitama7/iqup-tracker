// Tariff in effect on a date — 01-domain-model.md §3, 05-decisions В6 (history by valid_from).
// Pure: callers pass the rows they already have, nothing here reads the database.
import type { Database } from '@/lib/supabase/types.gen'

export type GroupType = Database['public']['Enums']['group_type']

export const GROUP_TYPES: readonly GroupType[] = [
  'group',
  'mini',
  'pair',
  'individual',
  'afterschool',
]

export interface TariffTerms {
  group_type: GroupType
  valid_from: string
  lessons_in_package: number
  package_price: number
}

/**
 * The tariff of `groupType` in effect on `date` (`YYYY-MM-DD`): the latest `valid_from <= date`.
 * A version planned for a later date never changes the price of earlier lessons.
 */
export function tariffFor<T extends Pick<TariffTerms, 'group_type' | 'valid_from'>>(
  groupType: GroupType,
  date: string,
  tariffs: readonly T[],
): T | null {
  let found: T | null = null
  for (const t of tariffs) {
    if (t.group_type !== groupType || t.valid_from > date) continue
    if (!found || t.valid_from > found.valid_from) found = t
  }
  return found
}

/** Full price of one lesson: package_price / lessons_in_package (discounts never apply, А1.1). */
export function lessonPrice(t: Pick<TariffTerms, 'lessons_in_package' | 'package_price'>): number {
  return t.package_price / t.lessons_in_package
}

/** Teacher's pay per student per lesson at `percent` — «Учителю 45 % / 50 %», whole som. */
export function teacherShare(
  t: Pick<TariffTerms, 'lessons_in_package' | 'package_price'>,
  percent: number,
): number {
  return Math.round((lessonPrice(t) * percent) / 100)
}
