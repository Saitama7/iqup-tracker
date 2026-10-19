vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { holidayForm, planRows, planTariffsForm } from './api'
import type { Tariff } from './model'

const TODAY = '2026-10-11'
const prices = {
  group: '3 500',
  mini: '4000',
  pair: '4600',
  individual: '7500',
  afterschool: '7800',
}

describe('planTariffsForm', () => {
  // К6: a type with subscriptions → from the 1st of next month
  const form = planTariffsForm({ date: '2026-11-01', paid: true })

  it('accepts a future date and whole prices for every type', () => {
    expect(form.parse({ validFrom: '01.09.2027', prices })).toEqual({
      validFrom: '2027-09-01',
      prices: { group: 3500, mini: 4000, pair: 4600, individual: 7500, afterschool: 7800 },
    })
  })

  it('with subscriptions: from the 1st of next month — not today, not the 31st (К6)', () => {
    for (const validFrom of ['11.10.2026', '31.10.2026', '01.09.2026']) {
      const r = form.safeParse({ validFrom, prices })
      expect(r.error?.issues[0]?.message).toBe('Для действующих групп — не раньше 1 ноября')
    }
    expect(form.safeParse({ validFrom: '01.11.2026', prices }).success).toBe(true)
  })

  it('no subscriptions yet: from today', () => {
    const fresh = planTariffsForm({ date: TODAY, paid: false })
    expect(fresh.safeParse({ validFrom: '11.10.2026', prices }).success).toBe(true)
    expect(fresh.safeParse({ validFrom: '10.10.2026', prices }).error?.issues[0]?.message).toBe(
      'Новый тариф — не раньше сегодняшнего дня',
    )
  })

  it('rejects a bad date', () => {
    expect(form.safeParse({ validFrom: '31.02.2027', prices }).error?.issues[0]?.message).toBe(
      'Дата в формате ДД.ММ.ГГГГ',
    )
  })

  it.each(['0', '-100', '3200,5', 'abc', ''])('rejects price %j', (bad) => {
    expect(
      form.safeParse({ validFrom: '01.09.2027', prices: { ...prices, mini: bad } }).success,
    ).toBe(false)
  })
})

describe('planRows', () => {
  const base: Tariff = {
    id: 't1',
    group_type: 'group',
    lessons_in_package: 12,
    package_price: 3200,
    max_students: 10,
    lesson_duration_min: 60,
    freeze_limit: 2,
    valid_from: '2026-09-01',
    created_at: '2026-08-25T06:00:00Z',
    created_by: null,
  }
  const tariffs: Tariff[] = (['group', 'mini', 'pair', 'individual', 'afterschool'] as const).map(
    (group_type, i) => ({ ...base, id: `t${i}`, group_type, max_students: 10 - i }),
  )
  const input = planTariffsForm({ date: TODAY, paid: false }).parse({
    validFrom: '01.09.2027',
    prices,
  })

  it('creates one row per group type with one date, terms carried over', () => {
    const rows = planRows(input, tariffs)
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((r) => r.valid_from))).toEqual(new Set(['2027-09-01']))
    expect(rows.find((r) => r.group_type === 'pair')).toEqual({
      group_type: 'pair',
      lessons_in_package: 12,
      package_price: 4600,
      max_students: 8,
      lesson_duration_min: 60,
      freeze_limit: 2,
      hour_price: null,
      valid_from: '2027-09-01',
    })
  })

  it('продлёнка: the hour price goes to the after-school row only (#82)', () => {
    const rows = planRows({ ...input, hourPrice: 130 }, tariffs)
    expect(rows.find((r) => r.group_type === 'afterschool')?.hour_price).toBe(130)
    expect(rows.find((r) => r.group_type === 'group')?.hour_price).toBeNull()
  })

  it('refuses when a type has no tariff to start from', () => {
    expect(() => planRows(input, tariffs.slice(1))).toThrow(/Нет действующего тарифа/)
  })
})

describe('holidayForm', () => {
  const form = holidayForm(TODAY)

  it('accepts today and later, trims the name', () => {
    expect(form.parse({ day: '11.10.2026', name: ' День учителя ' })).toEqual({
      day: '2026-10-11',
      name: 'День учителя',
      reason: null,
    })
  })

  it('a past day needs a reason; today and later do not', () => {
    expect(form.safeParse({ day: '10.10.2026', name: 'X' }).error?.issues[0]?.message).toBe(
      'Укажите причину',
    )
    expect(form.parse({ day: '10.10.2026', name: 'X', reason: ' забыли ' })).toEqual({
      day: '2026-10-10',
      name: 'X',
      reason: 'забыли',
    })
    expect(form.parse({ day: '12.10.2026', name: 'X' }).reason).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(form.safeParse({ day: '12.10.2026', name: '  ' }).error?.issues[0]?.message).toBe(
      'Введите название',
    )
  })
})
