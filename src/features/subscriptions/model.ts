// Subscription terms at enrollment — 01-domain-model.md §3, 05-decisions В4–В6.
// Pure: the RPC enroll_student (0007) applies the same rules and is the authority.
import { tariffFor, type GroupType, type TariffTerms } from '@/features/tariffs/current'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/types.gen'

export type DiscountReason = Database['public']['Enums']['discount_reason']
export type DiscountPct = 0 | 5 | 15

export interface DiscountOption {
  pct: DiscountPct
  reason: DiscountReason
  label: string
}

/** The only discounts (В5): 15 % returning — first subscription; 5 % — the one who brought a friend. */
export const DISCOUNTS: readonly DiscountOption[] = [
  { pct: 0, reason: 'none', label: 'Без скидки' },
  { pct: 5, reason: 'referral', label: '5 % · привёл друга' },
  { pct: 15, reason: 'returning', label: '15 % · бывший ученик' },
]

export const discountByPct = (pct: DiscountPct): DiscountOption =>
  DISCOUNTS.find((d) => d.pct === pct) ?? { pct: 0, reason: 'none', label: 'Без скидки' }

/** price_final = round(price_full × (1 − discount)); payroll always uses the full price (А1.1). */
export function priceFinal(priceFull: number, pct: number): number {
  return Math.round((priceFull * (100 - pct)) / 100)
}

export interface DiscountHistory {
  isReturning: boolean
  /** All subscriptions the student ever had, any group. */
  subscriptions: { discount_reason: DiscountReason }[]
  /** Students with referred_by_student_id = this student. */
  friendsBrought: number
}

export interface DiscountAvailability {
  pct: DiscountPct
  available: boolean
  /** Why it is off — shown under the disabled option. */
  hint: string | null
}

/** Which of 0 / 5 / 15 % the student may get on the next subscription. */
export function discountAvailability(h: DiscountHistory): DiscountAvailability[] {
  const referralUsed = h.subscriptions.filter((s) => s.discount_reason === 'referral').length
  const referral = h.friendsBrought > referralUsed
  const returning = h.isReturning && h.subscriptions.length === 0
  return [
    { pct: 0, available: true, hint: null },
    {
      pct: 5,
      available: referral,
      hint: referral
        ? null
        : h.friendsBrought === 0
          ? 'никого не привёл'
          : 'скидка за друга уже использована',
    },
    {
      pct: 15,
      available: returning,
      hint: returning ? null : h.isReturning ? 'только на первый абонемент' : 'не бывший ученик',
    },
  ]
}

/** Preselected discount: the one the student is entitled to, 15 % first (they never combine). */
export function defaultDiscount(h: DiscountHistory): DiscountPct {
  const options = discountAvailability(h)
  if (options.find((o) => o.pct === 15)?.available) return 15
  if (options.find((o) => o.pct === 5)?.available) return 5
  return 0
}

export interface Quote<T extends TariffTerms> {
  tariff: T
  lessonsTotal: number
  priceFull: number
  priceFinal: number
}

/** Subscription size bounds (И89): 1 … 2 × lessons_in_package — the RPCs refuse anything else. */
export const maxSubscriptionLessons = (tariff: TariffTerms): number => 2 * tariff.lessons_in_package

/** Size chips of «Уроков» (И89): the tariff's package, 8 and 4 (2 and 1 lesson a week), then «другое». */
export function lessonSizePresets(tariff: TariffTerms): number[] {
  return [...new Set([tariff.lessons_in_package, 8, 4])].filter(
    (n) => n <= maxSubscriptionLessons(tariff),
  )
}

/** Price of a package of `lessons` lessons — the same lesson price (И89): 7 200 / 12 × 8 = 4 800. */
export function sizedPackagePrice(tariff: TariffTerms, lessons: number): number {
  return Math.round((tariff.package_price * lessons) / tariff.lessons_in_package)
}

/**
 * Subscription terms on `startDate`: the group's tariff in effect that day (price fixed at start).
 * `lessons` — the size chosen at purchase (И89); null / out of 1 … 2 × package — the tariff's package.
 */
export function quoteSubscription<T extends TariffTerms>(
  groupType: GroupType,
  startDate: string,
  tariffs: readonly T[],
  pct: number,
  lessons: number | null = null,
): Quote<T> | null {
  const tariff = tariffFor(groupType, startDate, tariffs)
  if (!tariff) return null
  const size =
    lessons !== null &&
    Number.isInteger(lessons) &&
    lessons >= 1 &&
    lessons <= maxSubscriptionLessons(tariff)
      ? lessons
      : tariff.lessons_in_package
  const priceFull = sizedPackagePrice(tariff, size)
  return { tariff, lessonsTotal: size, priceFull, priceFinal: priceFinal(priceFull, pct) }
}

/** «Уроков» of a new package (И89): 1 … 48 here, the RPC checks 1 … 2 × lessons_in_package. */
export const subscriptionLessons = z
  .number({ error: 'Уроков — целое число' })
  .int('Уроков — целое число')
  .min(1, 'Уроков — от 1')
  .max(48, 'Слишком много уроков')
  .nullable()

/** «lessons must be 1 … 24» (subscription_size_price, 0030) → «Уроков в абонементе — от 1 до 24». */
export const lessonsErrorMessage = (m: string): string =>
  `Уроков в абонементе — от 1 до ${/(\d+)\s*$/.exec(m)?.[1] ?? '24'}`
