vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { describe, expect, it, vi } from 'vitest'
import { studentForm } from './api'

const base = {
  fullName: '  Нурлан Асанов ',
  grade: '8',
  parentName: 'Асан Асанов',
  parentPhone: '555 999 000',
  isReturning: false,
  referredBy: '',
  notes: '',
}

describe('studentForm', () => {
  it('trims, normalizes the phone, empty → null', () => {
    expect(studentForm.parse(base)).toEqual({
      fullName: 'Нурлан Асанов',
      grade: 8,
      parentName: 'Асан Асанов',
      parentPhone: '996555999000',
      isReturning: false,
      referredBy: null,
      notes: null,
    })
  })

  it('only the name is required', () => {
    expect(
      studentForm.parse({ ...base, grade: '', parentName: ' ', parentPhone: '' }),
    ).toMatchObject({ grade: null, parentName: null, parentPhone: null })
    expect(studentForm.safeParse({ ...base, fullName: ' ' }).error?.issues[0]?.message).toBe(
      'Введите имя и фамилию',
    )
  })

  it('class 1–11, phone 9 digits', () => {
    expect(studentForm.safeParse({ ...base, grade: '12' }).error?.issues[0]?.message).toBe(
      'Класс — от 1 до 11',
    )
    expect(
      studentForm.safeParse({ ...base, parentPhone: '555 99' }).error?.issues[0]?.message,
    ).toBe('Телефон: 9 цифр после +996')
  })

  it('«привёл» is a student id', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(studentForm.parse({ ...base, referredBy: id }).referredBy).toBe(id)
    expect(studentForm.safeParse({ ...base, referredBy: 'x' }).success).toBe(false)
  })
})
