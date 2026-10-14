import { describe, expect, it } from 'vitest'
import {
  currentSubscription,
  filterRows,
  needsPayment,
  payCounts,
  formatDayMonth,
  formatLessonWhen,
  formatMarkedAt,
  initials,
  listCaption,
  matchesQuery,
  priceCaption,
  discountCaption,
  scheduleCaption,
  shortName,
  studentListRows,
  type Balance,
  type GroupBrief,
  type StudentRow,
  type StudentsSource,
  type SubscriptionRow,
} from './model'
import { listDebtCaption } from './pay-view'
import { formatSom } from '@/features/tariffs/model'

const G8A: GroupBrief = {
  id: 'g8a',
  name: '8 класс А',
  subject: 'Математика',
  group_type: 'group',
  status: 'active',
  start_date: '2026-09-01',
  end_date: null,
  teacher: { full_name: 'Гульзат Асанова' },
  schedule_rules: [2, 4, 6].map((weekday) => ({
    weekday,
    start_time: '09:00:00',
    valid_from: '2026-09-01',
    valid_to: null,
  })),
}
const CHEM: GroupBrief = { ...G8A, id: 'chem', name: '9 класс', subject: 'Химия' }

const sub = (id: string, over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id,
  lessons_total: 12,
  price_full: 3200,
  price_final: 3200,
  discount_percent: 0,
  discount_reason: 'none',
  started_at: '2026-09-01',
  status: 'active',
  created_at: '2026-09-01T10:00:00Z',
  ...over,
})

const student = (over: Partial<StudentRow>): StudentRow => ({
  id: 's',
  full_name: 'Ученик',
  grade: 8,
  parent_name: null,
  parent_phone: null,
  is_returning: false,
  referred_by_student_id: null,
  notes: null,
  created_at: '2026-09-01T10:00:00Z',
  enrollments: [],
  ...over,
})

/** A v_student_balance row; fully paid 12 lessons of 3 200 unless told otherwise. */
const bal = (subscriptionId: string, over: Partial<Balance> = {}): Balance => ({
  subscriptionId,
  studentId: 's',
  groupId: 'g8a',
  refunded: false,
  unit: 'lesson',
  periodMonth: null,
  lessonsTotal: 12,
  pricedTotal: 12,
  priceFinal: 3200,
  paidSom: 3200,
  paidLessons: 12,
  carriedIn: 0,
  lessonsUsed: 0,
  lessonsLeft: 12,
  debtLessons: 0,
  debtSom: 0,
  refundSuggested: 0,
  isCurrent: true,
  freezesUsed: 0,
  freezeLimit: 2,
  ...over,
})

const balances: Balance[] = [
  bal('k1', { lessonsUsed: 6, lessonsLeft: 6 }),
  bal('k2', { lessonsUsed: 10, lessonsLeft: 2 }),
  // half paid: 6 lessons open, nothing used yet
  bal('n1', { paidSom: 1600, paidLessons: 6 }),
  // used 14 of 12 paid: 2 lessons «в долг»
  bal('e1', { lessonsUsed: 14, lessonsLeft: -2, debtLessons: 2, debtSom: 533 }),
  // an older subscription that still owes 1 lesson
  bal('e0', { lessonsUsed: 13, lessonsLeft: -1, debtLessons: 1, debtSom: 267, isCurrent: false }),
]

const source: StudentsSource = {
  groups: [G8A, CHEM],
  students: [
    student({
      id: 'kamila',
      full_name: 'Камила Орозова',
      parent_phone: '996770555666',
      enrollments: [
        {
          id: 'ek1',
          group_id: 'g8a',
          start_date: '2026-09-01',
          end_date: null,
          status: 'active',
          subscriptions: [sub('k1')],
        },
        {
          id: 'ek2',
          group_id: 'chem',
          start_date: '2026-09-01',
          end_date: null,
          status: 'active',
          subscriptions: [sub('k2')],
        },
      ],
    }),
    student({
      id: 'nurlan',
      full_name: 'Нурлан Асанов',
      parent_phone: '996555999000',
      enrollments: [
        {
          id: 'en1',
          group_id: 'g8a',
          start_date: '2026-10-01',
          end_date: null,
          status: 'active',
          subscriptions: [sub('n1')],
        },
      ],
    }),
    student({
      id: 'elina',
      full_name: 'Элина Сыдыкова',
      enrollments: [
        {
          id: 'ee1',
          group_id: 'g8a',
          start_date: '2026-09-01',
          end_date: null,
          status: 'active',
          subscriptions: [sub('e0', { started_at: '2026-08-01' }), sub('e1')],
        },
      ],
    }),
    student({ id: 'new', full_name: 'Ёлка Новая', grade: null }),
  ],
}

