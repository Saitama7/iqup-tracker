import { describe, expect, it } from 'vitest'
import type { PaymentRow, StudentBalance } from './api'
import {
  amountPresets,
  balanceLine,
  carryToNext,
  filterPayments,
  formatPaidAt,
  journalCaption,
  journalRow,
  monthBounds,
  monthLabel,
  parseAmount,
  paymentHint,
  recentMonths,
  refundHint,
  shiftMonth,
  totals,
  totalsByGroup,
  totalsByTeacher,
  type Lookups,
} from './model'

const G8A = '00000000-0000-4000-b000-000000000001'
const G6 = '00000000-0000-4000-b000-000000000002'
const CHEM = '00000000-0000-4000-b000-000000000008'

const lookups: Lookups = {
  students: new Map([
    ['s1', { full_name: 'Нурлан Асанов' }],
    ['s2', { full_name: 'Асема Ниязова' }],
    ['s3', { full_name: 'Камила Орозова' }],
  ]),
  groups: new Map([
    [G8A, { label: 'Математика · 8 класс А', teacher: 'Гульзат' }],
    [G6, { label: 'Математика · 6 класс', teacher: 'Гульзат' }],
    [CHEM, { label: 'Химия · 9 класс', teacher: 'Эльмира' }],
  ]),
}

const pay = (
  over: Partial<PaymentRow> & { student?: string; group?: string; price?: number },
): PaymentRow => {
  const { student = 's1', group = G8A, price = 3200, ...rest } = over
  return {
    id: 'p1',
    amount: price,
    method: 'mbank',
    paid_at: '2026-10-01T08:05:00Z',
    kind: 'payment',
    reason: null,
    created_by: 'u1',
    createdByName: 'Алишка',
    subscription: {
      id: `sub-${student}-${group}`,
      lessons_total: 12,
      price_final: price,
      discount_percent: 0,
      hours_total: null,
      period_month: null,
      enrollment: { student_id: student, group_id: group },
    },
    ...rest,
  }
}

const balance = (over: Partial<StudentBalance> = {}): StudentBalance => ({
  subscriptionId: 'sub',
  studentId: 's1',
  groupId: G8A,
  refunded: false,
  unit: 'lesson',
  periodMonth: null,
  lessonsTotal: 12,
  priceFinal: 3200,
  paidSom: 3200,
  paidLessons: 12,
  carriedIn: 0,
  lessonsUsed: 0,
  lessonsLeft: 12,
  debtLessons: 0,
  debtSom: 0,
  refundSuggested: 3200,
  isCurrent: true,
  freezesUsed: 0,
  freezeLimit: 2,
  ...over,
})

describe('months', () => {
  it('shifts across years and labels the month', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(monthLabel('2026-10', '2026-10-13')).toBe('Октябрь')
    expect(monthLabel('2025-12', '2026-10-13')).toBe('Декабрь 2025')
    expect(recentMonths('2026-10-13', 3)).toEqual(['2026-10', '2026-09', '2026-08'])
  })
  it('bounds are Bishkek midnights', () => {
    expect(monthBounds('2026-10')).toEqual({
      from: '2026-10-01T00:00:00+06:00',
      to: '2026-11-01T00:00:00+06:00',
    })
  })
  it('paid_at in Bishkek: «1 окт 14:05»', () => {
    expect(formatPaidAt('2026-10-01T08:05:00Z')).toBe('1 окт 14:05')
    expect(formatPaidAt('2026-09-30T19:00:00Z')).toBe('1 окт 01:00')
  })
})

