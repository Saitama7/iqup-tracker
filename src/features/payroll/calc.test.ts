import { describe, expect, it } from 'vitest'
import type { GroupType } from '@/features/tariffs/current'
import {
  advancesTotal,
  byGroup,
  byTeacher,
  calcLessonPay,
  calcMonth,
  markPay,
  roundSom,
  subscriptionLessonPrice,
  toPay,
  totals,
  type PayLesson,
  type PayMark,
  type PaySubscription,
} from './calc'

// Subscriptions at the tariffs of September 2026 — 01-domain-model.md §3.
const SUB: Record<'group' | 'mini' | 'afterschool' | 'group2025', PaySubscription> = {
  group: { price_full: 3200, lessons_total: 12 },
  mini: { price_full: 3800, lessons_total: 12 },
  afterschool: { price_full: 7400, lessons_total: 20 },
  group2025: { price_full: 3000, lessons_total: 12 },
}

const RATE_45 = [{ percent: 45, valid_from: '2026-09-01' }]

let seq = 0
function lesson(
  over: Partial<PayLesson> & { marks?: PayMark[]; sub?: PaySubscription | null } = {},
): PayLesson {
  const { marks = ['present'], sub = SUB.group, ...rest } = over
  seq++
  return {
    id: `l${seq}`,
    group_id: 'g1',
    lesson_date: '2026-09-15',
    duration_min: 60,
    status: 'held',
    attendance: marks.map((status) => ({ status, subscription: sub })),
    ...rest,
  }
}

const present = (n: number): PayMark[] => Array.from({ length: n }, () => 'present')

describe('calcLessonPay — §3 «Учителю за ученико-урок»', () => {
  // [type, package, lessons, 45 %, 50 %] — the table rounds to kopecks.
  const table: [GroupType, number, number, number, number][] = [
    ['group', 3200, 12, 120.0, 133.33],
    ['mini', 3800, 12, 142.5, 158.33],
    ['pair', 4400, 12, 165.0, 183.33],
    ['individual', 7200, 12, 270.0, 300.0],
    ['afterschool', 7400, 20, 166.5, 185.0],
  ]

  it.each(table)('%s: %i / %i → %d (45 %%) · %d (50 %%)', (_, price, lessons, p45, p50) => {
    const terms = { consumedCount: 1, packagePrice: price, lessonsInPackage: lessons }
    expect(calcLessonPay({ ...terms, percent: 45 })).toBeCloseTo(p45, 2)
    expect(calcLessonPay({ ...terms, percent: 50 })).toBeCloseTo(p50, 2)
  })

  it('subscriptionLessonPrice: price_full / lessons_total', () => {
    expect(subscriptionLessonPrice(SUB.group)).toBeCloseTo(266.67, 2)
    expect(subscriptionLessonPrice(SUB.afterschool)).toBe(370)
  })

  it('266,67 × 45 % × 318 ученико-уроков = 38 160 (Гульзат, сентябрь)', () => {
    const pay = calcLessonPay({
      consumedCount: 318,
      packagePrice: 3200,
      lessonsInPackage: 12,
      percent: 45,
    })
    expect(roundSom(pay)).toBe(38_160)
  })

  it('8 учеников × 12 занятий групповой → 11 520 (пример §6)', () => {
    const month = calcMonth(
      Array.from({ length: 12 }, () => lesson({ marks: present(8) })),
      RATE_45,
    )
    expect(month.amount).toBe(11_520)
    expect(month.studentLessons).toBe(96)
  })
})