describe('studentListRows (А5)', () => {
  const rows = studentListRows(source, balances)
  const by = (id: string) => rows.find((r) => r.id === id)

  it('left / total of the current subscription per active group, −N for a debt', () => {
    expect(by('kamila')).toMatchObject({
      groups: 'Математика · 8 класс А · Химия · 9 класс',
      remaining: '6 / 12 · 2 / 12',
      status: 'active',
      groupIds: ['g8a', 'chem'],
    })
    expect(by('nurlan')?.remaining).toBe('12 / 12')
    expect(by('elina')?.remaining).toBe('−2')
  })

  it('pay state and label: the worst of the groups', () => {
    expect(by('kamila')).toMatchObject({ payState: 'soon', payLabel: 'Пора оплачивать' })
    expect(by('nurlan')).toMatchObject({ payState: 'partial', payLabel: 'Частично · 6 ур' })
    expect(by('elina')).toMatchObject({ payState: 'debt', payLabel: 'Долг' })
  })

  it('debt sums over all subscriptions, old ones too', () => {
    expect(by('elina')).toMatchObject({ debtLessons: 3, debtSom: 800 })
    expect(by('nurlan')).toMatchObject({ debtLessons: 0, debtSom: 0 })
  })

  it('after-school hours not invoiced yet are a debt too (И69)', () => {
    const withUnbilled = studentListRows(source, balances, [
      { studentId: 'nurlan', hours: 21, som: 2583 },
    ])
    expect(withUnbilled.find((r) => r.id === 'nurlan')).toMatchObject({
      payState: 'debt',
      debtLessons: 0,
      debtHours: 21,
      debtSom: 2583,
    })
  })

  it('package lessons and after-school hours owed stay apart («долг 3 ур. + 21 ч»)', () => {
    const withUnbilled = studentListRows(source, balances, [
      { studentId: 'elina', hours: 21, som: 2583 },
    ])
    expect(withUnbilled.find((r) => r.id === 'elina')).toMatchObject({
      debtLessons: 3,
      debtHours: 21,
      debtSom: 800 + 2583,
    })
    expect(listDebtCaption(3, 21, 3383)).toBe(`долг 3 ур. + 21 ч · ${formatSom(3383)} сом`)
    expect(listDebtCaption(0, 6, 738)).toBe('долг 6 ч · 738 сом')
  })

  it('a fully paid student is «Оплачено» and needs no payment', () => {
    const [row] = studentListRows(
      { ...source, students: source.students.filter((s) => s.id === 'kamila') },
      [
        bal('k1', { lessonsUsed: 2, lessonsLeft: 10 }),
        bal('k2', { lessonsUsed: 1, lessonsLeft: 11 }),
      ],
    )
    expect(row).toMatchObject({ payState: 'paid', payLabel: 'Оплачено' })
    expect(needsPayment({ payState: row?.payState ?? null })).toBe(false)
    expect(needsPayment({ payState: by('nurlan')?.payState ?? null })).toBe(true)
  })

  it('not enrolled: no pay state', () => {
    expect(by('new')).toMatchObject({
      status: 'not_enrolled',
      groups: '',
      remaining: '',
      payState: null,
      payLabel: null,
    })
  })

  it('status: only finished enrollments (archived group) — not enrolled', () => {
    const [row] = studentListRows(
      {
        ...source,
        students: [
          student({
            id: 'gone',
            enrollments: [
              {
                id: 'eg1',
                group_id: 'g8a',
                start_date: '2026-09-01',
                end_date: '2026-10-11',
                status: 'finished',
                subscriptions: [sub('n1')],
              },
            ],
          }),
        ],
      },
      balances,
    )
    expect(row).toMatchObject({ status: 'not_enrolled', groups: '', remaining: '', groupIds: [] })
  })

  it('sorted by name', () => {
    expect(rows.map((r) => r.fullName)).toEqual([
      'Ёлка Новая',
      'Камила Орозова',
      'Нурлан Асанов',
      'Элина Сыдыкова',
    ])
  })

  it('caption counts active, debtors and idle students', () => {
    expect(listCaption(rows)).toBe('3 активных · 1 с долгом · 1 без группы')
    expect(listCaption(rows.slice(1, 2))).toBe('1 активный')
  })

  it('chip counters', () => {
    expect(payCounts(rows)).toEqual({ debt: 1, soon: 1, partial: 1 })
  })
})

