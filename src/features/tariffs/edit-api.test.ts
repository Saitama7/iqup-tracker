import { describe, expect, it } from 'vitest'
import { deleteTariffForm, editErrorMessage, updateTariffForm } from './edit-api'

const prices = {
  group: '3 300',
  mini: '3000',
  pair: '4000',
  individual: '5000',
  afterschool: '6000',
}

describe('updateTariffForm', () => {
  it('parses prices, empty hour price → null, requires a reason', () => {
    const ok = updateTariffForm.parse({
      validFrom: '2026-10-01',
      prices,
      hourPrice: '',
      reason: ' ошибка ',
    })
    expect(ok.prices.group).toBe(3300)
    expect(ok.hourPrice).toBeNull()
    expect(ok.reason).toBe('ошибка')
    expect(
      updateTariffForm.parse({ validFrom: 'x', prices, hourPrice: '150', reason: 'r' }).hourPrice,
    ).toBe(150)
    expect(
      updateTariffForm.safeParse({ validFrom: 'x', prices, hourPrice: '', reason: ' ' }).error
        ?.issues[0]?.message,
    ).toBe('Укажите причину')
    expect(
      updateTariffForm.safeParse({
        validFrom: 'x',
        prices: { ...prices, pair: '0' },
        hourPrice: '',
        reason: 'r',
      }).success,
    ).toBe(false)
  })
})

describe('deleteTariffForm', () => {
  it('needs a reason', () => {
    expect(deleteTariffForm.safeParse({ validFrom: 'x', reason: '' }).success).toBe(false)
  })
})

describe('editErrorMessage', () => {
  it('maps the codes of the admin RPCs', () => {
    expect(editErrorMessage({ code: '23503' })).toMatch(/уже куплены абонементы/)
    expect(
      editErrorMessage({
        code: '23514',
        message: 'the version from x has no earlier version to fall back to',
      }),
    ).toBe('Это первая версия тарифа — удалить нельзя')
    expect(editErrorMessage({ code: '23514', message: 'reason is required' })).toBe(
      'Укажите причину',
    )
    expect(editErrorMessage({ code: '23514', message: 'payroll month 2026-09 is closed' })).toMatch(
      /Месяц закрыт/,
    )
    expect(editErrorMessage({ code: '23505' })).toBe('Этот день уже в списке')
    expect(editErrorMessage({ code: '42501' })).toMatch(/администратор/)
  })
})
