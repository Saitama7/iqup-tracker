// #126: А4 / «Мои группы» show debt / available from the balance, never lessons_total − used.
import { describe, expect, it } from 'vitest'
import {
  availableLessons,
  subscriptionBalances,
  totalDebt,
  type BalanceSubscription,
} from '@/features/payments/balance'
import { memberLeftCell } from './model'

const sub = (id: string, started_at: string, used: number, paid: number): BalanceSubscription => ({
  id,
  status: 'active',
  started_at,
  created_at: started_at,
  lessons_total: 12,
  price_final: 3200,
  used,
  paid,
})

/** What members() does: debt over every subscription, available of the newest. */
function cell(subs: BalanceSubscription[]) {
  const balances = subscriptionBalances(subs)
  const current = balances.find((b) => b.isCurrent)
  if (!current) return memberLeftCell(null)
  return memberLeftCell({
    debt: totalDebt(balances).lessons,
    available: availableLessons(current),
    total: current.lessonsTotal,
    unit: 'lesson',
  })
}

describe('memberLeftCell', () => {
  it('used 20, paid twice (24 lessons) → 4 / 12, no debt', () => {
    expect(cell([sub('a', '2026-09-01', 20, 6400)])).toEqual({
      text: '4 / 12',
      label: 'доступно 4 из 12',
      tone: null,
    })
  })

  it('used 14, paid 12 → −2 debt', () => {
    expect(cell([sub('a', '2026-09-01', 14, 3200)])).toEqual({
      text: '−2',
      label: 'долг 2 ур.',
      tone: 'debt',
    })
  })

  it('partial: used 2, paid 6 → 4 / 12', () => {
    expect(cell([sub('a', '2026-09-01', 2, 1600)]).text).toBe('4 / 12')
  })

  it('old debt 3 moves into the new paid subscription (И37) → 8 / 12', () => {
    const c = cell([sub('old', '2026-09-01', 15, 3200), sub('new', '2026-10-01', 1, 3200)])
    expect(c.text).toBe('8 / 12')
    expect(c.tone).toBeNull()
  })

  it('≤ 2 available → low', () => {
    expect(cell([sub('a', '2026-09-01', 10, 3200)])).toMatchObject({ text: '2 / 12', tone: 'low' })
  })

  it('no subscription → —', () => {
    expect(memberLeftCell(null)).toEqual({ text: '—', label: null, tone: null })
  })

  it('hours → formatHours', () => {
    expect(memberLeftCell({ debt: 0, available: 7.5, total: 20, unit: 'hour' })).toEqual({
      text: '7,5 / 20',
      label: 'доступно 7,5 из 20 ч',
      tone: null,
    })
    expect(memberLeftCell({ debt: 1.5, available: 0, total: 20, unit: 'hour' }).label).toBe(
      'долг 1,5 ч',
    )
  })
})
