import { describe, expect, it } from 'vitest'
import {
  availableLessons,
  debtOverLimit,
  paidLessons,
  payState,
  subscriptionBalances,
  totalDebt,
  type BalanceSubscription,
} from './balance'

const sub = (over: Partial<BalanceSubscription> = {}): BalanceSubscription => ({
  id: 's1',
  status: 'active',
  started_at: '2026-09-01',
  created_at: '2026-09-01T00:00:00Z',
  lessons_total: 12,
  price_final: 3200,
  used: 0,
  paid: 3200,
  ...over,
})

describe('paidLessons (В7.1)', () => {
  it('half of 3 200 opens 6 lessons, the rest opens all 12', () => {
    expect(paidLessons(1600, 12, 3200)).toBe(6)
    expect(paidLessons(3200, 12, 3200)).toBe(12)
  })
  it('rounds down: 1 700 → 6, 3 199 → 11', () => {
    expect(paidLessons(1700, 12, 3200)).toBe(6)
    expect(paidLessons(3199, 12, 3200)).toBe(11)
  })
  it('a discounted price divides exactly: 2 720 of 2 720 → 12 (no float noise)', () => {
    expect(paidLessons(2720, 12, 2720)).toBe(12)
    expect(paidLessons(3040, 12, 3040)).toBe(12)
  })
  it('nothing paid → 0; a free package → all lessons', () => {
    expect(paidLessons(0, 12, 3200)).toBe(0)
    expect(paidLessons(0, 12, 0)).toBe(12)
  })
  it('a carried debt (paid < 0, #81) floors to lessons owed', () => {
    expect(paidLessons(-600, 12, 3800)).toBe(-2)
    expect(paidLessons(-234, 12, 3800)).toBe(-1)
    expect(paidLessons(-100, 12, 3200)).toBe(-1)
  })
})

