import { maskPhoneInput } from './phone-input'

describe('maskPhoneInput', () => {
  it.each([
    ['', ''],
    ['0', '0'],
    ['0555', '0555'],
    ['05551', '0555 1'],
    ['0555123456', '0555 123 456'],
    ['0555 123 4567', '0555 123 456'],
    ['0555-12a3', '0555 123'],
    ['+996 555 123 456', '0555 123 456'],
    ['996555123456', '0555 123 456'],
  ])('%j → %j', (input, expected) => {
    expect(maskPhoneInput(input)).toBe(expected)
  })
})
