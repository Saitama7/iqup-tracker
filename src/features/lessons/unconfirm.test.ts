import { describe, expect, it } from 'vitest'
import { formatSom } from '@/features/tariffs/model'
import {
  unconfirmDoneText,
  unconfirmErrorReason,
  unconfirmImpactText,
  unconfirmRequestsText,
} from './unconfirm'

const gulzat = { teacherName: 'Гульзат Асанова', marks: 5, amount: 1050 }

describe('unconfirmImpactText', () => {
  it('names the teacher, the amount and the month', () => {
    expect(unconfirmImpactText(6, gulzat, '2026-10-14')).toBe(
      `Отметки 6 учеников будут удалены: учителю Гульзат −${formatSom(1050)} сом за октябрь`,
    )
  })

  it('one student — genitive singular', () => {
    expect(unconfirmImpactText(1, { ...gulzat, amount: 107 }, '2026-09-30')).toBe(
      'Отметки 1 ученика будут удалены: учителю Гульзат −107 сом за сентябрь',
    )
  })

  it('nothing accrued (all frozen)', () => {
    expect(unconfirmImpactText(3, { ...gulzat, marks: 0, amount: 0 }, '2026-10-14')).toBe(
      'Отметки 3 учеников будут удалены: начислений по занятию нет',
    )
  })

  it('no marks at all', () => {
    expect(unconfirmImpactText(0, { ...gulzat, marks: 0, amount: 0 }, '2026-10-14')).toBe(
      'Отметок у занятия нет, начислений по занятию нет',
    )
  })
})

describe('unconfirmRequestsText', () => {
  it('only when there are pending requests', () => {
    expect(unconfirmRequestsText(0)).toBeNull()
    expect(unconfirmRequestsText(1)).toBe('Запросы учителя на исправление (1) будут отклонены')
  })
})

describe('unconfirmDoneText', () => {
  it('group · dd.mm', () => {
    expect(unconfirmDoneText('8 класс А', '2026-10-14')).toBe(
      'Проведение отменено: 8 класс А · 14.10',
    )
  })
})

describe('unconfirmErrorReason', () => {
  it('maps the database errors', () => {
    expect(unconfirmErrorReason({ code: '42501', message: 'x' })).toMatch(/администратор/)
    expect(unconfirmErrorReason({ code: '23514', message: 'reason is required' })).toBe(
      'Укажите причину',
    )
    expect(unconfirmErrorReason({ code: '23514', message: 'lesson 1 is in a closed period' })).toBe(
      'Период закрыт — сначала откройте период',
    )
    expect(unconfirmErrorReason({ code: '23514', message: 'lesson 1 is not held' })).toMatch(
      /обновите/,
    )
    expect(unconfirmErrorReason({})).toMatch(/интернет/)
  })
})
