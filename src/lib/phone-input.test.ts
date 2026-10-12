import { maskPhoneInput, pastedPhoneDigits } from './phone-input'

const NBSP = String.fromCharCode(0xa0)

describe('maskPhoneInput', () => {
  it.each([
    ['', ''],
    ['5', '5'],
    ['555', '555'],
    ['5551', '555 1'],
    ['555123456', '555 123 456'],
    ['555 123 4567', '555 123 456'],
    ['555-12a3', '555 123'],
    ['0', ''],
    ['0555123', '555 123'],
    ['0555123456', '555 123 456'],
    ['+996 555 123 456', '555 123 456'],
    ['996555123456', '555 123 456'],
  ])('typing %j → %j', (input, expected) => {
    expect(maskPhoneInput(input)).toBe(expected)
  })

  it.each([
    ['+996 552 775 771'],
    ['+996 (552) 77-57-71'],
    ['996552775771'],
    ['0552 775 771'],
    ['552775771'],
    [`+996${NBSP}552${NBSP}775${NBSP}771`],
    ['+996\t552\t775\t771'],
    ['+996 552\n775 771\n'],
    ['тел: +996 (552) 77-57-71'],
    ['Каныкей 2: 0552 775 771, админ'],
    ['8 класс А — 552-775-771 (мама)'],
  ])('pasted %j → 552 775 771', (input) => {
    expect(maskPhoneInput(input)).toBe('552 775 771')
  })
})

describe('pastedPhoneDigits', () => {
  it('finds the national digits of a whole number in copied text', () => {
    expect(pastedPhoneDigits('тел: +996 (552) 77-57-71')).toBe('552775771')
  })

  it.each([[''], ['555 12'], ['тел: нет'], ['0555 12 34']])('%j has no whole number', (input) => {
    expect(pastedPhoneDigits(input)).toBeNull()
  })
})
