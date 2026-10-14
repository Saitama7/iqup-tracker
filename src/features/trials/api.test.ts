vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { describe, expect, it, vi } from 'vitest'
import { trialErrorMessage } from './api'

describe('trialErrorMessage', () => {
  it('an ambiguous name + phone match is not «уже записан» though it is 23505 too', () => {
    expect(
      trialErrorMessage({
        code: '23505',
        message: 'several students match the trial name and phone',
      }),
    ).toBe(
      'В учениках несколько человек с этим именем и телефоном — запишите пробное через «Уже учится»',
    )
  })

  it('23505 by rule', () => {
    expect(
      trialErrorMessage({ code: '23505', message: 'student is already enrolled in this group' }),
    ).toBe('Ученик уже зачислен в эту группу')
    expect(
      trialErrorMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      }),
    ).toBe('Этот ученик уже записан на это занятие')
  })

  it('trials_guard / enroll_trial messages', () => {
    const cases: [string, string][] = [
      [
        'a trial is booked on a planned lesson today or later',
        'Выберите занятие сегодня или позже',
      ],
      ['the trial lesson is not today yet', 'Отметить можно в день занятия'],
      ['the lesson was cancelled', 'Занятие отменено — перенесите пробное'],
      ['trial 1 is already decided', 'По этому пробному уже принято решение'],
      ['book the trial on another lesson', 'Выберите другое занятие'],
      [
        'the subscription starts after the trial lesson',
        'Абонемент начинается после пробного занятия — выберите дату позже',
      ],
      ['only an attended trial can be enrolled', 'Зачислить можно после отметки «был»'],
      ['group 1 is archived', 'Группа в архиве'],
      ['start date is outside the group dates', 'Дата начала — вне дат группы'],
      ['no tariff for the group', 'На эту дату нет тарифа для группы'],
    ]
    for (const [message, text] of cases) {
      expect(trialErrorMessage({ code: '23514', message })).toBe(text)
    }
  })

  it('no rights, unknown', () => {
    expect(
      trialErrorMessage({ code: '42501', message: 'only an admin books a trial after the fact' }),
    ).toBe('Недостаточно прав')
    expect(trialErrorMessage({ message: 'Failed to fetch' })).toBe(
      'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.',
    )
  })
})
