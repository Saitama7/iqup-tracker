import { describe, expect, it } from 'vitest'
import type { GroupBrief } from '@/features/students/model'
import type { Settlement, TransferPreview } from './exit-api'
import {
  exitTargets,
  impactCaption,
  marksCaption,
  settlementLines,
  targetLabel,
  toPayCaption,
  transferTargets,
  withdrawDefaultDate,
  withdrawMinDate,
} from './exit-model'

/** formatSom puts a non-breaking space between thousands. */
const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ')
const spLines = (lines: { label: string; value: string }[]) =>
  lines.map((l) => ({ ...l, value: sp(l.value) }))

const group = (id: string, name: string, extra: Partial<GroupBrief> = {}): GroupBrief => ({
  id,
  name,
  subject: 'Математика',
  group_type: 'group',
  status: 'active',
  start_date: '2026-09-01',
  end_date: null,
  teacher: null,
  schedule_rules: [],
  ...extra,
})

const settlement = (extra: Partial<Settlement> = {}): Settlement => ({
  present: 9,
  burned: 0,
  frozen: 0,
  locked: 0,
  lastMarkDate: '2026-10-08',
  payments: 1,
  moneySom: 7200,
  paidSom: 7200,
  lessonsUsed: 9,
  hoursUsed: 0,
  usedSom: 5400,
  remainder: 1800,
  lessonPrice: 600,
  hasTrial: false,
  unit: 'lesson',
  ...extra,
})

const preview = (extra: Partial<TransferPreview> = {}): TransferPreview => ({
  startDate: '2026-10-15',
  wholeMove: false,
  lessonsTotal: 12,
  price: 3800,
  remainder: 1800,
  toPay: 2000,
  surplus: 0,
  ...extra,
})

describe('exitTargets', () => {
  it('any type, not the current one, not archived, by label', () => {
    const from = group('a', 'Хадижа', { group_type: 'individual' })
    const list = exitTargets(
      [
        from,
        group('b', '8 класс Б', { group_type: 'mini' }),
        group('c', '5 класс'),
        group('d', 'старая', { status: 'archived' }),
      ],
      from,
    )
    expect(list.map((g) => g.id)).toEqual(['c', 'b'])
    expect(targetLabel(list[1] as GroupBrief)).toBe('Математика · 8 класс Б · Мини-группа')
  })
})

describe('money captions', () => {
  it('Hadija: paid, used 9 × 600, remainder', () => {
    expect(spLines(settlementLines(settlement()))).toEqual([
      { label: 'Оплачено', value: '7 200 сом' },
      { label: 'Отучено', value: '9 уроков × 600 = 5 400 сом' },
      { label: 'Остаток', value: '1 800 сом', tone: 'left' },
    ])
  })

  it('a debt', () => {
    const lines = spLines(
      settlementLines(
        settlement({
          paidSom: 1000,
          lessonsUsed: 6,
          usedSom: 1600,
          remainder: -600,
          lessonPrice: 3200 / 12,
        }),
      ),
    )
    expect(lines[1]?.value).toBe('6 уроков × 266,67 = 1 600 сом')
    expect(lines[2]).toEqual({ label: 'Долг', value: '600 сом', tone: 'debt' })
  })

  it('an after-school bill in hours (#82)', () => {
    const lines = spLines(
      settlementLines(
        settlement({
          paidSom: 2000,
          lessonsUsed: 0,
          hoursUsed: 5.5,
          usedSom: 550,
          remainder: 1450,
          lessonPrice: 100,
          unit: 'hour',
        }),
      ),
    )
    expect(lines[1]).toEqual({ label: 'Списано', value: '5,5 ч × 100/ч = 550 сом' })
    expect(lines[2]).toEqual({ label: 'Остаток', value: '1 450 сом', tone: 'left' })
  })

  it('old lessons and hours are not summed into one number (#82)', () => {
    const lines = spLines(
      settlementLines(
        settlement({
          paidSom: 9400,
          lessonsUsed: 20,
          hoursUsed: 6,
          usedSom: 8138,
          remainder: 1262,
          lessonPrice: 123,
          unit: 'hour',
        }),
      ),
    )
    expect(lines[1]).toEqual({ label: 'Списано', value: '20 уроков + 6 ч × 123/ч = 8 138 сом' })
  })

  it('no transfer to an after-school group (#82)', () => {
    const from = group('g1', '8 класс А')
    const groups = [
      from,
      group('g2', '8 класс Б'),
      group('g3', 'Продлёнка', { group_type: 'afterschool' }),
    ]
    expect(transferTargets(groups, from).map((g) => g.id)).toEqual(['g2'])
    expect(exitTargets(groups, from).map((g) => g.id)).toContain('g3')
  })

  it('to pay in the new group', () => {
    expect(sp(toPayCaption(preview()))).toBe('3 800 − 1 800 = 2 000 сом')
    expect(sp(toPayCaption(preview({ remainder: -600, toPay: 4400 })))).toBe(
      '3 800 + долг 600 = 4 400 сом',
    )
    expect(sp(toPayCaption(preview({ remainder: 6000, toPay: 0, surplus: 2200 })))).toBe(
      '3 800 − 3 800 = 0 сом',
    )
    expect(sp(toPayCaption(preview({ remainder: 0, toPay: 3800 })))).toBe('3 800 сом')
    expect(toPayCaption(preview({ price: null }))).toBe('Нет тарифа на эту дату')
  })

  it('payroll impact', () => {
    expect(
      sp(
        impactCaption({
          teacherId: 't',
          teacherName: 'Гульзат Асанова',
          lessons: 3,
          amount: 1050,
          hourMarks: 0,
          hours: 0,
        }),
      ),
    ).toBe('учителю Гульзат −1 050 сом за 3 урока')
  })

  it('payroll impact by hours: days and hours, not lessons (#82)', () => {
    const i = { teacherId: 't', teacherName: 'Айжан Бекова', amount: 150, hourMarks: 2, hours: 3 }
    expect(sp(impactCaption({ ...i, lessons: 2 }))).toBe('учителю Айжан −150 сом за 2 дн. (3 ч)')
    // a migrated student: old 20-lesson package marks + hour-bill days
    expect(sp(impactCaption({ ...i, lessons: 3, hours: 4.5 }))).toBe(
      'учителю Айжан −150 сом за 1 урок и 2 дн. (4,5 ч)',
    )
  })

  it('marks to delete', () => {
    expect(marksCaption(settlement({ present: 3, burned: 1, frozen: 2 }))).toBe(
      'Отметки: «был» — 3, «не был» — 1, «заморожен» — 2',
    )
    expect(marksCaption(settlement({ present: 0 }))).toBeNull()
  })
})

describe('withdraw dates', () => {
  it('not before the start and the last written-off mark', () => {
    expect(withdrawMinDate('2026-09-01', '2026-10-08')).toBe('2026-10-08')
    expect(withdrawMinDate('2026-09-01', null)).toBe('2026-09-01')
    expect(withdrawDefaultDate('2026-10-14', '2026-10-08')).toBe('2026-10-14')
    expect(withdrawDefaultDate('2026-10-14', '2026-10-20')).toBe('2026-10-20')
  })
})
