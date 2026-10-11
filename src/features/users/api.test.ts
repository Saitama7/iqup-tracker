vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { createUserForm, rateForm } from './api'

const base = {
  fullName: ' Айгуль Исакова ',
  phone: '555 000 001',
  roles: ['teacher'],
  percent: '45',
  validFrom: '12.10.2026',
  password: 'iqup-7k2m',
}

describe('createUserForm', () => {
  it('maps the form to the create-user body', () => {
    expect(createUserForm.parse(base)).toEqual({
      full_name: 'Айгуль Исакова',
      phone: '996555000001',
      roles: ['teacher'],
      password: 'iqup-7k2m',
      percent: 45,
      valid_from: '2026-10-12',
    })
  })

  it('no percent for non-teachers, even if the hidden fields hold junk', () => {
    expect(
      createUserForm.parse({ ...base, roles: ['accountant'], percent: 'x', validFrom: '' }),
    ).toEqual({
      full_name: 'Айгуль Исакова',
      phone: '996555000001',
      roles: ['accountant'],
      password: 'iqup-7k2m',
    })
  })

  it.each([
    [{ fullName: '  ' }, 'Введите имя и фамилию'],
    [{ phone: '123' }, 'Телефон: 9 цифр после +996'],
    [{ roles: [] }, 'Выберите роль'],
    [{ password: 'short' }, 'Пароль — минимум 8 символов'],
    [{ percent: '0' }, 'Процент — от 1 до 100'],
    [{ percent: 'abc' }, 'Процент — число'],
    [{ validFrom: '31.02.2026' }, 'Дата в формате ДД.ММ.ГГГГ'],
  ])('rejects %o', (patch, message) => {
    const res = createUserForm.safeParse({ ...base, ...patch })
    expect(res.success).toBe(false)
    expect(res.error?.issues[0]?.message).toBe(message)
  })
})

describe('rateForm', () => {
  it('accepts a comma decimal and a ru date', () => {
    expect(rateForm.parse({ percent: '47,5', validFrom: '01.11.2026' })).toEqual({
      percent: 47.5,
      validFrom: '2026-11-01',
    })
  })
})