describe('journal', () => {
  it('a partial payment: «12 ур · 3 200», «Алишка · частично»', () => {
    const r = journalRow(pay({ amount: 1600 }), lookups)
    expect(r).toMatchObject({
      date: '1 окт 14:05',
      student: 'Нурлан Асанов',
      caption: 'Математика · 8 класс А',
      package: '12 ур · 3\u00a0200',
      method: 'Mbank',
      amount: 1600,
      author: 'Алишка · частично',
      refund: false,
    })
  })
  it('a refund: «остаток 5 ур», «Каныкей · возврат»', () => {
    const r = journalRow(
      pay({
        amount: -1333,
        kind: 'refund',
        method: 'cash',
        createdByName: 'Каныкей',
        student: 's2',
        group: G6,
      }),
      lookups,
    )
    expect(r).toMatchObject({
      package: 'остаток 5 ур',
      method: 'наличные',
      author: 'Каныкей · возврат',
      refund: true,
    })
  })
  it('a transfer (#81): «перенос», the direction in the author line, not a refund', () => {
    const r = journalRow(
      pay({ amount: -1800, kind: 'transfer', method: null, reason: 'перенос в Химия · 9 класс' }),
      lookups,
    )
    expect(r).toMatchObject({
      method: 'перенос',
      author: 'Алишка · перенос в Химия · 9 класс',
      refund: false,
      transfer: true,
    })
  })
  it('a discount is shown under the group', () => {
    const p = pay({ price: 2720 })
    p.subscription.discount_percent = 15
    expect(journalRow(p, lookups).caption).toBe('Математика · 8 класс А · скидка 15 %')
  })
  it('filters by method and group', () => {
    const rows = [pay({ id: 'a' }), pay({ id: 'b', method: 'cash' }), pay({ id: 'c', group: G6 })]
    expect(filterPayments(rows, { method: 'cash' }).map((r) => r.id)).toEqual(['b'])
    expect(filterPayments(rows, { group: G6 }).map((r) => r.id)).toEqual(['c'])
    expect(filterPayments(rows, {}).length).toBe(3)
  })
})

describe('totals (Г2, Г4)', () => {
  const rows = [
    pay({ id: 'a', amount: 1600 }),
    pay({ id: 'b', amount: 1600, method: 'cash' }),
    pay({ id: 'c', student: 's2', group: G6, method: 'cash' }),
    pay({ id: 'd', student: 's2', group: G6, amount: -1333, kind: 'refund', method: 'cash' }),
    pay({ id: 'e', student: 's3', group: CHEM, price: 3800 }),
  ]
  it('cash / Mbank apart, refunds separately, distinct subscriptions', () => {
    expect(totals(rows)).toEqual({
      total: 10200,
      cash: 4800,
      mbank: 5400,
      refunds: -1333,
      net: 8867,
      payments: 4,
      subscriptions: 3,
    })
    expect(journalCaption('2026-10', '2026-10-13', totals(rows))).toBe(
      'Октябрь · 10 200 сом · 4 платежа',
    )
  })
  it('a transfer pair (#81) is not money in or out', () => {
    const moved = [
      ...rows,
      pay({ id: 'f', amount: -1800, kind: 'transfer', method: null, reason: 'перенос в' }),
      pay({
        id: 'g',
        amount: 1800,
        kind: 'transfer',
        method: null,
        group: CHEM,
        reason: 'перенос из',
      }),
    ]
    expect(totals(moved)).toEqual(totals(rows))
  })
  it('by group and by teacher', () => {
    expect(totalsByGroup(rows, lookups).map((r) => [r.label, r.sub, r.net])).toEqual([
      ['Химия · 9 класс', 'Эльмира', 3800],
      ['Математика · 8 класс А', 'Гульзат', 3200],
      ['Математика · 6 класс', 'Гульзат', 1867],
    ])
    expect(totalsByTeacher(rows, lookups).map((r) => [r.label, r.sub, r.net, r.refunds])).toEqual([
      ['Гульзат', '2 группы', 5067, -1333],
      ['Эльмира', '1 группа', 3800, 0],
    ])
  })
})

