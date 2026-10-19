import { describe, expect, it } from 'vitest'
import { pickerMatches } from './student-picker'

describe('StudentPicker search (#93)', () => {
  const aizhan = { fullName: 'Айжан  Бекова', parentPhone: '996555123456' }
  it('by a part of the name: case, ё = е, spaces (И47 nameKey)', () => {
    expect(pickerMatches(aizhan, 'айжан б')).toBe(true)
    expect(pickerMatches({ fullName: 'Алёна Ким', parentPhone: null }, 'алена')).toBe(true)
    expect(pickerMatches({ fullName: 'Алена Ким', parentPhone: null }, 'АЛЁНА')).toBe(true)
    expect(pickerMatches(aizhan, 'асель')).toBe(false)
  })
  it('by the parent phone in any common form', () => {
    for (const q of ['0555 123 456', '123456', '+996 555 123 456']) {
      expect(pickerMatches(aizhan, q)).toBe(true)
    }
    expect(pickerMatches(aizhan, '0700')).toBe(false)
  })
  it('an empty query keeps everyone', () => {
    expect(pickerMatches(aizhan, '  ')).toBe(true)
  })
})
