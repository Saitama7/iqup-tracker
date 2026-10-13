import { maskDateInput, maskTimeInput } from './date-input'
import { parseDateRu } from './time'

describe('maskDateInput', () => {
  it.each([
    ['', ''],
    ['0', '0'],
    ['01', '01'],
    ['010', '01.0'],
    ['0109', '01.09'],
    ['01092', '01.09.2'],
    ['01092026', '01.09.2026'],
    ['010920261', '01.09.2026'],
    // separators typed by hand
    ['1.', '1.'],
    ['1.9.2026', '1.9.2026'],
    ['01/09/2026', '01.09.2026'],
    ['1,9,2026', '1.9.2026'],
    // backspace over an inserted dot
    ['01.', '01.'],
    ['01.09.', '01.09.'],
    // re-typing over a formatted value
    ['01.092026', '01.09.2026'],
    ['.1', '1'],
    ['1..9', '1.9'],
  ])('%j → %j', (raw, masked) => {
    expect(maskDateInput(raw)).toBe(masked)
  })

  it('digits typed one by one end as a date parseDateRu reads', () => {
    let value = ''
    for (const d of '01092026') value = maskDateInput(value + d)
    expect(value).toBe('01.09.2026')
    expect(parseDateRu(value)).toBe('2026-09-01')
  })
})

describe('maskTimeInput', () => {
  it.each([
    ['', ''],
    ['9', '9'],
    ['90', '90'],
    ['900', '9:00'],
    ['1030', '10:30'],
    ['10301', '10:30'],
    ['9:00', '9:00'],
    ['09:00', '09:00'],
    ['1:030', '10:30'],
    ['9:0', '90'],
  ])('%j → %j', (raw, masked) => {
    expect(maskTimeInput(raw)).toBe(masked)
  })
})
