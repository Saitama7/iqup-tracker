import { describe, expect, it } from 'vitest'
import { formatSom } from '@/features/tariffs/model'
import type { PaymentRow } from '@/features/payments/api'
import { filterRows, type StudentListRow } from '@/features/students/model'
import {
  debtorLine,
  debtorsMore,
  debtSummary,
  debtTileCaption,
  todayPayments,
  todayPaymentsCaption,
} from './dashboard-money'

const row = (id: string, over: Partial<StudentListRow> = {}): StudentListRow => ({
  id,
  fullName: `Ученик ${id}`,
  grade: 8,
  parentPhone: null,
  groups: 'Математика · 8 класс А',
  groupIds: ['g8a'],
  remaining: '',
  status: 'active',
  payState: 'paid',
  payLabel: null,
  debtLessons: 0,
  debtHours: 0,
  debtSom: 0,
  ...over,
})

const pay = (paidAt: string, amount: number, kind: PaymentRow['kind'] = 'payment'): PaymentRow => ({
  id: `p-${paidAt}-${amount}`,
  amount,
  method: kind === 'transfer' ? null : 'cash',
  paid_at: paidAt,
  kind,
  reason: null,
  created_by: null,
  createdByName: null,
  subscription: {
    id: 'sub',
    lessons_total: 12,
    price_final: 3200,
    discount_percent: 0,
    hours_total: null,
    period_month: null,
    enrollment: { student_id: 's', group_id: 'g' },
  },
})

describe('debtSummary', () => {
  const rows = [
    row('a', { payState: 'debt', debtLessons: 2, debtSom: 534, fullName: 'Айжан Бекова' }),
    row('b', { payState: 'debt', debtLessons: 3, debtSom: 800 }),
    row('c', { payState: 'soon' }),
    row('d', { payState: 'partial' }),
    row('e'),
    row('f', { status: 'not_enrolled', payState: null, groups: '', groupIds: [] }),
  ]

  it('tile value equals А5 «Не оплатили»', () => {
    const s = debtSummary(rows)
    expect(s.unpaid).toBe(filterRows(rows, { pay: 'unpaid' }).length)
    expect(s).toMatchObject({ unpaid: 4, debt: 2, soon: 1, debtSom: 1334 })
    expect(debtTileCaption(s)).toBe('долг 2 · пора оплачивать 1')
  })

  it('debtors: biggest first, «и ещё N» over 5', () => {
    expect(debtSummary(rows).debtors.map((r) => r.id)).toEqual(['b', 'a'])
    expect(debtorsMore(rows.slice(0, 2))).toBeNull()
    expect(debtorsMore(Array.from({ length: 8 }))).toBe('и ещё 3 →')
  })

  it('empty → zeros', () => {
    expect(debtSummary([])).toMatchObject({ unpaid: 0, debt: 0, soon: 0, debtSom: 0, debtors: [] })
  })

  it('debtor line', () => {
    expect(debtorLine(debtSummary(rows).debtors[1] ?? row('x'))).toBe(
      'Айжан Б. · Математика · 8 класс А · долг 2 ур. · 534 сом',
    )
  })
})

describe('todayPayments', () => {
  const rows = [
    // 05.11 00:30 Bishkek — today
    pay('2026-11-04T18:30:00Z', 3200),
    pay('2026-11-05T12:00:00Z', 1600),
    pay('2026-11-05T13:00:00Z', -800, 'refund'),
    pay('2026-11-05T14:00:00Z', 1600, 'transfer'),
    // 04.11 23:59 Bishkek — yesterday
    pay('2026-11-04T17:59:00Z', 5000),
  ]

  it('Σ of today in Bishkek, payments only', () => {
    const t = todayPayments(rows, '2026-11-05')
    expect(t).toEqual({ total: 4800, payments: 2, monthTotal: 9800 })
    expect(todayPaymentsCaption(t, '2026-11-05')).toBe(`2 платежа · в ноябре ${formatSom(9800)}`)
  })

  it('no payments → 0', () => {
    const t = todayPayments([], '2026-11-05')
    expect(t).toEqual({ total: 0, payments: 0, monthTotal: 0 })
    expect(todayPaymentsCaption(t, '2026-11-05')).toBe('0 платежей · в ноябре 0')
  })
})