describe('calcMonth', () => {
  it('counts present and absent_burned, not absent_frozen (А1.3)', () => {
    const month = calcMonth(
      [lesson({ marks: ['present', 'absent_burned', 'absent_frozen', 'present'] })],
      RATE_45,
    )
    expect(month.studentLessons).toBe(3)
    expect(month.amount).toBe(360)
  })

  it('planned and cancelled lessons pay nothing and are not «проведено» (А6, Б2)', () => {
    const month = calcMonth(
      [
        lesson({ marks: present(5) }),
        lesson({ status: 'planned', marks: present(5) }),
        lesson({ status: 'cancelled', marks: [] }),
      ],
      RATE_45,
    )
    expect(month.lessonsHeld).toBe(1)
    expect(month.studentLessons).toBe(5)
    expect(month.amount).toBe(600)
    expect(month.lessons.map((p) => p.lesson.status)).toEqual(['held'])
  })

  it('a held lesson with nobody consuming (only trials, Ж6) counts as held, pays 0', () => {
    const month = calcMonth([lesson({ marks: [] })], RATE_45)
    expect(month).toMatchObject({ lessonsHeld: 1, hours: 1, studentLessons: 0, amount: 0 })
  })

  it('percent changed mid-month: each lesson by the rate on its date', () => {
    const rates = [
      { percent: 45, valid_from: '2026-09-01' },
      { percent: 50, valid_from: '2026-09-16' },
    ]
    const month = calcMonth(
      [
        lesson({ lesson_date: '2026-09-15', marks: present(6) }),
        lesson({ lesson_date: '2026-09-16', marks: present(6) }),
      ],
      rates,
    )
    // 6 × 120 + 6 × 133,33 = 720 + 800
    expect(month.lessons.map((p) => roundSom(p.pay))).toEqual([720, 800])
    expect(month.amount).toBe(1_520)
  })

  it('price of the subscription the mark was written off, not of the tariff on the date (К6)', () => {
    // bought at 3000 before the tariff became 3200 on 01.09 — lessons after it still pay 3000 / 12
    const month = calcMonth(
      [lesson({ lesson_date: '2026-09-20', marks: present(1), sub: SUB.group2025 })],
      [{ percent: 45, valid_from: '2026-01-01' }],
    )
    // 3000 / 12 × 45 % = 112,5
    expect(month.lessons[0]?.pay).toBe(112.5)
    expect(month.amount).toBe(113)
  })

  it('a tariff changed after the purchase does not change the accrual (К6)', () => {
    // same lessons, the subscription kept its price — nothing else goes into calcMonth
    const marks = present(8)
    const before = calcMonth([lesson({ lesson_date: '2026-09-15', marks })], RATE_45)
    const after = calcMonth([lesson({ lesson_date: '2026-11-15', marks })], RATE_45)
    expect(after.amount).toBe(before.amount)
    expect(after.amount).toBe(960)
  })

  it('marks of one lesson on different subscriptions are priced each by its own', () => {
    const month = calcMonth(
      [
        {
          ...lesson(),
          attendance: [
            { status: 'present', subscription: SUB.group },
            { status: 'absent_burned', subscription: SUB.group2025 },
            { status: 'absent_frozen', subscription: SUB.group },
          ],
        },
      ],
      RATE_45,
    )
    // 120 + 112,5
    expect(month.lessons[0]?.pay).toBe(232.5)
    expect(month.studentLessons).toBe(2)
  })

  it('К3: a student with a discount gives the teacher the same share as without', () => {
    // Сабырбекова Асия pays 2 880 (−10 %), the teacher gets the full 3 200 / 12 × 45 % = 120
    const discounted = { price_full: 3200, lessons_total: 12, price_final: 2880 }
    const month = calcMonth(
      [
        {
          ...lesson(),
          attendance: [
            { status: 'present', subscription: SUB.group },
            { status: 'present', subscription: discounted },
          ],
        },
      ],
      RATE_45,
    )
    expect(markPay(discounted, 45)).toBe(markPay(SUB.group, 45))
    expect(month.lessons[0]?.pay).toBe(240)
  })

  it('a consumed mark without a subscription counts, pays 0 and is flagged (И5)', () => {
    const month = calcMonth(
      [
        {
          ...lesson(),
          attendance: [
            { status: 'present', subscription: SUB.group },
            { status: 'present', subscription: null },
            { status: 'absent_frozen', subscription: null },
          ],
        },
      ],
      RATE_45,
    )
    expect(month).toMatchObject({ studentLessons: 2, noSubscription: 1, amount: 120 })
    expect(month.lessons[0]?.noSubscription).toBe(1)
  })

  it('rounds once in the total, not on every lesson', () => {
    // mini at 50 %: 158,333… — per lesson rounding would give 158 × 3 = 474
    const month = calcMonth(
      Array.from({ length: 3 }, () => lesson({ sub: SUB.mini, marks: present(1) })),
      [{ percent: 50, valid_from: '2026-09-01' }],
    )
    expect(month.amount).toBe(475)
  })

  it('x.5 rounds up like SQL round()', () => {
    // afterschool at 45 %: 166,5
    const month = calcMonth(
      [lesson({ sub: SUB.afterschool, duration_min: 180, marks: present(1) })],
      RATE_45,
    )
    expect(month.amount).toBe(167)
    expect(month.hours).toBe(3)
  })

  it('no rate on the date → the lesson counts, pays 0', () => {
    const month = calcMonth([lesson({ lesson_date: '2026-08-20', marks: present(4) })], RATE_45)
    expect(month).toMatchObject({ lessonsHeld: 1, studentLessons: 4, amount: 0 })
  })
})

