import { describe, expect, it } from 'vitest'
import type { Balance, Mark } from '@/features/lessons/attendance'
import {
  applyPresets,
  dayWord,
  draftMarks,
  presetCaption,
  presetClearable,
  presetEditable,
  presetErrorReason,
} from './model'
import { presetLine } from './dashboard-presets'

const balance = (freezes: number): Balance => ({
  subscriptionId: 's1',
  total: 12,
  left: 8,
  freezes,
  freezeLimit: 2,
  lessonPrice: 300,
})

describe('applyPresets', () => {
  const roster = [
    { studentId: 'a', balance: balance(0) },
    { studentId: 'b', balance: balance(0) },
    { studentId: 'c', balance: balance(2) },
  ]

  it('fills «Заморозка» for students not marked yet; an explicit mark wins', () => {
    const marks = new Map<string, Mark>([['b', 'present']])
    const presets = new Map([
      ['a', { comment: 'заболел' }],
      ['b', { comment: null }],
    ])
    expect([...applyPresets(marks, presets, roster)]).toEqual([
      ['b', 'present'],
      ['a', 'absent_frozen'],
    ])
    expect(marks.has('a')).toBe(false)
  })

  it('no prefill when the subscription has no freezes left (В2)', () => {
    const out = applyPresets(new Map(), new Map([['c', { comment: null }]]), roster)
    expect(out.has('c')).toBe(false)
  })

  it('students outside the roster are ignored; no presets — the same map', () => {
    const marks = new Map<string, Mark>()
    expect(applyPresets(marks, new Map([['x', { comment: null }]]), roster).size).toBe(0)
    expect(applyPresets(marks, new Map(), roster)).toBe(marks)
  })
})

describe('presets copy', () => {
  it('caption with and without a comment', () => {
    expect(presetCaption({ comment: 'мама написала' })).toBe('Админ: предупредил · мама написала')
    expect(presetCaption({ comment: null })).toBe('Админ: предупредил')
  })

  it('editable: planned, open, not started yet (И56)', () => {
    const l = {
      status: 'planned' as const,
      lesson_date: '2026-10-15',
      planned_start: '14:00:00',
      is_locked: false,
    }
    const at = (t: string) => Date.parse(`2026-10-15T${t}:00+06:00`)
    expect(presetEditable(l, at('13:59'))).toBe(true)
    expect(presetEditable(l, at('14:00'))).toBe(false)
    expect(presetEditable({ ...l, status: 'held' }, at('09:00'))).toBe(false)
    expect(presetEditable({ ...l, is_locked: true }, at('09:00'))).toBe(false)
  })

  it('clearable until held, a cancelled lesson too', () => {
    expect(presetClearable({ status: 'planned', is_locked: false })).toBe(true)
    expect(presetClearable({ status: 'cancelled', is_locked: false })).toBe(true)
    expect(presetClearable({ status: 'held', is_locked: false })).toBe(false)
    expect(presetClearable({ status: 'cancelled', is_locked: true })).toBe(false)
  })

  it('error reasons', () => {
    expect(
      presetErrorReason({ code: '23514', message: 'freeze limit (2) exceeded for subscription x' }),
    ).toBe('лимит заморозок 2 на абонемент исчерпан')
    expect(presetErrorReason({ code: '42501', message: 'x' })).toBe(
      'заморозку заранее ставит только администратор',
    )
    expect(presetErrorReason({ code: '23514', message: 'lesson x is in the past' })).toBe(
      'занятие уже прошло',
    )
    expect(presetErrorReason({ code: '23514', message: 'lesson x has already started' })).toBe(
      'занятие уже началось — это не «заранее»',
    )
    expect(presetErrorReason({ message: 'Failed to fetch' })).toBe(
      'нет связи с сервером — проверьте интернет',
    )
  })

  it('day words and the dashboard line', () => {
    expect(dayWord('2026-10-14', '2026-10-14')).toBe('Сегодня')
    expect(dayWord('2026-10-15', '2026-10-14')).toBe('Завтра')
    expect(dayWord('2026-10-20', '2026-10-14')).toBe('20 окт')
    expect(
      presetLine(
        {
          id: 'p',
          studentId: 's',
          studentName: 'Айжан Б.',
          comment: 'заболела',
          lesson: {
            id: 'l',
            lesson_date: '2026-10-15',
            planned_start: '11:00:00',
            group: { id: 'g', name: '8 класс А', subject: 'Математика' },
          },
        },
        '2026-10-14',
      ),
    ).toBe('Завтра 11:00 · Математика · 8 класс А — Айжан Б. · заболела')
  })
})

describe('draftMarks', () => {
  it("keeps only the teacher's marks, not the prefilled «Заморозка» (И27)", () => {
    const own = new Map<string, Mark>([['b', 'present']])
    const shown = new Map<string, Mark>([
      ['b', 'present'],
      ['a', 'absent_frozen'],
    ])
    const next = new Map(shown).set('c', 'present')
    expect([...draftMarks(next, own, shown)]).toEqual([
      ['b', 'present'],
      ['c', 'present'],
    ])
  })

  it("a changed preset student is the teacher's mark", () => {
    const shown = new Map<string, Mark>([['a', 'absent_frozen']])
    const next = new Map(shown).set('a', 'present')
    expect([...draftMarks(next, new Map(), shown)]).toEqual([['a', 'present']])
  })
})
