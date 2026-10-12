import { cleanPassword } from './password-input'

const NBSP = String.fromCharCode(0xa0)
const NNBSP = String.fromCharCode(0x202f)
const ZWSP = String.fromCharCode(0x200b)
const ZWNJ = String.fromCharCode(0x200c)
const ZWJ = String.fromCharCode(0x200d)
const WJ = String.fromCharCode(0x2060)
const BOM = String.fromCharCode(0xfeff)

describe('cleanPassword', () => {
  it.each([
    ['iqup-demo', 'iqup-demo'],
    ['iqup-demo ', 'iqup-demo'],
    [' iqup-demo\n', 'iqup-demo'],
    ['iqup- demo', 'iqup-demo'],
    ['\tiqup-demo\r\n', 'iqup-demo'],
    [`iqup${NBSP}-demo${NNBSP}`, 'iqup-demo'],
    [`${ZWSP}iqup-${ZWNJ}${ZWJ}demo${WJ}${BOM}`, 'iqup-demo'],
    ['   ', ''],
  ])('%j → %j', (input, expected) => {
    expect(cleanPassword(input)).toBe(expected)
  })
})