describe('byTeacher — lessons.teacher_id decides who is paid (0020)', () => {
  it('a lesson of a group now led by B, with teacher_id = A, is paid to A', () => {
    // group g1 was handed over to B on 2026-09-20; the earlier lesson stays with A
    const old = { ...lesson({ lesson_date: '2026-09-10', marks: present(5) }), teacher_id: 'A' }
    const fresh = { ...lesson({ lesson_date: '2026-09-25', marks: present(5) }), teacher_id: 'B' }
    const by = byTeacher([old, fresh])
    expect(calcMonth(by.get('A') ?? [], RATE_45).amount).toBe(600)
    expect(calcMonth(by.get('B') ?? [], RATE_45).amount).toBe(600)
    expect(by.get('A')?.map((l) => l.id)).toEqual([old.id])
  })
})

describe('byGroup / totals', () => {
  it('splits the month by group, each total rounded once', () => {
    const month = calcMonth(
      [
        lesson({ group_id: 'a', marks: present(8) }),
        lesson({ group_id: 'b', marks: present(6) }),
        lesson({ group_id: 'a', marks: present(7) }),
      ],
      RATE_45,
    )
    const groups = byGroup(month.lessons)
    expect([...groups.keys()]).toEqual(['a', 'b'])
    expect(totals(groups.get('a') ?? [])).toEqual({
      lessonsHeld: 2,
      hours: 2,
      studentLessons: 15,
      noSubscription: 0,
      studentHours: 0,
      amount: 1_800,
    })
    expect(totals(groups.get('b') ?? []).amount).toBe(720)
  })
})

describe('advances (А8, #83)', () => {
  const adjustments = [
    { kind: 'advance' as const, amount: 5000 },
    { kind: 'advance' as const, amount: 3000 },
    { kind: 'bonus' as const, amount: 1000 },
  ]

  it('sums only advances', () => {
    expect(advancesTotal(adjustments)).toBe(8000)
    expect(advancesTotal([])).toBe(0)
  })

  it('«К выплате» = начислено − авансы, may go below zero', () => {
    expect(toPay(38_160, adjustments)).toBe(30_160)
    expect(toPay(38_160, [])).toBe(38_160)
    expect(toPay(2000, adjustments)).toBe(-6000)
  })
})

describe('after-school hour subscriptions (#82, И56)', () => {
  // 20 h invoiced for 2 000 сом → 100 сом/ч
  const HOURS: PaySubscription = { price_full: 2000, lessons_total: 12, hours_total: 20 }

  it('markPay: price_full × hours / hours_total × percent', () => {
    expect(markPay(HOURS, 45, 2)).toBe(90)
    expect(markPay(HOURS, 45, 1)).toBe(45)
    expect(markPay(HOURS, 45, null)).toBe(0)
  })

  it('a lesson package ignores hours — the very same pay as before', () => {
    expect(markPay(SUB.afterschool, 45, 3)).toBe(markPay(SUB.afterschool, 45))
  })

  it('calcMonth: present 2 h + burned 2 h pay, a freeze does not; student-hours summed', () => {
    const l = lesson({ duration_min: 180, marks: [] })
    const month = calcMonth(
      [
        {
          ...l,
          attendance: [
            { status: 'present', subscription: HOURS, hours: 2 },
            { status: 'absent_burned', subscription: HOURS, hours: 2 },
            { status: 'absent_frozen', subscription: HOURS, hours: 1 },
            { status: 'present', subscription: SUB.afterschool, hours: 3 },
          ],
        },
      ],
      RATE_45,
    )
    // 4 h × 100 × 45 % = 180, plus one old 20-lesson package mark 166,5
    expect(month.amount).toBe(roundSom(180 + 166.5))
    expect(month.studentHours).toBe(4)
    expect(month.studentLessons).toBe(3)
  })
})
