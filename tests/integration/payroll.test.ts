// TS ↔ SQL reconciliation (issue #13): calcMonth() from src/features/payroll/calc.ts against
// v_payroll_preview (0011, priced by subscription since 0012 / #35) on the seed, teacher by teacher
// and month by month.
// Needs the local stack: `supabase start && supabase db reset && pnpm seed:users`. Run with
// `pnpm test:integration`.
import { createClient } from '@supabase/supabase-js'
import { calcMonth, toPay, type PayLesson } from '../../src/features/payroll/calc'
import type { Database } from '../../src/lib/supabase/types.gen'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import { localSupabase } from '../../scripts/local-supabase'
import { ensureAfterschoolFixture, FIXTURE } from './afterschool-fixture'
import { ensurePriceFixture, PRICE_FIXTURE, resetPriceFixture } from './price-fixture'
import { ensureSizeFixture, SIZE_FIXTURE } from './size-fixture'
import { admin } from './afterschool-fixture'

const env = localSupabase()

async function signIn(phone: string) {
  const supabase = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToEmail(phone),
    password: 'iqup-demo',
  })
  if (error) throw error
  return supabase
}

type Client = Awaited<ReturnType<typeof signIn>>

const GULZAT = '00000000-0000-4000-a000-000000000001'

async function viewRows(supabase: Client) {
  const { data, error } = await supabase
    .from('v_payroll_preview')
    .select(
      'teacher_id, month, lessons_held, hours, student_lessons, base_amount, no_subscription, advances, to_pay, student_hours',
    )
  if (error) throw error
  return data
}

/** Every visible lesson with marks and their subscriptions, by teacher and month, plus rates. */
async function source(supabase: Client) {
  const [lessons, rates] = await Promise.all([
    supabase
      .from('lessons')
      .select(
        'id, group_id, lesson_date, duration_min, status, teacher_id, attendance(status, hours, subscription:subscriptions(price_full, lessons_total, hours_total))',
      ),
    supabase.from('teacher_rates').select('teacher_id, percent, valid_from'),
  ])
  if (lessons.error) throw lessons.error
  if (rates.error) throw rates.error

  const byKey = new Map<string, PayLesson[]>()
  for (const l of lessons.data) {
    const key = `${l.teacher_id}|${l.lesson_date.slice(0, 7)}-01`
    const list = byKey.get(key) ?? []
    list.push(l)
    byKey.set(key, list)
  }
  return { byKey, rates: rates.data }
}

beforeAll(async () => {
  await ensureAfterschoolFixture()
  await ensureSizeFixture()
  await ensurePriceFixture()
})

