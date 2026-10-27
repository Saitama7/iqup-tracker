// Subscription terms at enrollment — 01-domain-model.md §3, 05-decisions В4–В6.
// Pure: the RPC enroll_student (0007) applies the same rules and is the authority.
import { tariffFor, type GroupType, type TariffTerms } from '@/features/tariffs/current'
import { pluralRu } from '@/features/lessons/select'
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
  /** The size by default (К11: individual — the tariff's hours in lessons of the group). */
  defaultLessons: number
  /** Length of one lesson of the group, minutes (И88). */
  minutes: number
  /** The price of `lessonsTotal` lessons by the tariff. */
  defaultPrice: number
  /** The admin typed the price (К12) — it is kept when the size changes. */
  customPrice: boolean
  priceFull: number
  priceFinal: number
}

/** A tariff with its lesson length — the rows of `tariffsQuery` (`lesson_duration_min`). */
type PackageTariff = TariffTerms & { lesson_duration_min?: number }

/** Subscription size bounds (И89): 1 … 2 × lessons_in_package — the RPCs refuse anything else. */
export const maxSubscriptionLessons = (tariff: TariffTerms): number => 2 * tariff.lessons_in_package

/** Minutes of the group's lesson (И88): its own length, else the tariff's. */
export const lessonMinutes = (tariff: PackageTariff, groupMinutes?: number | null): number =>
  groupMinutes ?? tariff.lesson_duration_min ?? 60

/**
 * Default size (subscription_default_lessons, 0033). Individual (К11): the package is
 * lessons_in_package hours — 12 h of 1,5-h lessons = 8, of 2-h = 6; other types — the package.
 */
export function defaultLessons(tariff: TariffTerms, minutes: number): number {
  if (tariff.group_type !== 'individual') return tariff.lessons_in_package
  return Math.min(
    maxSubscriptionLessons(tariff),
    Math.max(1, Math.round((tariff.lessons_in_package * 60) / minutes)),
  )
}

/** Size chips of «Уроков» (И89): the package, 8 and 4 (2 and 1 lesson a week), the default (К11). */
export function lessonSizePresets(
  tariff: TariffTerms,
  byDefault = tariff.lessons_in_package,
): number[] {
  return [...new Set([tariff.lessons_in_package, 8, 4, byDefault])]
    .filter((n) => n <= maxSubscriptionLessons(tariff))
    .sort((a, b) => b - a)
}

/** Price of a package of `lessons` lessons — the same lesson price (И89): 7 200 / 12 × 8 = 4 800. */
export function sizedPackagePrice(tariff: TariffTerms, lessons: number): number {
  return Math.round((tariff.package_price * lessons) / tariff.lessons_in_package)
}

/**
 * Default price (subscription_default_price, 0033): individual (К11) — the hour price × the lesson
 * length × lessons (7 200 / 12 h × 1,5 h × 8 = 7 200); other types — И89.
 */
export function defaultPackagePrice(tariff: TariffTerms, minutes: number, lessons: number): number {
  if (tariff.group_type !== 'individual') return sizedPackagePrice(tariff, lessons)
  return Math.round((tariff.package_price * minutes * lessons) / (tariff.lessons_in_package * 60))
}

/** A typed price (К12): a whole 1 … 1 000 000 сом; null — by the tariff. */
export const priceValid = (price: number | null): boolean =>
  price === null || (Number.isInteger(price) && price >= 1 && price <= MAX_PRICE)

export const MAX_PRICE = 1_000_000

/**
 * Subscription terms on `startDate`: the group's tariff in effect that day (price fixed at start).
 * `lessons` — the size chosen at purchase (И89); null / out of 1 … 2 × package — the default size.
 * `groupMinutes` — the group's own lesson length (И88); `price` — the admin's price (К12).
 */
export function quoteSubscription<T extends PackageTariff>(
  groupType: GroupType,
  startDate: string,
  tariffs: readonly T[],
  pct: number,
  lessons: number | null = null,
  terms: { groupMinutes?: number | null; price?: number | null } = {},
): Quote<T> | null {
  const tariff = tariffFor(groupType, startDate, tariffs)
  if (!tariff) return null
  const minutes = lessonMinutes(tariff, terms.groupMinutes)
  const byDefault = defaultLessons(tariff, minutes)
  const size =
    lessons !== null &&
    Number.isInteger(lessons) &&
    lessons >= 1 &&
    lessons <= maxSubscriptionLessons(tariff)
      ? lessons
      : byDefault
  const defaultPrice = defaultPackagePrice(tariff, minutes, size)
  const price = terms.price ?? null
  const customPrice = price !== null && priceValid(price)
  const priceFull = customPrice ? price : defaultPrice
  return {
    tariff,
    lessonsTotal: size,
    defaultLessons: byDefault,
    minutes,
    defaultPrice,
    customPrice,
    priceFull,
    priceFinal: priceFinal(priceFull, pct),
  }
}

/** «8 занятий по 1,5 ч = 12 ч · 900 за занятие» — individual only (К11); null for other types. */
export function hoursCaption(
  q: Pick<Quote<TariffTerms>, 'tariff' | 'lessonsTotal' | 'minutes' | 'priceFull'>,
): string | null {
  if (q.tariff.group_type !== 'individual') return null
  const h = (m: number) => String(Math.round((m / 60) * 100) / 100).replace('.', ',')
  // formatSom of tariffs/model — not imported: this module stays free of the client (integration tests)
  const lesson = String(Math.round(q.priceFull / q.lessonsTotal)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    '\u00a0',
  )
  return `${q.lessonsTotal} ${pluralRu(q.lessonsTotal, ['занятие', 'занятия', 'занятий'])} по ${h(q.minutes)} ч = ${h(q.minutes * q.lessonsTotal)} ч · ${lesson} за занятие`
}

/** «Цена, сом» (К12): null — by the tariff. */
export const subscriptionPrice = z
  .number({ error: 'Цена — целое число сом' })
  .int('Цена — целое число сом')
  .min(1, 'Цена — от 1 сом')
  .max(MAX_PRICE, 'Цена — не больше 1 000 000 сом')
  .nullable()

/** «Уроков» of a new package (И89): 1 … 48 here, the RPC checks 1 … 2 × lessons_in_package. */
export const subscriptionLessons = z
  .number({ error: 'Уроков — целое число' })
  .int('Уроков — целое число')
  .min(1, 'Уроков — от 1')
  .max(48, 'Слишком много уроков')
  .nullable()

/** «price must be 1 … 1000000» (0033) → words. */
export const priceErrorMessage = 'Цена абонемента — от 1 до 1 000 000 сом'

/** «lessons must be 1 … 24» (subscription_size_price, 0030) → «Уроков в абонементе — от 1 до 24». */
export const lessonsErrorMessage = (m: string): string =>
  `Уроков в абонементе — от 1 до ${/(\d+)\s*$/.exec(m)?.[1] ?? '24'}`