describe('search and group filter', () => {
  const rows = studentListRows(source, balances)

  it('by name, case- and ё-insensitive', () => {
    expect(matchesQuery({ fullName: 'Нурлан Асанов', parentPhone: null }, 'асан')).toBe(true)
    expect(matchesQuery({ fullName: 'Ёлка Новая', parentPhone: null }, 'елка')).toBe(true)
    expect(matchesQuery({ fullName: 'Нурлан Асанов', parentPhone: null }, 'тимур')).toBe(false)
  })

  it('by parent phone in any common form', () => {
    const row = { fullName: 'Нурлан Асанов', parentPhone: '996555999000' }
    for (const q of ['0555 999 000', '555999', '+996 555 999 000', '999 000']) {
      expect(matchesQuery(row, q)).toBe(true)
    }
    expect(matchesQuery(row, '0700')).toBe(false)
    expect(matchesQuery({ ...row, parentPhone: null }, '555')).toBe(false)
  })

  it('group filter keeps students with an active enrollment in it', () => {
    expect(filterRows(rows, { group: 'chem' }).map((r) => r.id)).toEqual(['kamila'])
    expect(filterRows(rows, { group: 'g8a', q: 'нур' }).map((r) => r.id)).toEqual(['nurlan'])
    expect(filterRows(rows, {})).toHaveLength(4)
  })

  it('pay filter keeps one state', () => {
    expect(filterRows(rows, { pay: 'debt' }).map((r) => r.id)).toEqual(['elina'])
    expect(filterRows(rows, { pay: 'partial', group: 'g8a' }).map((r) => r.id)).toEqual(['nurlan'])
  })
})

describe('formatting', () => {
  it('dates and schedule as on А6', () => {
    expect(formatDayMonth('2026-10-01')).toBe('1 октября')
    expect(formatLessonWhen('2026-10-08', '09:00:00')).toBe('8 окт, чт 09:00')
    expect(scheduleCaption(G8A.schedule_rules, '2026-10-11')).toBe('ВТ ЧТ СБ 09:00')
    expect(scheduleCaption(G8A.schedule_rules, '2026-08-01')).toBe('')
  })

  it('names', () => {
    expect(initials('Нурлан Асанов')).toBe('НА')
    expect(initials('Айгуль')).toBe('А')
    expect(shortName('Тимур Мамбетов')).toBe('Тимур М.')
  })

  it('price and discount captions', () => {
    expect(priceCaption({ price_final: 3200, discount_percent: 0 })).toBe(
      '3\u00a0200 сом · без скидки',
    )
    expect(priceCaption({ price_final: 2720, discount_percent: 15 })).toBe(
      '2\u00a0720 сом · скидка 15 %',
    )
    expect(discountCaption({ discount_percent: 15 })).toBe('скидка 15 % · бывший ученик')
    expect(discountCaption({ discount_percent: 0 })).toBeNull()
  })
})

describe('currentSubscription', () => {
  it('the newest by start date, refunded ignored', () => {
    expect(
      currentSubscription({
        subscriptions: [
          sub('old', { started_at: '2026-09-01' }),
          sub('new', { started_at: '2026-10-05' }),
          sub('ref', { started_at: '2026-10-10', status: 'refunded' }),
        ],
      })?.id,
    ).toBe('new')
    expect(currentSubscription({ subscriptions: [] })).toBeNull()
  })
})

describe('formatMarkedAt', () => {
  it('time only on the lesson day, Bishkek time', () => {
    expect(formatMarkedAt('2026-10-08T04:02:00Z', '2026-10-08')).toBe('10:02')
    expect(formatMarkedAt('2026-10-07T02:40:00Z', '2026-10-06')).toBe('7 окт 08:40')
  })
})
