vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { FunctionsFetchError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import {
  CREATE_TIMEOUT_MESSAGE,
  createUser,
  createUserForm,
  isTimeoutError,
  NEW_RATE_TIMEOUT_MESSAGE,
  rateForm,
  resetPassword,
  updateRate,
  USERS_FUNCTION_TIMEOUT_MS,
} from './api'

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

describe('create-user calls (#66)', () => {
  it('time out after 20 s with a clear message instead of an endless spinner', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new DOMException('aborted', 'AbortError')),
    })
    Object.assign(supabase, { functions: { invoke } })
    await expect(resetPassword({ phone: '996555000001', password: 'iqup-7k2m' })).rejects.toThrow(
      'Сервер не ответил, попробуйте ещё раз',
    )
    expect(invoke).toHaveBeenCalledWith('create-user', expect.objectContaining({ timeout: 20_000 }))
    expect(USERS_FUNCTION_TIMEOUT_MS).toBe(20_000)
  })

  it('other network errors keep the generic message', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Load failed')),
    })
    Object.assign(supabase, { functions: { invoke } })
    await expect(resetPassword({ phone: '996555000001', password: 'iqup-7k2m' })).rejects.toThrow(
      'Не удалось связаться с сервером. Попробуйте ещё раз.',
    )
  })

  it('abort while reading the body (bare DOMException) is a timeout too (#68)', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new DOMException('aborted', 'AbortError'),
    })
    Object.assign(supabase, { functions: { invoke } })
    await expect(resetPassword({ phone: '996555000001', password: 'iqup-7k2m' })).rejects.toThrow(
      'Сервер не ответил, попробуйте ещё раз',
    )
  })

  it('timeout on create / new rate says the action may have gone through (#68)', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new DOMException('timed out', 'TimeoutError')),
    })
    Object.assign(supabase, { functions: { invoke } })
    const created = createUser({
      full_name: 'Айгуль Исакова',
      phone: '996555000001',
      roles: ['admin'],
      password: 'iqup-7k2m',
    })
    await expect(created).rejects.toThrow(CREATE_TIMEOUT_MESSAGE)
    expect(isTimeoutError(await created.catch((e: unknown) => e))).toBe(true)
    const rate = { teacherId: crypto.randomUUID(), percent: 50, validFrom: '2026-11-01' }
    await expect(updateRate({ mode: 'new', ...rate })).rejects.toThrow(NEW_RATE_TIMEOUT_MESSAGE)
    await expect(updateRate({ mode: 'fix', ...rate })).rejects.toThrow(
      'Сервер не ответил, попробуйте ещё раз',
    )
  })
})
