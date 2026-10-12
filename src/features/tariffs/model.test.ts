import type { GroupType } from './current'
import {
  buildVersions,
  currentTariffs,
  formatLessonPrice,
  formatSom,
  holidayItems,
  nextMonthStart,
  planMinDate,
  planMinDateHint,
  seatsLabel,
  subscriptionsCaption,
  versionSummary,
  type SettingsSource,
  type Tariff,
} from './model'

/** Test helper: the value must be there. */
function must<T>(x: T | null | undefined): T {
  if (x == null) throw new Error('expected a value')
  return x
}

const TODAY = '2026-10-11'
const KANYKEI = 'a0000000-0000-4000-8000-000000000001'

const PRICES: Record<string, Record<GroupType, number>> = {
  '2025-09-01': { group: 3000, mini: 3500, pair: 4000, individual: 6500, afterschool: 7000 },
  '2026-09-01': { group: 3200, mini: 3800, pair: 4400, individual: 7200, afterschool: 7400 },
  '2027-09-01': { group: 3500, mini: 4000, pair: 4600, individual: 7500, afterschool: 7800 },
}
const MAX: Record<GroupType, number> = {
  group: 10,
  mini: 4,
  pair: 2,
  individual: 1,
  afterschool: 8,
}

const tariffs: Tariff[] = Object.entries(PRICES).flatMap(([validFrom, prices]) =>
  Object.entries(prices).map(([type, price]) => ({
    id: `${type}-${validFrom}`,
    group_type: type as GroupType,
    lessons_in_package: type === 'afterschool' ? 20 : 12,
    package_price: price,
    max_students: MAX[type as GroupType],
    lesson_duration_min: type === 'afterschool' ? 180 : 60,
    freeze_limit: 2,
    valid_from: validFrom,
    created_at: validFrom === '2026-09-01' ? '2026-08-25T06:00:00Z' : `${validFrom}T00:00:00Z`,
    created_by: validFrom === '2025-09-01' ? null : KANYKEI,
  })),
)

const source: SettingsSource = {
  tariffs,
  holidays: [],
  subscriptions: [
    { tariff_id: 'group-2026-09-01', status: 'active' },
    { tariff_id: 'mini-2026-09-01', status: 'active' },
    { tariff_id: 'group-2025-09-01', status: 'active' },
    { tariff_id: 'group-2025-09-01', status: 'exhausted' },
  ],
  authors: { [KANYKEI]: 'Каныкей' },
}

describe('formatting', () => {
  it('formats som and lesson prices as on А9', () => {
    expect(formatSom(3200)).toBe('3 200')
    expect(formatSom(600)).toBe('600')
    expect(formatLessonPrice(3200 / 12)).toBe('266,67')
    expect(formatLessonPrice(7200 / 12)).toBe('600,00')
    expect(formatLessonPrice(7200 / 12, true)).toBe('600')
  })

  it('seats: exact for pair and individual, «до N» otherwise', () => {
    expect(seatsLabel(1)).toBe('1')
    expect(seatsLabel(2)).toBe('2')
    expect(seatsLabel(4)).toBe('до 4')
  })
})

describe('currentTariffs', () => {
  it('takes the set in effect today, not the planned one', () => {
    const rows = currentTariffs(tariffs, TODAY)
    expect(rows.map((t) => t.group_type)).toEqual([
      'group',
      'mini',
      'pair',
      'individual',
      'afterschool',
    ])
    expect(rows.map((t) => t.package_price)).toEqual([3200, 3800, 4400, 7200, 7400])
  })
})

describe('buildVersions', () => {
  const versions = buildVersions(source, TODAY)

  it('lists versions newest first with status', () => {
    expect(versions.map((v) => [v.validFrom, v.status, v.first])).toEqual([
      ['2027-09-01', 'planned', false],
      ['2026-09-01', 'current', false],
      ['2025-09-01', 'archive', true],
    ])
  })

  it('compares each type with the previous version', () => {
    const current = must(versions[1])
    const group = must(current.rows.find((r) => r.type === 'group'))
    expect(group.before?.package_price).toBe(3000)
    expect(group.after.package_price).toBe(3200)
    expect(must(versions[2]).rows.every((r) => r.before === null)).toBe(true)
  })

  it('shows who and when (Bishkek date), import for the first version without an author', () => {
    expect(must(versions[1]).author).toBe('Каныкей · 25 авг 2026')
    expect(must(versions[2]).author).toBe('импорт при запуске')
  })

  it('counts subscriptions bought at the version prices', () => {
    expect(subscriptionsCaption(must(versions[1]), versions[0])).toBe(
      'По этому тарифу: 2 абонемента',
    )
    expect(subscriptionsCaption(must(versions[2]), versions[1])).toBe(
      'Ещё 1 абонемент по этому тарифу дорабатывается (куплены до 1 сен 2026)',
    )
    expect(subscriptionsCaption(must(versions[0]), undefined)).toBeNull()
  })

  it('summarises a version in one line', () => {
    expect(versionSummary(must(versions[1]))).toBe(
      'Групповая 3 000 → 3 200 · Мини 3 500 → 3 800 · Парная 4 000 → 4 400 · Инд. 6 500 → 7 200 · Продлёнка 7 000 → 7 400',
    )
  })
})

describe('planMinDate (К6, А9)', () => {
  it('nextMonthStart: the 1st of the following month, across the year end', () => {
    expect(nextMonthStart('2026-10-11')).toBe('2026-11-01')
    expect(nextMonthStart('2026-10-31')).toBe('2026-11-01')
    expect(nextMonthStart('2026-12-15')).toBe('2027-01-01')
  })

  it('subscriptions bought → the 1st of next month, with the hint', () => {
    const min = planMinDate(
      { tariffs, subscriptions: [{ tariff_id: 'group-2026-09-01', status: 'active' }] },
      TODAY,
    )
    expect(min).toEqual({ date: '2026-11-01', paid: true })
    expect(planMinDateHint(min)).toBe(
      'Для действующих групп новый тариф начнёт действовать с 1 ноября. Купленные абонементы остаются по старой цене',
    )
  })

  it('nobody has paid yet → today, no hint', () => {
    const min = planMinDate({ tariffs, subscriptions: [] }, TODAY)
    expect(min).toEqual({ date: TODAY, paid: false })
    expect(planMinDateHint(min)).toBeNull()
  })
})

describe('holidayItems', () => {
  const items = holidayItems(
    [
      { day: '2027-01-02', name: 'Новый год · каникулы центра' },
      { day: '2026-11-07', name: 'День Октябрьской революции' },
      { day: '2026-12-31', name: 'Новый год · каникулы центра' },
      { day: '2027-01-01', name: 'Новый год · каникулы центра' },
      { day: '2026-08-31', name: 'День независимости' },
      { day: '2027-03-21', name: 'Нооруз' },
      { day: '2027-03-22', name: 'Нооруз' },
    ],
    TODAY,
  )

  it('sorts by date and merges consecutive days with one name', () => {
    expect(items.map((i) => [i.label, i.name, i.past])).toEqual([
      ['31 августа · пн', 'День независимости', true],
      ['7 ноября · сб', 'День Октябрьской революции', false],
      ['31 дек – 2 янв', 'Новый год · каникулы центра', false],
      ['21–22 марта', 'Нооруз', false],
    ])
    expect(must(items[2]).days).toEqual(['2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('today is not past', () => {
    expect(must(holidayItems([{ day: TODAY, name: 'X' }], TODAY)[0]).past).toBe(false)
  })
})
