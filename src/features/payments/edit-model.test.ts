import {
  deleteImpact,
  deleteImpactText,
  moveTargets,
  packageLabel,
  type ImpactSubscription,
} from './edit-model'

const sub = (over: Partial<ImpactSubscription>): ImpactSubscription => ({
  id: 's1',
  status: 'active',
  started_at: '2026-09-01',
  created_at: '2026-09-01T06:00:00Z',
  lessons_total: 12,
  price_final: 3200,
  used: 0,
  unit: 'lesson',
  hours: false,
  marks: 0,
  payments: [],
  ...over,
})

// formatSom groups thousands with a non-breaking space
const plain = (t: string) => t.replace(/\u00a0/g, ' ')
const said = (impact: ReturnType<typeof deleteImpact>) =>
  impact ? plain(deleteImpactText(impact)) : null

describe('deleteImpact (#92, delete_payment 0026)', () => {
  it('the duplicate «новый абонемент»: no other payment, no mark, another package → deleted', () => {
    const subs = [
      sub({ payments: [{ id: 'p1', amount: 3200 }] }),
      sub({ id: 's2', started_at: '2026-10-01', payments: [{ id: 'p2', amount: 3200 }] }),
    ]
    const impact = deleteImpact(subs, 's2', 'p2', 'payment')
    expect(impact).toEqual({ outcome: 'subscription_deleted', startedAt: '2026-10-01' })
    expect(said(impact)).toBe('Абонемент с 01.10 будет удалён — по нему нет других оплат и отметок')
  })
  it('a package with marks stays and owes — the debt from balance.ts', () => {
    const subs = [
      sub({ payments: [{ id: 'p1', amount: 3200 }] }),
      sub({
        id: 's2',
        started_at: '2026-10-01',
        used: 3,
        marks: 3,
        payments: [{ id: 'p2', amount: 3200 }],
      }),
    ]
    const impact = deleteImpact(subs, 's2', 'p2', 'payment')
    expect(impact).toEqual({ outcome: 'stays', marks: 3, debt: 3, debtSom: 800, unit: 'lesson' })
    expect(said(impact)).toBe(
      'Абонемент останется: по нему 3 отметки — появится долг 3 ур. · 800 сом',
    )
  })
  it('a second payment on the same package: the package stays, nothing owed', () => {
    const subs = [
      sub({
        used: 2,
        marks: 2,
        payments: [
          { id: 'p1', amount: 3200 },
          { id: 'p2', amount: 3200 },
        ],
      }),
    ]
    const impact = deleteImpact(subs, 's1', 'p2', 'payment')
    expect(impact).toMatchObject({ outcome: 'stays', debt: 0 })
    expect(said(impact)).toBe('Абонемент останется: по нему 2 отметки')
  })
  it('the only package of the enrollment stays unpaid', () => {
    const impact = deleteImpact(
      [sub({ payments: [{ id: 'p1', amount: 3200 }] })],
      's1',
      'p1',
      'payment',
    )
    expect(impact).toMatchObject({ outcome: 'stays', marks: 0 })
    expect(said(impact)).toBe('Абонемент останется')
  })
  it('an hour invoice is never deleted with its payment', () => {
    const subs = [
      sub({
        hours: true,
        unit: 'hour',
        lessons_total: 12,
        price_final: 1476,
        payments: [{ id: 'p1', amount: 1476 }],
      }),
      sub({
        id: 's2',
        hours: true,
        unit: 'hour',
        started_at: '2026-10-01',
        lessons_total: 12,
        price_final: 1476,
      }),
    ]
    expect(deleteImpact(subs, 's1', 'p1', 'payment')).toMatchObject({
      outcome: 'stays',
      unit: 'hour',
    })
  })
  it('a refund of a refunded subscription → active again', () => {
    const subs = [
      sub({
        status: 'refunded',
        payments: [
          { id: 'p1', amount: 3200 },
          { id: 'r1', amount: -2000 },
        ],
      }),
    ]
    const impact = deleteImpact(subs, 's1', 'r1', 'refund')
    expect(impact).toEqual({ outcome: 'reactivated' })
    expect(said(impact)).toBe('Абонемент снова станет действующим')
  })
  it('an unknown subscription → null', () => {
    expect(deleteImpact([], 's1', 'p1', 'payment')).toBeNull()
  })
})

describe('packageLabel', () => {
  const p = (s: Partial<{ hours_total: number | null; period_month: string | null }>) => ({
    subscription: {
      id: 's1',
      lessons_total: 12,
      price_final: 3200,
      discount_percent: 0,
      hours_total: null,
      period_month: null,
      enrollment: { student_id: 'x', group_id: 'g' },
      ...s,
    },
  })
  it('a package and an hour invoice', () => {
    expect(plain(packageLabel(p({})))).toBe('12 ур · 3 200')
    expect(plain(packageLabel(p({ hours_total: 60, period_month: '2026-10-01' })))).toMatch(
      /^60 ч за .+ · 3 200$/,
    )
  })
})

describe('«Изменить оплату» → «Абонемент» (#119)', () => {
  it('the enrollment’s subscriptions but refunded, oldest first', () => {
    expect(
      moveTargets(
        [
          sub({ id: 'b', started_at: '2026-10-14' }),
          sub({ id: 'r', started_at: '2026-08-01', status: 'refunded' }),
          sub({ id: 'a', started_at: '2026-09-07' }),
        ],
        'b',
      ),
    ).toEqual([
      { id: 'a', label: 'абонемент с 07.09 · 12 ур · 3\u00a0200' },
      { id: 'b', label: 'абонемент с 14.10 · 12 ур · 3\u00a0200' },
    ])
  })
})