describe('subscriptionBalances', () => {
  it('partial payment: 1 600 of 3 200, 7 used → debt 1 lesson, 267 сом', () => {
    const [b] = subscriptionBalances([sub({ paid: 1600, used: 7 })])
    expect(b).toMatchObject({
      paidLessons: 6,
      lessonsUsed: 7,
      lessonsLeft: 5,
      debtLessons: 1,
      debtSom: 267,
      refundSuggested: 0,
      isCurrent: true,
    })
  })

  it('debt in money is what is owed beyond the payment: 1 700 paid, 7 used → 167', () => {
    const [b] = subscriptionBalances([sub({ paid: 1700, used: 7 })])
    expect(b).toMatchObject({ debtLessons: 1, debtSom: 167 })
  })

  it('beyond the package «в долг» (В7): 14 used of 12 → 2 lessons, 533,33 → 534 сом (ceil)', () => {
    const [b] = subscriptionBalances([sub({ used: 14 })])
    expect(b).toMatchObject({ lessonsLeft: -2, debtLessons: 2, debtSom: 534 })
  })

  it('after-school 7 400 / 20: 3 lessons «в долг» = 1 110 сом (АМ3)', () => {
    const [b] = subscriptionBalances([
      sub({ lessons_total: 20, price_final: 7400, used: 23, paid: 7400 }),
    ])
    expect(b).toMatchObject({ debtLessons: 3, debtSom: 1110 })
  })

  it('И37: debt is rounded up — paying it closes the debt (1 000 of 3 200, 5 used → 334)', () => {
    const [b] = subscriptionBalances([sub({ paid: 1000, used: 5 })])
    expect(b).toMatchObject({ paidLessons: 3, debtLessons: 2, debtSom: 334 })
    // 333 would leave 1 lesson in debt; 334 opens all 5
    expect(subscriptionBalances([sub({ paid: 1333, used: 5 })])[0]?.debtLessons).toBe(1)
    expect(subscriptionBalances([sub({ paid: 1334, used: 5 })])[0]).toMatchObject({
      debtLessons: 0,
      debtSom: 0,
    })
  })

  it('a tiny debt is at least 1 сом', () => {
    const [b] = subscriptionBalances([sub({ paid: 3199, used: 12 })])
    expect(b).toMatchObject({ debtLessons: 1, debtSom: 1 })
  })

  it('refund (В8): remaining paid lessons × price_final / lessons_total', () => {
    expect(subscriptionBalances([sub({ used: 8 })])[0]?.refundSuggested).toBe(1067)
    expect(subscriptionBalances([sub({ used: 0 })])[0]?.refundSuggested).toBe(3200)
    // only paid lessons are refunded
    expect(subscriptionBalances([sub({ paid: 1600, used: 2 })])[0]?.refundSuggested).toBe(1067)
    // with a discount: 2 720 / 12 × 5 = 1 133
    expect(
      subscriptionBalances([sub({ price_final: 2720, paid: 2720, used: 7 })])[0]?.refundSuggested,
    ).toBe(1133)
  })

  it('a debt carried by a transfer is a debt before the first lesson (#81)', () => {
    const [b] = subscriptionBalances([sub({ price_final: 3800, paid: -600, used: 0 })])
    expect(b).toMatchObject({ paidLessons: -2, lessonsUsed: 0, debtLessons: 2, debtSom: 600 })
    expect(b && payState(b)).toBe('debt')
    expect(totalDebt(b ? [b] : [])).toEqual({ lessons: 2, som: 600 })
    // paying it closes the debt, the rest opens lessons as usual
    const [paid] = subscriptionBalances([sub({ price_final: 3800, paid: 3200, used: 0 })])
    expect(paid).toMatchObject({ paidLessons: 10, debtLessons: 0, debtSom: 0 })
  })

  it('an exhausted subscription (closed by a transfer / «ушёл») suggests no refund', () => {
    const [b] = subscriptionBalances([sub({ status: 'exhausted', paid: 2200, used: 3 })])
    expect(b).toMatchObject({ paidLessons: 8, debtLessons: 0, debtSom: 0, refundSuggested: 0 })
  })

  it('a refunded subscription owes nothing and suggests nothing', () => {
    const [b] = subscriptionBalances([sub({ status: 'refunded', paid: 1867, used: 7 })])
    expect(b).toMatchObject({
      refunded: true,
      paidLessons: 7,
      debtLessons: 0,
      debtSom: 0,
      refundSuggested: 0,
      isCurrent: false,
    })
  })

  it('И37: lessons «в долг» move to the next subscription once it is bought', () => {
    const balances = subscriptionBalances([
      sub({ id: 'new', started_at: '2026-10-05', used: 1, paid: 3200 }),
      sub({ id: 'old', used: 15 }),
    ])
    expect(balances[1]).toMatchObject({
      subscriptionId: 'old',
      lessonsUsed: 12,
      debtLessons: 0,
      isCurrent: false,
    })
    expect(balances[0]).toMatchObject({
      subscriptionId: 'new',
      carriedIn: 3,
      lessonsUsed: 4,
      lessonsLeft: 8,
      debtLessons: 0,
      isCurrent: true,
    })
  })

  it('И37: an unpaid new subscription keeps the carried lessons as debt', () => {
    const balances = subscriptionBalances([
      sub({ id: 'old', used: 15 }),
      sub({ id: 'new', started_at: '2026-10-05', paid: 0 }),
    ])
    expect(balances[1]).toMatchObject({
      carriedIn: 3,
      lessonsUsed: 3,
      debtLessons: 3,
      debtSom: 800,
    })
    expect(totalDebt(balances)).toEqual({ lessons: 3, som: 800 })
  })

  it('И37: a debt paid on the old subscription is not carried again', () => {
    const balances = subscriptionBalances([
      sub({ id: 'old', used: 15, paid: 4000 }),
      sub({ id: 'new', started_at: '2026-10-05', used: 0 }),
    ])
    expect(balances[0]).toMatchObject({ paidLessons: 15, lessonsUsed: 15, debtLessons: 0 })
    expect(balances[1]).toMatchObject({ carriedIn: 0, lessonsUsed: 0 })
  })

  it('an old subscription paid in part keeps its debt; nothing carried while it has room', () => {
    const balances = subscriptionBalances([
      sub({ id: 'old', used: 10, paid: 1600 }),
      sub({ id: 'new', started_at: '2026-10-05', used: 0 }),
    ])
    expect(balances[0]).toMatchObject({
      lessonsUsed: 10,
      debtLessons: 4,
      debtSom: 1067,
      isCurrent: false,
    })
    expect(balances[1]).toMatchObject({ carriedIn: 0, debtLessons: 0 })
    expect(totalDebt(balances)).toEqual({ lessons: 4, som: 1067 })
  })

  it('a refunded subscription in the middle is skipped by the chain', () => {
    const balances = subscriptionBalances([
      sub({ id: 'a', used: 13 }),
      sub({ id: 'r', started_at: '2026-09-20', status: 'refunded', used: 0, paid: 0 }),
      sub({ id: 'b', started_at: '2026-10-01', used: 0 }),
    ])
    expect(balances[2]).toMatchObject({ carriedIn: 1, lessonsUsed: 1, isCurrent: true })
  })

  it('same start day — the earlier created first', () => {
    const balances = subscriptionBalances([
      sub({ id: 'b', created_at: '2026-09-01T10:00:00Z', used: 0 }),
      sub({ id: 'a', created_at: '2026-09-01T09:00:00Z', used: 13 }),
    ])
    expect(balances[0]).toMatchObject({ subscriptionId: 'b', carriedIn: 1, isCurrent: true })
  })
})

