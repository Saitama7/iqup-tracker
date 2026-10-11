// Subscription terms at enrollment — 01-domain-model.md §3, 05-decisions В4–В6.
// Pure: the RPC enroll_student (0007) applies the same rules and is the authority.
import { tariffFor, type GroupType, type TariffTerms } from '@/features/tariffs/current'
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

/** Subscription terms on `startDate`: the group's tariff in effect that day (price fixed at start). */
export function quoteSubscription<T extends TariffTerms>(
  groupType: GroupType,
  startDate: string,
  tariffs: readonly T[],
  pct: number,
): Quote<T> | null {
  const tariff = tariffFor(groupType, startDate, tariffs)
  if (!tariff) return null
  return {
    tariff,
    lessonsTotal: tariff.lessons_in_package,
    priceFull: tariff.package_price,
    priceFinal: priceFinal(tariff.package_price, pct),
  }
}