describe('v_payroll_preview ↔ calcMonth on the seed', () => {
  it('every teacher and month: the same lessons, hours, student-lessons and sum', async () => {
    const supabase = await signIn('0555 300 300') // Айгерим, accountant — sees everyone
    const rows = await viewRows(supabase)
    const { byKey, rates } = await source(supabase)

    expect(rows.length).toBeGreaterThanOrEqual(5) // 5 teachers held lessons in September
    for (const row of rows) {
      const lessons = byKey.get(`${row.teacher_id}|${row.month}`) ?? []
      const teacherRates = rates.filter((r) => r.teacher_id === row.teacher_id)
      const ts = calcMonth(lessons, teacherRates)
      expect({ teacher: row.teacher_id, month: row.month, ...pick(ts) }).toEqual({
        teacher: row.teacher_id,
        month: row.month,
        lessonsHeld: row.lessons_held,
        hours: row.hours,
        studentLessons: row.student_lessons,
        noSubscription: row.no_subscription,
        studentHours: row.student_hours,
        amount: row.base_amount,
      })
    }

    // Months the view has no row for have nothing held in TS either.
    const keys = new Set(rows.map((r) => `${r.teacher_id}|${r.month}`))
    for (const [key, lessons] of byKey) {
      if (keys.has(key)) continue
      const [teacher] = key.split('|')
      const teacherRates = rates.filter((r) => r.teacher_id === teacher)
      expect(calcMonth(lessons, teacherRates).lessonsHeld).toBe(0)
    }

    // The pilot numbers (И20): everyone in September — 47 546 сом + «Байхан» 8 × 450 (К11, #109).
    const september = rows.filter((r) => r.month === '2026-09-01')
    expect(september.reduce((n, r) => n + (r.base_amount ?? 0), 0)).toBe(53_171)
    expect(september.every((r) => r.no_subscription === 0)).toBe(true)
  })

  it('Гульзат, September 2026: 318 student-lessons × 266,67 × 45 % = 38 160', async () => {
    const supabase = await signIn('0555 123 456')
    const rows = await viewRows(supabase)
    expect(new Set(rows.map((r) => r.teacher_id))).toEqual(new Set([GULZAT]))
    const september = rows.find((r) => r.month === '2026-09-01')
    expect(september).toMatchObject({ lessons_held: 52, student_lessons: 318, base_amount: 38_160 })

    // «Мой месяц» computes the same on the client under her RLS — subscriptions included (К6).
    const { byKey, rates } = await source(supabase)
    const ts = calcMonth(byKey.get(`${GULZAT}|2026-09-01`) ?? [], rates)
    expect(pick(ts)).toEqual({
      lessonsHeld: 52,
      hours: 52,
      studentLessons: 318,
      noSubscription: 0,
      studentHours: 0,
      amount: 38_160,
    })
  })
})

describe('subscription size (#101 fixture): pay by price_full / lessons_total (К6)', () => {
  it('8 / 2 400 → 300 a lesson: 12 student-lessons × 300 × 45 % = 1 620', async () => {
    const supabase = await signIn('0555 300 300')
    const rows = await viewRows(supabase)
    const june = rows.find((r) => r.teacher_id === SIZE_FIXTURE.teacher && r.month === '2025-06-01')
    expect(june).toMatchObject({ lessons_held: 6, student_lessons: 12, base_amount: 1620 })
    const { byKey, rates } = await source(supabase)
    const ts = calcMonth(
      byKey.get(`${SIZE_FIXTURE.teacher}|2025-06-01`) ?? [],
      rates.filter((r) => r.teacher_id === SIZE_FIXTURE.teacher),
    )
    expect(ts.amount).toBe(1620)
  })
})

describe('К11 (#109 fixture): update_subscription moves the pay by price_full / lessons_total', () => {
  it('individual 1,5 h: 12 / 7 200 → 8 / 7 200 — the held lesson 300 → 450 in the view and calc.ts', async () => {
    const id = await resetPriceFixture(PRICE_FIXTURE.p1, 12, 7200)
    const supabase = await signIn('0555 300 300')
    const month = async () => {
      const rows = await viewRows(supabase)
      const view = rows.find(
        (r) => r.teacher_id === PRICE_FIXTURE.teacher && r.month === '2025-05-01',
      )
      const { byKey, rates } = await source(supabase)
      const own = rates.filter((r) => r.teacher_id === PRICE_FIXTURE.teacher)
      const lessons = byKey.get(`${PRICE_FIXTURE.teacher}|2025-05-01`) ?? []
      // the month holds the fixture group's days too (balance.test edits their price): the view's
      // sum is checked against calc.ts of the whole month, the individual lesson — alone
      expect(calcMonth(lessons, own).amount).toBe(view?.base_amount)
      return calcMonth(
        lessons.filter((l) => l.group_id === PRICE_FIXTURE.individual),
        own,
      ).amount
    }
    expect(await month()).toBe(300)

    const a = await admin()
    const { data: preview, error: pe } = await a.rpc('subscription_update_preview', {
      p_id: id,
      p_lessons: 8,
      p_price: 7200,
    })
    if (pe) throw pe
    expect(preview).toHaveLength(1)
    const [row] = preview
    expect(row).toMatchObject({ marks: 1, mark_before: 300, mark_after: 450 })
    expect(row.amount_after - row.amount_before).toBe(150)
    const { error } = await a.rpc('update_subscription', {
      p_id: id,
      p_lessons: 8,
      p_price: 7200,
      p_reason: 'К11: 12 часов = 8 занятий по 1,5 ч',
    })
    if (error) throw error
    expect(await month()).toBe(450)
  })
})

