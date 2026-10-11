import {
  bishkekDate,
  bishkekDaysBetween,
  formatDateRu,
  formatDayLong,
  formatMonthNom,
  formatMonthYearGen,
  formatWeekdayLower,
  parseDateRu,
} from './time'

describe('bishkekDate', () => {
  it('shifts UTC by +6h', () => {
    expect(bishkekDate(Date.parse('2026-10-11T17:59:59Z'))).toBe('2026-10-11')
    expect(bishkekDate(Date.parse('2026-10-11T18:00:00Z'))).toBe('2026-10-12')
  })
})

describe('formatDayLong', () => {
  it('weekday and genitive month in Bishkek', () => {
    expect(formatDayLong(Date.parse('2026-10-08T05:00:00Z'))).toBe('Четверг, 8 октября')
    // 20:00 UTC Sunday is already Monday in Bishkek
    expect(formatDayLong(Date.parse('2026-10-11T20:00:00Z'))).toBe('Понедельник, 12 октября')
  })
})

describe('formatMonthYearGen', () => {
  it('genitive month and year in Bishkek', () => {
    expect(formatMonthYearGen(Date.parse('2024-09-02T04:00:00Z'))).toBe('сентября 2024')
    expect(formatMonthYearGen(Date.parse('2024-12-31T19:00:00Z'))).toBe('января 2025')
  })
})

describe('formatDateRu / parseDateRu', () => {
  it('round-trips dd.mm.yyyy', () => {
    expect(formatDateRu('2026-10-12')).toBe('12.10.2026')
    expect(parseDateRu('12.10.2026')).toBe('2026-10-12')
    expect(parseDateRu(' 1.9.2026 ')).toBe('2026-09-01')
    expect(parseDateRu('01/11/2026')).toBe('2026-11-01')
  })

  it('rejects impossible or malformed dates', () => {
    expect(parseDateRu('30.02.2026')).toBeNull()
    expect(parseDateRu('12.13.2026')).toBeNull()
    expect(parseDateRu('2026-10-12')).toBeNull()
    expect(parseDateRu('')).toBeNull()
  })
})

describe('bishkekDaysBetween', () => {
  it('counts calendar days in Bishkek, not 24h spans', () => {
    // 23:30 → 00:30 next day in Bishkek is one day
    expect(
      bishkekDaysBetween(Date.parse('2026-10-11T17:30:00Z'), Date.parse('2026-10-11T18:30:00Z')),
    ).toBe(1)
    expect(
      bishkekDaysBetween(Date.parse('2026-09-29T10:00:00Z'), Date.parse('2026-10-11T09:00:00Z')),
    ).toBe(12)
    expect(
      bishkekDaysBetween(Date.parse('2026-10-11T01:00:00Z'), Date.parse('2026-10-11T17:00:00Z')),
    ).toBe(0)
  })
})

describe('formatMonthNom / formatWeekdayLower', () => {
  it('Bishkek month and weekday', () => {
    expect(formatMonthNom(Date.parse('2026-10-31T18:00:00Z'))).toBe('Ноябрь')
    expect(formatWeekdayLower(Date.parse('2026-10-09T05:00:00Z'))).toBe('пятница')
  })
})
