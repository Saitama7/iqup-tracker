vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { describe, expect, it, vi } from 'vitest'
import { deleteRequestForm } from './corrections-api'
import {
  editLessonErrorMessage,
  editLessonForm,
  impactLines,
  parseTimeInput,
} from './edit-lesson-api'

const id = '11111111-1111-4111-8111-111111111111'
const teacher = '22222222-2222-4222-8222-222222222222'
const base = {
  lessonId: id,
  date: '14.10.2026',
  start: '9:30',
  durationMin: '60',
  teacherId: teacher,
  substituteId: '',
  reason: ' ошиблись датой ',
}

describe('editLessonForm', () => {
  it('normalizes the fields; empty substitute = none', () => {
    expect(editLessonForm.parse(base)).toMatchObject({
      date: '2026-10-14',
      start: '09:30:00',
      durationMin: 60,
      substituteId: null,
      reason: 'ошиблись датой',
    })
  })

  it.each([
    [{ date: '32.13.2026' }, 'Дата'],
    [{ start: '25:00' }, 'Время'],
    [{ durationMin: '10' }, 'от 15 до 600'],
    [{ durationMin: '700' }, 'от 15 до 600'],
    [{ teacherId: '' }, 'учителя'],
    [{ reason: '  ' }, 'причину'],
  ])('rejects %j', (patch, text) => {
    const r = editLessonForm.safeParse({ ...base, ...patch })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toContain(text)
  })
})

describe('parseTimeInput', () => {
  it('reads HH:MM, H:MM and HH:MM:SS', () => {
    expect(parseTimeInput('14:00')).toBe('14:00:00')
    expect(parseTimeInput('9:05')).toBe('09:05:00')
    expect(parseTimeInput('14:00:00')).toBe('14:00:00')
    expect(parseTimeInput('9:5')).toBeNull()
  })
})

describe('editLessonErrorMessage', () => {
  it('maps the database rules', () => {
    const e = (message: string) => editLessonErrorMessage({ code: '23514', message })
    expect(e('a held lesson cannot move to the future')).toMatch(/в будущее/)
    expect(e('an after-school lesson with hour marks keeps its date and duration')).toMatch(
      /Отмените проведение и проведите заново/,
    )
    expect(e('student x is not enrolled in the group on 2026-10-01')).toMatch(/другую дату/)
    expect(e('lesson x is in a closed period')).toMatch(/Период закрыт/)
    expect(e('payroll month 2026-09 is closed')).toMatch(/Месяц ЗП закрыт/)
    expect(e('reason is required')).toBe('Укажите причину')
    expect(editLessonErrorMessage({ code: '42501', message: 'only an admin' })).toMatch(/админ/)
    expect(editLessonErrorMessage({})).toMatch(/Нет связи/)
  })
})

describe('impactLines', () => {
  it('signs, names and drops zero rows', () => {
    expect(
      impactLines([
        { teacherId: 'a', teacherName: 'Гульзат Асанова', month: '2026-10-01', amount: -1050 },
        { teacherId: 'b', teacherName: 'Айжан Б.', month: '2026-11-01', amount: 1050 },
        { teacherId: 'c', teacherName: 'Тимур', month: '2026-11-01', amount: 0 },
      ]),
    ).toEqual([
      expect.stringMatching(/^Гульзат −1.050 сом за октябрь$/),
      expect.stringMatching(/^Айжан \+1.050 сом за ноябрь$/),
    ])
  })
})

describe('deleteRequestForm', () => {
  it('needs a reason', () => {
    expect(deleteRequestForm.safeParse({ requestId: id, reason: ' ' }).success).toBe(false)
    expect(deleteRequestForm.parse({ requestId: id, reason: ' x ' }).reason).toBe('x')
  })
})
