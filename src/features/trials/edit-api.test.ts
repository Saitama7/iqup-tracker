vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { describe, expect, it, vi } from 'vitest'
import {
  editTrialErrorMessage,
  editTrialForm,
  lessonPickerKind,
  reopenTarget,
  reopenTrialForm,
} from './edit-api'

const id = '11111111-1111-4111-8111-111111111111'
const lesson = '22222222-2222-4222-8222-222222222222'
const base = {
  trialId: id,
  fullName: ' Айжан ',
  grade: '7',
  phone: '0555 123 456',
  source: 'instagram',
  note: ' подруга ',
  lessonId: '',
  reason: ' опечатка ',
}

describe('editTrialForm', () => {
  it('normalizes the fields; empty lesson = keep', () => {
    const r = editTrialForm.parse(base)
    expect(r).toMatchObject({
      fullName: 'Айжан',
      grade: 7,
      phone: '996555123456',
      source: 'instagram',
      note: 'подруга',
      lessonId: null,
      reason: 'опечатка',
    })
  })

  it('empty grade / phone / source clear the value', () => {
    const r = editTrialForm.parse({ ...base, grade: '', phone: '', source: '', lessonId: lesson })
    expect(r).toMatchObject({ grade: null, phone: null, source: null, lessonId: lesson })
  })

  it('requires name, reason and a valid phone', () => {
    expect(editTrialForm.safeParse({ ...base, fullName: ' ' }).error?.issues[0]?.message).toBe(
      'Введите имя',
    )
    expect(editTrialForm.safeParse({ ...base, reason: ' ' }).error?.issues[0]?.message).toBe(
      'Укажите причину',
    )
    expect(editTrialForm.safeParse({ ...base, phone: '12' }).success).toBe(false)
    expect(editTrialForm.safeParse({ ...base, reason: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('reopenTrialForm', () => {
  it('needs a reason', () => {
    expect(reopenTrialForm.safeParse({ trialId: id, reason: '' }).success).toBe(false)
    expect(reopenTrialForm.parse({ trialId: id, reason: ' ошибка ' }).reason).toBe('ошибка')
  })
})

describe('editTrialErrorMessage', () => {
  it.each([
    [{ code: '23505', message: 'duplicate key' }, 'Этот человек уже записан на это занятие'],
    [{ message: 'a decided trial keeps its lesson' }, 'Занятие решённого пробного не меняется'],
    [
      { message: 'a trial is booked on a planned lesson today or later' },
      'Выберите запланированное занятие сегодня или позже',
    ],
    [{ message: 'the trial lesson must have taken place' }, 'Выберите прошедшее занятие'],
    [{ message: 'reason is required' }, 'Укажите причину'],
    [{ code: '42501', message: 'only an admin may edit a trial' }, 'Недостаточно прав'],
  ])('%j', (error, text) => {
    expect(editTrialErrorMessage(error)).toBe(text)
  })
})

describe('reopenTarget', () => {
  const t = { came: null, lessonDate: '2026-10-20', lessonStatus: 'planned' as const }
  it('mirrors reopen_trial', () => {
    expect(reopenTarget({ ...t, came: true }, '2026-10-19')).toBe('attended')
    expect(reopenTarget({ ...t, came: false }, '2026-10-19')).toBe('no_show')
    expect(reopenTarget(t, '2026-10-19')).toBe('scheduled')
    expect(reopenTarget({ ...t, lessonDate: '2026-10-18' }, '2026-10-19')).toBe('no_show')
    expect(reopenTarget({ ...t, lessonStatus: 'cancelled' }, '2026-10-19')).toBe('no_show')
  })
})

describe('lessonPickerKind', () => {
  it('by status', () => {
    expect(lessonPickerKind('scheduled')).toBe('ahead')
    expect(lessonPickerKind('attended')).toBe('past')
    expect(lessonPickerKind('no_show')).toBe('past')
    expect(lessonPickerKind('enrolled')).toBeNull()
    expect(lessonPickerKind('closed')).toBeNull()
  })
})
