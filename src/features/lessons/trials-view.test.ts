import { describe, expect, it } from 'vitest'
import type { Trial } from '@/features/trials/model'
import { ownTrialsByLesson, tomorrowTrialCaption, trialInitials, trialsSuffix } from './trials-view'

const trial = (over: Partial<Trial>): Trial =>
  ({
    id: 't1',
    student_id: null,
    full_name: 'Нурай Жолдошева',
    lesson_id: 'l1',
    status: 'scheduled',
    lessonStatus: 'planned',
    ...over,
  }) as Trial

describe('ownTrialsByLesson', () => {
  it('keeps only trials of own lessons and skips cancelled lessons', () => {
    const map = ownTrialsByLesson(
      [
        trial({}),
        trial({ id: 't2', lesson_id: 'other' }),
        trial({ id: 't3', lesson_id: 'l2', lessonStatus: 'cancelled' }),
      ],
      [{ id: 'l1' }, { id: 'l2' }],
    )
    expect([...map.keys()]).toEqual(['l1'])
  })
})

describe('tomorrowTrialCaption', () => {
  it('names a lead as first time', () => {
    expect(tomorrowTrialCaption([trial({})])).toBe('+1 пробный · Нурай Ж. · первый раз')
  })
  it('omits «первый раз» for an existing student', () => {
    expect(tomorrowTrialCaption([trial({ student_id: 's1' })])).toBe('+1 пробный · Нурай Ж.')
  })
  it('names up to three, then counts', () => {
    const adema = trial({ id: 't2', full_name: 'Адема Кадырова' })
    expect(tomorrowTrialCaption([trial({}), adema])).toBe('+2 пробных · Нурай Ж., Адема К.')
    expect(tomorrowTrialCaption([trial({}), adema, trial({ id: 't3' }), trial({ id: 't4' })])).toBe(
      '+4 пробных',
    )
  })
})

describe('helpers', () => {
  it('initials', () => {
    expect(trialInitials('Розаина Бекова')).toBe('РБ')
    expect(trialInitials('Адема')).toBe('А')
  })
  it('suffix', () => {
    expect(trialsSuffix(0)).toBe('')
    expect(trialsSuffix(1)).toBe(' · +1 пробный')
  })
})
