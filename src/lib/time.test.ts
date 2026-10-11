import { bishkekDate } from './time'

describe('bishkekDate', () => {
  it('shifts UTC by +6h', () => {
    expect(bishkekDate(Date.parse('2026-10-11T17:59:59Z'))).toBe('2026-10-11')
    expect(bishkekDate(Date.parse('2026-10-11T18:00:00Z'))).toBe('2026-10-12')
  })
})
