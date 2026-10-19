import { describe, expect, it } from 'vitest'
import { deleteErrorMessage, payrollImpactLines } from './delete-impact'
import {
  studentDeleteSummary,
  studentRefusals,
  STUDENT_REFUSAL_ACTIVE,
  STUDENT_REFUSAL_LOCKED,
} from './delete-student'

const row = (amount: number, month = '2026-09-01') => ({
  teacher_id: '00000000-0000-4000-8000-000000000001',
  teacher_name: 'Гульзат Акматова',
  month,
  marks: 3,
  amount,
})

describe('payrollImpactLines', () => {
  it('names the teacher, the loss and the month', () => {
    const [line] = payrollImpactLines([row(1050)])
    expect(line).toContain('учителю Гульзат −')
    expect(line).toMatch(/сом за сентябрь$/)
  })
  it('skips rows without a loss', () => {
    expect(payrollImpactLines([row(0)])).toEqual([])
  })
})

describe('studentRefusals', () => {
  it('maps blockers to texts', () => {
    expect(studentRefusals(['active_enrollment', 'locked'])).toEqual([
      STUDENT_REFUSAL_ACTIVE,
      STUDENT_REFUSAL_LOCKED,
    ])
    expect(studentRefusals([])).toEqual([])
  })
})

describe('studentDeleteSummary', () => {
  it('lists what goes', () => {
    const text = studentDeleteSummary({
      enrollments: 1,
      active_enrollments: 0,
      marks: 4,
      consumed_marks: 3,
      payments: 2,
      paid_som: 8000,
      refunded_som: 0,
      trials: 1,
      locked_marks: 0,
      blockers: [],
    })
    expect(text).toMatch(
      /^Удалится: 1 зачислений, 4 отметок, 2 оплат на .*8.*000 сом \(возвраты 0 сом\), 1 пробных$/,
    )
  })
})

describe('deleteErrorMessage', () => {
  it('maps the known errors', () => {
    expect(deleteErrorMessage({ code: '42501' }, 'group')).toBe(
      'Удалять может только администратор',
    )
    expect(deleteErrorMessage({ message: 'reason is required' }, 'student')).toBe('Укажите причину')
    expect(deleteErrorMessage({ code: 'P0002', message: 'x not found' }, 'student')).toBe(
      'Ученик уже удалён',
    )
    expect(
      deleteErrorMessage({ code: '23514', message: 'group cannot be deleted: payments' }, 'group'),
    ).toContain('оплаты')
    expect(deleteErrorMessage({}, 'group')).toContain('Не удалось удалить группу')
  })
})
