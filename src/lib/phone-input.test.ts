import { maskPhoneInput } from './phone-input'

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
    ['0555123456', '555 123 456'],
    ['+996 555 123 456', '555 123 456'],
    ['996555123456', '555 123 456'],
  ])('%j → %j', (input, expected) => {
    expect(maskPhoneInput(input)).toBe(expected)
  })
})
