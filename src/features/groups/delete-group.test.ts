import { describe, expect, it } from 'vitest'
import { groupDeleteSummary, groupRefusals } from './delete-group'

describe('groupRefusals', () => {
  it('refuses a group with payments with a stable text', () => {
    const [text] = groupRefusals({ blockers: ['payments'], payments: 3, payments_som: 12000 })
    expect(text).toMatch(
      /^Нельзя удалить: в группе оплаты учеников на .*12.*000 сом \(3 платежей\)\./,
    )
    expect(text).toContain('архивируйте группу')
  })
  it('refuses a locked period', () => {
    expect(groupRefusals({ blockers: ['locked'], payments: 0, payments_som: 0 })[0]).toContain(
      'сначала откройте период на «Расчёт ЗП»',
    )
  })
  it('no blockers — no refusal', () => {
    expect(groupRefusals({ blockers: [], payments: 0, payments_som: 0 })).toEqual([])
  })
})

describe('groupDeleteSummary', () => {
  it('lists what goes', () => {
    expect(
      groupDeleteSummary({
        lessons: 24,
        held_lessons: 8,
        marks: 40,
        enrollments: 5,
        trials: 1,
        payments: 0,
        payments_som: 0,
        blockers: [],
      }),
    ).toBe('Удалится: 24 занятий (8 проведённых), 40 отметок, 5 зачислений, 1 пробных')
  })
})
