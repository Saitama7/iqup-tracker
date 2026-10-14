import { describe, expect, it } from 'vitest'
import type { Balance, Mark } from '@/features/lessons/attendance'
import { applyPresets, dayWord, presetCaption, presetEditable, presetErrorReason } from './model'
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

  it('editable: planned, open, today or later', () => {
    const l = { status: 'planned' as const, lesson_date: '2026-10-15', is_locked: false }
    expect(presetEditable(l, '2026-10-15')).toBe(true)
    expect(presetEditable(l, '2026-10-16')).toBe(false)
    expect(presetEditable({ ...l, status: 'held' }, '2026-10-14')).toBe(false)
    expect(presetEditable({ ...l, is_locked: true }, '2026-10-14')).toBe(false)
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
