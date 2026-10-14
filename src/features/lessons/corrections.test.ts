import {
  changeLine,
  changesPayload,
  correctionErrorReason,
  latestRequest,
  markChanges,
  requestChanges,
  requestStatusText,
} from './corrections'
import type { Mark } from './attendance'

const roster = [
  { studentId: 's1', fullName: 'Айжан Б.' },
  { studentId: 's2', fullName: 'Тимур А.' },
]
const saved = new Map<string, Mark>([
  ['s1', 'present'],
  ['s2', 'absent_burned'],
])

describe('markChanges', () => {
  it('only the marks that differ, in roster order', () => {
    const edited = new Map<string, Mark>([
      ['s2', 'absent_frozen'],
      ['s1', 'present'],
    ])
    const changes = markChanges(roster, saved, edited)
    expect(changes).toEqual([
      { studentId: 's2', fullName: 'Тимур А.', from: 'absent_burned', to: 'absent_frozen' },
    ])
    expect(changesPayload(changes)).toEqual([{ student_id: 's2', status: 'absent_frozen' }])
    expect(markChanges(roster, saved, saved)).toEqual([])
  })

  it('«Айжан Б.: был → не был»', () => {
    expect(changeLine({ fullName: 'Айжан Б.', from: 'present', to: 'absent_burned' })).toBe(
      'Айжан Б.: был → не был',
    )
    expect(changeLine({ fullName: 'Айжан Б.', from: null, to: 'present' })).toBe(
      'Айжан Б.: без отметки → был',
    )
  })
})

describe('requests', () => {
  const base = {
    id: 'r',
    lesson_id: 'l',
    marks: [{ student_id: 's1', status: 'absent_burned' as const }],
    comment: 'не было',
    decided_at: null,
    decision_comment: null,
  }

  it('was → proposed against the saved marks', () => {
    expect(requestChanges(base, roster, saved)).toEqual([
      { studentId: 's1', fullName: 'Айжан Б.', from: 'present', to: 'absent_burned' },
    ])
  })

  it('drops marks already fixed by hand; all fixed → empty («Уже исправлено»)', () => {
    const request = {
      marks: [
        { student_id: 's1', status: 'absent_burned' as const },
        { student_id: 's2', status: 'absent_frozen' as const },
      ],
    }
    const partly = new Map<string, Mark>([
      ['s1', 'absent_burned'],
      ['s2', 'absent_burned'],
    ])
    expect(requestChanges(request, roster, partly)).toEqual([
      { studentId: 's2', fullName: 'Тимур А.', from: 'absent_burned', to: 'absent_frozen' },
    ])
    const fixed = new Map<string, Mark>([
      ['s1', 'absent_burned'],
      ['s2', 'absent_frozen'],
    ])
    expect(requestChanges(request, roster, fixed)).toEqual([])
  })

  it('the newest request and its status for the teacher', () => {
    const old = { ...base, status: 'rejected' as const, created_at: '2026-10-14T05:00:00Z' }
    const fresh = { ...base, status: 'pending' as const, created_at: '2026-10-14T06:00:00Z' }
    expect(latestRequest([old, fresh])).toBe(fresh)
    expect(latestRequest([])).toBeNull()
    expect(requestStatusText(fresh)).toBe('Ждёт решения администратора')
    expect(requestStatusText({ status: 'approved', decision_comment: null })).toBe('Исправлено')
    expect(requestStatusText({ status: 'rejected', decision_comment: 'Нет, был' })).toBe(
      'Отклонено: Нет, был',
    )
  })

  it('database errors in words', () => {
    expect(correctionErrorReason({})).toMatch(/нет связи/)
    expect(
      correctionErrorReason({ code: '23514', message: 'lesson x is in a closed period' }),
    ).toMatch(/период закрыт/)
    expect(correctionErrorReason({ code: '23514', message: 'freeze limit (2) exceeded' })).toMatch(
      /лимит заморозок/,
    )
    expect(correctionErrorReason({ code: '23505', message: 'duplicate' })).toMatch(/уже ждёт/)
    expect(correctionErrorReason({ code: '42501', message: '' })).toBe('недостаточно прав')
  })
})
