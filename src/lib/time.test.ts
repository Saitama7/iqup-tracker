import { bishkekDate, formatDayLong, formatMonthYearGen } from './time'

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