describe('record panel', () => {
  it('balance line: soon / partial / debt', () => {
    expect(balanceLine(balance({ lessonsUsed: 11, lessonsLeft: 1 }))).toEqual({
      text: 'Текущий: осталось 1 из 12',
      state: 'soon',
      note: 'пора оплачивать',
    })
    expect(balanceLine(balance({ paidSom: 1600, paidLessons: 6 })).note).toBe('оплачено 6 из 12')
    expect(
      balanceLine(balance({ lessonsUsed: 14, lessonsLeft: -2, debtLessons: 2, debtSom: 533 })),
    ).toMatchObject({
      text: 'Текущий: сверх абонемента 2 урока',
      state: 'debt',
      note: 'долг 2 урока · 533 сом',
    })
  })
  it('presets: the rest and the debt on the current one, half / full on a new one', () => {
    expect(amountPresets('current', 3200, balance({ paidSom: 1600, paidLessons: 6 }))).toEqual([
      { label: '1 600 · остаток', amount: 1600 },
    ])
    expect(amountPresets('new', 7400, null).map((p) => p.amount)).toEqual([3700, 7400])
    expect(
      amountPresets(
        'current',
        7400,
        balance({
          lessonsTotal: 20,
          priceFinal: 7400,
          paidSom: 7400,
          lessonsUsed: 23,
          debtLessons: 3,
          debtSom: 1110,
        }),
      ),
    ).toEqual([{ label: '1 110 · закрыть долг', amount: 1110 }])
  })
  it('И37: a new subscription takes over the lessons «в долг» (АМ3)', () => {
    const current = balance({
      lessonsTotal: 20,
      priceFinal: 7400,
      paidSom: 7400,
      paidLessons: 20,
      lessonsUsed: 23,
    })
    expect(carryToNext(current)).toBe(3)
    expect(
      paymentHint('new', 7400, { lessonsTotal: 20, priceFinal: 7400, priceFull: 7400 }, current),
    ).toBe(
      'Откроется 20 уроков · 3 урока уйдут на погашение долга, доступно 17 · полная цена 7 400 · ЗП учителя считается от полной цены',
    )
  })
  it('a payment on the current one: what is opened', () => {
    const current = balance({ paidSom: 1600, paidLessons: 6, lessonsUsed: 2 })
    expect(
      paymentHint('current', 800, { lessonsTotal: 12, priceFinal: 3200, priceFull: 3200 }, current),
    ).toBe('После записи: оплачено 9 из 12, доступно 7 уроков')
  })
  it('refund hint (В8)', () => {
    expect(refundHint(balance({ lessonsUsed: 7, refundSuggested: 1333 }))).toBe(
      'Остаток 5 уроков × 266,67 сом = 1 333 сом',
    )
  })
  it('parseAmount', () => {
    expect(parseAmount('3 200')).toBe(3200)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('12a')).toBeNull()
  })
})

describe('продлёнка: счёт за месяц в часах (#82)', () => {
  const hours = (over: Partial<StudentBalance> = {}) =>
    balance({
      unit: 'hour',
      periodMonth: '2026-10-01',
      lessonsTotal: 21,
      priceFinal: 2583,
      paidSom: 2583,
      paidLessons: 21,
      lessonsUsed: 4,
      lessonsLeft: 17,
      ...over,
    })

  it('balanceLine names the month and counts hours', () => {
    expect(balanceLine(hours())).toMatchObject({
      text: 'Счёт за октябрь: осталось 17 из 21 ч',
      note: 'оплачен',
    })
    expect(
      balanceLine(
        hours({
          paidSom: 1230,
          paidLessons: 10,
          lessonsUsed: 12,
          lessonsLeft: 9,
          debtLessons: 2,
          debtSom: 246,
        }),
      ).note,
    ).toBe('долг 2 ч · 246 сом')
  })

  it('paymentHint after a part payment — in hours', () => {
    expect(
      paymentHint(
        'current',
        1230,
        { lessonsTotal: 21, priceFinal: 2583, priceFull: 2583 },
        hours({ paidSom: 0, paidLessons: 0 }),
      ),
    ).toBe('После записи: оплачено 10 из 21 ч, доступно 6 ч')
  })

  it('journal: «21 ч за октябрь · 2 583»', () => {
    const row = journalRow(
      pay({
        price: 2583,
        subscription: {
          id: 'h',
          lessons_total: 12,
          price_final: 2583,
          discount_percent: 0,
          hours_total: 21,
          period_month: '2026-10-01',
          enrollment: { student_id: 's1', group_id: G8A },
        },
      }),
      lookups,
    )
    expect(row.package).toBe('21 ч за октябрь · 2\u00a0583')
  })
})
