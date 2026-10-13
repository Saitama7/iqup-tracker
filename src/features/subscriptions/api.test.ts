vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { describe, expect, it, vi } from 'vitest'
import { enrollErrorMessage, enrollForm, enrollmentStartErrorMessage } from './api'

const studentId = '11111111-1111-4111-8111-111111111111'
const groupId = '00000000-0000-4000-b000-000000000001'

describe('enrollForm', () => {
  it('parses the date and keeps the discount', () => {
    expect(
      enrollForm('2026-09-01').parse({ studentId, groupId, startDate: '12.10.2026', discount: 15 }),
    ).toEqual({ studentId, groupId, startDate: '2026-10-12', discount: 15 })
  })

  it('requires a group', () => {
    const r = enrollForm(null).safeParse({
      studentId,
      groupId: '',
      startDate: '12.10.2026',
      discount: 0,
    })
    expect(r.error?.issues[0]?.message).toBe('Выберите группу')
  })

  it('refuses a bad date and a date before the group start', () => {
    const bad = enrollForm(null).safeParse({
      studentId,
      groupId,
      startDate: '31.02.2026',
      discount: 0,
    })
    expect(bad.error?.issues[0]?.message).toBe('Дата в формате ДД.ММ.ГГГГ')
    const early = enrollForm('2026-09-01').safeParse({
      studentId,
      groupId,
      startDate: '31.08.2026',
      discount: 0,
    })
    expect(early.error?.issues[0]?.message).toBe('Дата начала — не раньше старта группы')
  })

  it('only 0 / 5 / 15 %', () => {
    expect(
      enrollForm(null).safeParse({ studentId, groupId, startDate: '12.10.2026', discount: 10 })
        .success,
    ).toBe(false)
  })
})

describe('enrollErrorMessage', () => {
  it('maps the RPC errors', () => {
    expect(enrollErrorMessage({ code: '23505' })).toBe('Ученик уже зачислен в эту группу')
    expect(enrollErrorMessage({ code: '42501' })).toBe('Зачислять может только администратор')
    expect(
      enrollErrorMessage({
        code: '23514',
        message: '15 % applies only to the first subscription of a returning student',
      }),
    ).toBe('15 % — только на первый абонемент бывшего ученика')
    expect(
      enrollErrorMessage({ code: '23514', message: '5 % applies once per friend brought' }),
    ).toBe('5 % — один абонемент за каждого приведённого друга')
    expect(
      enrollErrorMessage({ code: '23514', message: 'no tariff for group on 2001-01-01' }),
    ).toBe('На эту дату нет тарифа для группы')
  })
})

describe('enrollmentStartErrorMessage (#60)', () => {
  it.each([
    [{ code: '42501' }, 'Дату зачисления меняет администратор'],
    [{ code: '23505' }, 'На эти даты у ученика уже есть другое зачисление в эту группу'],
    [
      { code: '23514', message: 'start date is outside the group dates' },
      'Дата — вне дат группы (раньше старта группы)',
    ],
    [
      { code: '23514', message: 'start date is after the enrollment end' },
      'Дата позже окончания зачисления',
    ],
    [
      { code: '23514', message: 'the enrollment has attendance before the new date' },
      'Раньше этой даты у ученика уже есть отметки в группе — перенести позже нельзя',
    ],
  ])('%j', (error, text) => {
    expect(enrollmentStartErrorMessage(error)).toBe(text)
  })
})
