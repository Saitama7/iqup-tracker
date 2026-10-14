import { describe, expect, it } from 'vitest'
import {
  dayHours,
  defaultPlan,
  formatPlan,
  formatQuote,
  invoiceQuote,
  isoWeekday,
  monthAccusative,
  monthPrepositional,
  monthQuote,
  nextMonth,
  planOn,
  tariffHourPrice,
  validPlan,
} from './model'

// March 2002 (as in supabase/tests/afterschool_hours.test.sql): 1 March is a Friday, 8 March a holiday.
function weekdaysOf(month: string, skip: string[] = []): string[] {
  const out: string[] = []
  const [y, m] = month.split('-').map(Number)
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d))
    if (date.getUTCMonth() !== (m ?? 1) - 1) break
    const iso = date.toISOString().slice(0, 10)
    if (isoWeekday(iso) <= 5 && !skip.includes(iso)) out.push(iso)
  }
  return out
}

const MON2_WED1_FRI2 = [2, 0, 1, 0, 2, 0, 0]
const MARCH = weekdaysOf('2002-03', ['2002-03-08'])

describe('weekdays and months', () => {
  it('isoWeekday', () => {
    expect(isoWeekday('2002-03-01')).toBe(5)
    expect(isoWeekday('2002-03-04')).toBe(1)
    expect(isoWeekday('2026-10-18')).toBe(7)
  })
  it('nextMonth wraps the year', () => {
    expect(nextMonth('2026-10-01')).toBe('2026-11-01')
    expect(nextMonth('2026-12-01')).toBe('2027-01-01')
  })
  it('month names', () => {
    expect(monthPrepositional('2026-10-01')).toBe('октябре')
    expect(monthAccusative('2026-11-01')).toBe('ноябрь')
  })
})

describe('plan', () => {
  it('validPlan: 7 values, 0 … 4 h step 0,5, some hours', () => {
    expect(validPlan(MON2_WED1_FRI2)).toBe(true)
    expect(validPlan([0.5, 0, 0, 0, 0, 0, 0])).toBe(true)
    expect(validPlan([5, 0, 0, 0, 0, 0, 0])).toBe(false)
    expect(validPlan([0.3, 0, 0, 0, 0, 0, 0])).toBe(false)
    expect(validPlan([0, 0, 0, 0, 0, 0, 0])).toBe(false)
    expect(validPlan([1, 1, 1])).toBe(false)
  })
  it('defaultPlan: group weekdays × tariff duration, no schedule → Mon–Fri', () => {
    expect(defaultPlan([1, 3, 5], 180)).toEqual([3, 0, 3, 0, 3, 0, 0])
    expect(defaultPlan([], 180)).toEqual([3, 3, 3, 3, 3, 0, 0])
  })
  it('planOn: latest valid_from ≤ date, before the first — the first', () => {
    const plans = [
      { valid_from: '2002-03-01', hours: MON2_WED1_FRI2 },
      { valid_from: '2002-03-11', hours: [1, 0, 0, 0, 0, 0, 0] },
    ]
    expect(planOn(plans, '2002-03-04')).toEqual(MON2_WED1_FRI2)
    expect(planOn(plans, '2002-03-11')).toEqual([1, 0, 0, 0, 0, 0, 0])
    expect(planOn(plans, '2002-02-01')).toEqual(MON2_WED1_FRI2)
    expect(planOn([], '2002-03-01')).toBeNull()
  })
  it('dayHours: null without a plan, 0 on a day off', () => {
    const plans = [{ valid_from: '2002-03-01', hours: MON2_WED1_FRI2 }]
    expect(dayHours(plans, '2002-03-04')).toBe(2)
    expect(dayHours(plans, '2002-03-05')).toBe(0)
    expect(dayHours([], '2002-03-05')).toBeNull()
  })
  it('formatPlan', () => {
    expect(formatPlan(MON2_WED1_FRI2)).toBe('ПН 2 · СР 1 · ПТ 2 ч')
    expect(formatPlan([1.5, 0, 0, 0, 0, 0, 0])).toBe('ПН 1,5 ч')
  })
})

describe('monthQuote (afterschool_month_quote)', () => {
  const plans = [{ valid_from: '2002-03-01', hours: MON2_WED1_FRI2 }]

  it('ПН 2 / СР 1 / ПТ 2 in March 2002 with the 8 March holiday → 20 h over 12 days', () => {
    const q = monthQuote(MARCH, plans, '2002-03-01', '2002-03-01')
    expect(q.rows).toEqual([
      { weekday: 1, hours: 2, days: 4 },
      { weekday: 3, hours: 1, days: 4 },
      { weekday: 5, hours: 2, days: 4 },
    ])
    expect(q.hours).toBe(20)
    expect(q.days).toBe(12)
    expect(formatQuote(q)).toBe('ПН 2 ч × 4 + СР 1 ч × 4 + ПТ 2 ч × 4 = 20 ч')
  })

  it('from a mid-month start date, other months and duplicates ignored', () => {
    const q = monthQuote(
      [...MARCH, '2002-03-18', '2002-04-01', '2002-02-25'],
      plans,
      '2002-03-01',
      '2002-03-18',
    )
    expect(q.hours).toBe(10)
  })

  it('up to the enrollment end', () => {
    expect(monthQuote(MARCH, plans, '2002-03-01', '2002-03-01', '2002-03-06').hours).toBe(2 + 2 + 1)
  })

  it('a plan change mid-month splits a weekday', () => {
    const changed = [...plans, { valid_from: '2002-03-18', hours: [1, 0, 1, 0, 2, 0, 0] }]
    const q = monthQuote(MARCH, changed, '2002-03-01', '2002-03-01')
    expect(q.rows).toEqual([
      { weekday: 1, hours: 1, days: 2 },
      { weekday: 1, hours: 2, days: 2 },
      { weekday: 3, hours: 1, days: 4 },
      { weekday: 5, hours: 2, days: 4 },
    ])
    expect(q.hours).toBe(18)
  })

  it('no plan → no hours', () => {
    expect(monthQuote(MARCH, [], '2002-03-01', '2002-03-01')).toEqual({
      rows: [],
      hours: 0,
      days: 0,
    })
    expect(formatQuote({ rows: [], hours: 0 })).toBe('0 ч')
  })
})

describe('invoice', () => {
  it('tariffHourPrice: hour_price, else package / (lessons × h) — 7 400 / 60 h = 123', () => {
    expect(
      tariffHourPrice({ package_price: 7400, lessons_in_package: 20, lesson_duration_min: 180 }),
    ).toBe(123)
    expect(
      tariffHourPrice({
        package_price: 7400,
        lessons_in_package: 20,
        lesson_duration_min: 180,
        hour_price: 130,
      }),
    ).toBe(130)
  })

  it('21 h × 123 = 2 583 (the issue example)', () => {
    expect(invoiceQuote(21, 0, 123, 0)).toMatchObject({
      hours: 21,
      priceFull: 2583,
      priceFinal: 2583,
    })
  })

  it('credit of unused hours comes off; at least 0,5 h stays billed', () => {
    expect(invoiceQuote(22, 1, 100, 0)).toMatchObject({ credit: 1, hours: 21, priceFull: 2100 })
    expect(invoiceQuote(2, 5, 100, 0)).toMatchObject({ credit: 1.5, hours: 0.5, priceFull: 50 })
  })

  it('discount В5 on the price for the parent', () => {
    expect(invoiceQuote(10, 0, 100, 15)).toMatchObject({ priceFull: 1000, priceFinal: 850 })
  })
})
