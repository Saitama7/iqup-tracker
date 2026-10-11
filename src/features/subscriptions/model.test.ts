import { describe, expect, it } from 'vitest'
import type { TariffTerms } from '@/features/tariffs/current'
import { defaultDiscount, discountAvailability, priceFinal, quoteSubscription } from './model'

const tariffs: TariffTerms[] = [
  { group_type: 'group', valid_from: '2025-09-01', lessons_in_package: 12, package_price: 3000 },
  { group_type: 'group', valid_from: '2026-09-01', lessons_in_package: 12, package_price: 3200 },
  {
    group_type: 'afterschool',
    valid_from: '2026-09-01',
    lessons_in_package: 20,
    package_price: 7400,
  },
]

describe('priceFinal', () => {
  it('15 % of the 3 200 tariff gives 2 720 (issue #8)', () => {
    expect(priceFinal(3200, 15)).toBe(2720)
  })

  it('5 % «приведи друга» and no discount', () => {
    expect(priceFinal(3200, 5)).toBe(3040)
    expect(priceFinal(3200, 0)).toBe(3200)
  })

  it('rounds to whole som', () => {
    expect(priceFinal(3800, 15)).toBe(3230)
    expect(priceFinal(4400, 5)).toBe(4180)
    expect(priceFinal(3500, 15)).toBe(2975)
    expect(priceFinal(3330, 5)).toBe(3164) // 3163.5 → 3164
  })
})

describe('quoteSubscription', () => {
  it('takes the tariff in effect on the start date', () => {
    expect(quoteSubscription('group', '2026-08-31', tariffs, 0)?.priceFull).toBe(3000)
    const q = quoteSubscription('group', '2026-09-01', tariffs, 15)
    expect(q).toMatchObject({ lessonsTotal: 12, priceFull: 3200, priceFinal: 2720 })
    expect(q?.tariff.valid_from).toBe('2026-09-01')
  })

  it('afterschool is 20 lessons', () => {
    expect(quoteSubscription('afterschool', '2026-10-11', tariffs, 0)).toMatchObject({
      lessonsTotal: 20,
      priceFinal: 7400,
    })
  })

  it('no tariff before the first version', () => {
    expect(quoteSubscription('afterschool', '2026-08-01', tariffs, 0)).toBeNull()
    expect(quoteSubscription('pair', '2026-10-01', tariffs, 0)).toBeNull()
  })
})

describe('discounts (В5)', () => {
  const avail = (h: Parameters<typeof discountAvailability>[0]) =>
    Object.fromEntries(discountAvailability(h).map((o) => [o.pct, o.available]))

  it('a new student pays the full price', () => {
    const h = { isReturning: false, subscriptions: [], friendsBrought: 0 }
    expect(avail(h)).toEqual({ 0: true, 5: false, 15: false })
    expect(defaultDiscount(h)).toBe(0)
  })

  it('15 % only on the first subscription of a returning student', () => {
    const first = { isReturning: true, subscriptions: [], friendsBrought: 0 }
    expect(avail(first)[15]).toBe(true)
    expect(defaultDiscount(first)).toBe(15)
    const second = { ...first, subscriptions: [{ discount_reason: 'returning' as const }] }
    expect(avail(second)[15]).toBe(false)
    expect(discountAvailability(second)[2]?.hint).toBe('только на первый абонемент')
  })

  it('5 % once per friend brought', () => {
    const one = { isReturning: false, subscriptions: [], friendsBrought: 1 }
    expect(avail(one)[5]).toBe(true)
    expect(defaultDiscount(one)).toBe(5)
    const used = { ...one, subscriptions: [{ discount_reason: 'referral' as const }] }
    expect(avail(used)[5]).toBe(false)
    expect(avail({ ...used, friendsBrought: 2 })[5]).toBe(true)
  })

  it('returning wins when both apply — discounts never combine', () => {
    expect(defaultDiscount({ isReturning: true, subscriptions: [], friendsBrought: 1 })).toBe(15)
  })
})