describe('«ушёл» evens the subscriptions out (#81, withdraw_enrollment) — same numbers as pgTAP', () => {
  // 3 800 / 12: old B paid 1 900, 12 used (−1 900); new A paid 3 800, 0 used (+3 800) → a transfer pair
  // +1 900 on B / −1 900 on A, then the refund comes from A
  const exited = (aPaid: number) =>
    subscriptionBalances([
      sub({ id: 'B', status: 'exhausted', price_final: 3800, used: 12, paid: 1900 + 1900 }),
      sub({
        id: 'A',
        status: 'exhausted',
        started_at: '2026-10-14',
        created_at: '2026-10-14T00:00:00Z',
        price_final: 3800,
        paid: aPaid,
      }),
    ])

  it('A +3 800, B −1 900, 1 900 refunded → no debt anywhere', () => {
    const balances = exited(3800 - 1900 - 1900)
    expect(totalDebt(balances)).toEqual({ lessons: 0, som: 0 })
    expect(balances.map((b) => [b.subscriptionId, b.paidSom, b.debtSom])).toEqual([
      ['B', 3800, 0],
      ['A', 0, 0],
    ])
  })

  it('A +1 000, B −1 900 → the net debt 900 on A only, not 1 900', () => {
    const balances = exited(1000 - 1900)
    expect(totalDebt(balances)).toEqual({ lessons: 3, som: 900 })
    expect(balances.find((b) => b.subscriptionId === 'A')).toMatchObject({
      paidSom: -900,
      debtLessons: 3,
      debtSom: 900,
    })
  })
})

describe('payState', () => {
  const state = (over: Partial<BalanceSubscription>) => {
    const [b] = subscriptionBalances([sub(over)])
    if (!b) throw new Error('no balance')
    return payState(b)
  }
  it('paid / soon / partial / debt', () => {
    expect(state({ used: 4 })).toBe('paid')
    expect(state({ used: 10 })).toBe('soon')
    expect(state({ paid: 1600, used: 1 })).toBe('partial')
    expect(state({ paid: 1600, used: 4 })).toBe('soon')
    expect(state({ paid: 1600, used: 7 })).toBe('debt')
    expect(state({ used: 13 })).toBe('debt')
  })
  it('availableLessons = paid − used', () => {
    const [b] = subscriptionBalances([sub({ paid: 1600, used: 2 })])
    expect(b && availableLessons(b)).toBe(4)
  })
  it('the 4th lesson «в долг» is over the limit (В7)', () => {
    expect(debtOverLimit(3)).toBe(false)
    expect(debtOverLimit(4)).toBe(true)
  })
})
