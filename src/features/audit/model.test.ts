import type { AuditEntry } from './describe'
import { dayTitle, groupByDay, likePattern, periodStart, searchKey } from './model'

// Thursday 8 October 2026, 14:24 in Bishkek
const NOW = Date.parse('2026-10-08T14:24:00+06:00')

describe('periodStart', () => {
  it('starts at Bishkek midnight', () => {
    expect(periodStart('today', NOW)).toBe('2026-10-08T00:00:00+06:00')
    expect(periodStart('7d', NOW)).toBe('2026-10-02T00:00:00+06:00')
    expect(periodStart('30d', NOW)).toBe('2026-09-09T00:00:00+06:00')
    expect(periodStart('all', NOW)).toBeNull()
  })

  it('uses the Bishkek day, not the UTC one', () => {
    // 01:00 on the 9th in Bishkek is still the 8th in UTC
    expect(periodStart('today', Date.parse('2026-10-09T01:00:00+06:00'))).toBe(
      '2026-10-09T00:00:00+06:00',
    )
  })
})

describe('dayTitle', () => {
  it('names today and yesterday', () => {
    expect(dayTitle('2026-10-08', '2026-10-08')).toBe('Сегодня, 8 октября')
    expect(dayTitle('2026-10-07', '2026-10-08')).toBe('Вчера, 7 октября')
    expect(dayTitle('2026-10-06', '2026-10-08')).toBe('6 октября')
    expect(dayTitle('2025-12-31', '2026-10-08')).toBe('31 декабря 2025')
  })
})

describe('groupByDay', () => {
  const entry = (id: string, at: string): AuditEntry => ({
    id,
    at,
    kind: 'other',
    author: 'Система',
    badge: { label: 'Занятие', tone: 'stone' },
    parts: [],
    note: null,
    link: null,
  })

  it('splits by Bishkek day and keeps the order', () => {
    const days = groupByDay(
      [
        entry('a', '2026-10-08T07:40:00+00:00'), // 13:40 on the 8th
        entry('b', '2026-10-07T20:00:00+00:00'), // 02:00 on the 8th
        entry('c', '2026-10-07T17:59:00+00:00'), // 23:59 on the 7th
      ],
      NOW,
    )
    expect(days.map((d) => [d.title, d.entries.map((e) => e.id)])).toEqual([
      ['Сегодня, 8 октября', ['a', 'b']],
      ['Вчера, 7 октября', ['c']],
    ])
  })
})

describe('searchKey / likePattern', () => {
  it('normalises the box as person_name_key does', () => {
    expect(searchKey('  Алёна\u00a0 ТЕСТОВА ')).toBe('алена тестова')
    expect(searchKey('   ')).toBeNull()
    expect(searchKey(undefined)).toBeNull()
    expect(searchKey('8*класс')).toBe('8 класс')
  })

  it('takes % _ \\ literally', () => {
    expect(likePattern('100%_a\\b')).toBe('%100\\%\\_a\\\\b%')
  })
})
