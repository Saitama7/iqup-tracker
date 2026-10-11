import { lessonPrice, tariffFor, teacherShare, type TariffTerms } from './current'

/** Test helper: the value must be there. */
function must<T>(x: T | null | undefined): T {
  if (x == null) throw new Error('expected a value')
  return x
}

const t = (
  group_type: TariffTerms['group_type'],
  valid_from: string,
  package_price: number,
  lessons_in_package = 12,
): TariffTerms => ({ group_type, valid_from, package_price, lessons_in_package })

const TARIFFS = [
  t('group', '2025-09-01', 3000),
  t('group', '2026-09-01', 3200),
  t('mini', '2026-09-01', 3800),
  // planned: a new price from next September
  t('group', '2027-09-01', 3500),
]

describe('tariffFor', () => {
  it('returns the latest version that started on or before the date', () => {
    expect(tariffFor('group', '2026-10-11', TARIFFS)?.package_price).toBe(3200)
    expect(tariffFor('group', '2026-09-01', TARIFFS)?.package_price).toBe(3200)
    expect(tariffFor('group', '2026-08-31', TARIFFS)?.package_price).toBe(3000)
  })

  it('a version planned for the future does not change the price of past lessons', () => {
    const before = TARIFFS.slice(0, 3)
    for (const date of ['2025-10-01', '2026-08-31', '2026-10-11', '2027-08-31']) {
      expect(tariffFor('group', date, TARIFFS)).toEqual(tariffFor('group', date, before))
    }
    expect(lessonPrice(must(tariffFor('group', '2026-10-11', TARIFFS)))).toBeCloseTo(266.67, 2)
    expect(tariffFor('group', '2027-09-01', TARIFFS)?.package_price).toBe(3500)
  })

  it('does not mix group types and does not depend on order', () => {
    expect(tariffFor('mini', '2026-10-11', [...TARIFFS].reverse())?.package_price).toBe(3800)
    expect(tariffFor('pair', '2026-10-11', TARIFFS)).toBeNull()
  })

  it('returns null before the first version', () => {
    expect(tariffFor('group', '2025-08-31', TARIFFS)).toBeNull()
  })
})

describe('teacherShare', () => {
  // А9: «Учителю 45 % / 50 %» = round(package_price / lessons_in_package × pct)
  it.each([
    [3200, 12, 120, 133],
    [3800, 12, 143, 158],
    [4400, 12, 165, 183],
    [7200, 12, 270, 300],
    [7400, 20, 167, 185],
  ])('%i / %i lessons → %i / %i', (price, lessons, p45, p50) => {
    const tariff = { package_price: price, lessons_in_package: lessons }
    expect(teacherShare(tariff, 45)).toBe(p45)
    expect(teacherShare(tariff, 50)).toBe(p50)
  })
})
