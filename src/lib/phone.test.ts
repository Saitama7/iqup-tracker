import {
  InvalidPhoneError,
  formatPhone,
  formatPhoneIntl,
  normalizePhone,
  phoneToEmail,
} from './phone'

describe('normalizePhone', () => {
  it.each([
    ['0552 775 771', '996552775771'],
    ['0552775771', '996552775771'],
    ['+996 552 775 771', '996552775771'],
    ['+996 (552) 77-57-71', '996552775771'],
    ['996552775771', '996552775771'],
    ['  996 552 775 771 ', '996552775771'],
    ['552 775 771', '996552775771'],
    ['0700 333 444', '996700333444'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  it.each([
    '',
    'abc',
    '0552 775 77',
    '0552 775 7711',
    '+7 912 345 67 89',
    '+552775771',
    '996052775771',
    '00552775771',
    '0552-775-771x',
    'phone: 0552775771',
  ])('rejects %j', (input) => {
    expect(() => normalizePhone(input)).toThrow(InvalidPhoneError)
  })
})

describe('formatPhone', () => {
  it('formats canonical phone the local way', () => {
    expect(formatPhone('996552775771')).toBe('0552 775 771')
  })

  it('round-trips with normalizePhone', () => {
    expect(normalizePhone(formatPhone('996555123456'))).toBe('996555123456')
  })

  it('rejects non-canonical input', () => {
    expect(() => formatPhone('0552775771')).toThrow(InvalidPhoneError)
  })
})

describe('formatPhoneIntl', () => {
  it('formats canonical phone with +996', () => {
    expect(formatPhoneIntl('996555123456')).toBe('+996 555 123 456')
  })

  it('round-trips with normalizePhone', () => {
    expect(normalizePhone(formatPhoneIntl('996555123456'))).toBe('996555123456')
  })
})

describe('phoneToEmail', () => {
  it('builds synthetic auth email', () => {
    expect(phoneToEmail('0552 775 771')).toBe('996552775771@iqup.local')
  })
})