describe('after-school days (#111 fixture): % × price_full / N a day (К13)', () => {
  it('45 % × 5 400 / 12 = 202,5 → 203 — the same rounding in the view and calc.ts', async () => {
    const supabase = await signIn('0555 300 300')
    const rows = (await viewRows(supabase)).filter((r) => r.teacher_id === FIXTURE.teacher)
    const { byKey, rates } = await source(supabase)
    const own = rates.filter((r) => r.teacher_id === FIXTURE.teacher)
    // October: F1 10 × 202,5 + F2 ПТ 3, 10 × 157,5 (20 · 7 000; the Monday mark deleted) = 2 340
    // November: F1 one day — 202,5 → 203
    expect(rows.map((r) => [r.month, r.base_amount, r.student_lessons, r.no_subscription])).toEqual(
      expect.arrayContaining([
        ['2025-10-01', 2340, 12, 0],
        ['2025-11-01', 203, 1, 0],
      ]),
    )
    for (const row of rows) {
      const ts = calcMonth(byKey.get(`${FIXTURE.teacher}|${row.month}`) ?? [], own)
      expect(ts.amount).toBe(row.base_amount)
      expect(ts.studentLessons).toBe(row.student_lessons)
      expect(ts.studentHours).toBe(row.student_hours)
    }
  })
})

describe('advances (#83): v_payroll_preview.to_pay ↔ calc.toPay', () => {
  it('an advance lowers «К выплате», never the accrual; deleted — back as it was', async () => {
    const accountant = await signIn('0555 300 300')
    const { data: id, error } = await accountant.rpc('issue_advance', {
      p_teacher_id: GULZAT,
      p_amount: 5000,
      p_issued_on: '2026-09-18',
      p_comment: 'integration',
    })
    if (error) throw error
    try {
      const row = (await viewRows(accountant)).find(
        (r) => r.teacher_id === GULZAT && r.month === '2026-09-01',
      )
      const { data: adjustments, error: e2 } = await accountant
        .from('payroll_adjustments')
        .select('kind, amount')
        .eq('teacher_id', GULZAT)
        .eq('month', '2026-09-01')
      if (e2) throw e2
      expect(row).toMatchObject({ base_amount: 38_160, advances: 5000, to_pay: 33_160 })
      expect(toPay(row?.base_amount ?? 0, adjustments)).toBe(row?.to_pay)

      // Гульзат sees the same under her RLS.
      const teacher = await signIn('0555 123 456')
      const own = await teacher.from('payroll_adjustments').select('id, amount')
      expect(own.data).toEqual([{ id, amount: 5000 }])
    } finally {
      const { error: e3 } = await accountant.rpc('delete_payroll_adjustment', {
        p_id: id,
        p_reason: 'integration cleanup',
      })
      expect(e3).toBeNull()
    }
    const after = (await viewRows(accountant)).find(
      (r) => r.teacher_id === GULZAT && r.month === '2026-09-01',
    )
    expect(after).toMatchObject({ base_amount: 38_160, advances: 0, to_pay: 38_160 })
  })
})

const pick = ({
  lessonsHeld,
  hours,
  studentLessons,
  noSubscription,
  studentHours,
  amount,
}: ReturnType<typeof calcMonth>) => ({
  lessonsHeld,
  hours,
  studentLessons,
  noSubscription,
  studentHours,
  amount,
})
