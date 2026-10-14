// TS ↔ SQL reconciliation (issue #47): subscriptionBalances() from src/features/payments/balance.ts
// against v_student_balance (0016) on the seed, subscription by subscription.
// Needs the local stack: `supabase start && supabase db reset && pnpm seed:users`. Run with
// `pnpm test:integration`.
import { createClient } from '@supabase/supabase-js'
import {
  subscriptionBalances,
  unbilledDebt,
  type BalanceSubscription,
  type SubscriptionBalance,
} from '../../src/features/payments/balance'
import type { Database } from '../../src/lib/supabase/types.gen'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import { localSupabase } from '../../scripts/local-supabase'
import { ensureAfterschoolFixture, FIXTURE } from './afterschool-fixture'

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

/** The view, keyed by subscription. */
async function viewRows(supabase: Client) {
  const { data, error } = await supabase
    .from('v_student_balance')
    .select(
      'subscription_id, paid_som, paid_lessons, carried_in, lessons_used, lessons_left, debt_lessons, debt_som, refund_suggested, is_current',
    )
    .not('subscription_id', 'is', null)
  if (error) throw error
  return new Map(data.map((r) => [r.subscription_id, r]))
}

/** Raw rows the client has — subscriptions with marks and payments — through balance.ts. */
async function tsBalances(supabase: Client) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'id, status, started_at, created_at, lessons_total, hours_total, credit_hours, price_final, enrollment:enrollments!inner(student_id, group_id), attendance(consumes_credit, hours), payments(amount)',
    )
  if (error) throw error
  const byStudentGroup = new Map<string, BalanceSubscription[]>()
  for (const s of data) {
    const key = `${s.enrollment.student_id}|${s.enrollment.group_id}`
    const list = byStudentGroup.get(key) ?? []
    list.push({
      id: s.id,
      status: s.status,
      started_at: s.started_at,
      created_at: s.created_at,
      // after-school months count hours (#82)
      lessons_total: s.hours_total ?? s.lessons_total,
      credit: s.credit_hours,
      price_final: s.price_final,
      used: s.attendance
        .filter((a) => a.consumes_credit)
        .reduce((n, a) => n + (s.hours_total ? (a.hours ?? 0) : 1), 0),
      paid: s.payments.reduce((n, p) => n + p.amount, 0),
      unit: s.hours_total ? 'hour' : 'lesson',
    })
    byStudentGroup.set(key, list)
  }
  return [...byStudentGroup.values()].flatMap((subs) => subscriptionBalances(subs))
}

/** Subscription ids of the #82 fixture group — kept out of the seed's own numbers. */
async function fixtureSubscriptions(supabase: Client) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, enrollment:enrollments!inner(group_id)')
    .eq('enrollment.group_id', FIXTURE.group)
  if (error) throw error
  return new Set(data.map((s) => s.id))
}

beforeAll(ensureAfterschoolFixture)

const asView = (b: SubscriptionBalance) => ({
  subscription_id: b.subscriptionId,
  paid_som: b.paidSom,
  paid_lessons: b.paidLessons,
  carried_in: b.carriedIn,
  lessons_used: b.lessonsUsed,
  lessons_left: b.lessonsLeft,
  debt_lessons: b.debtLessons,
  debt_som: b.debtSom,
  refund_suggested: b.refundSuggested,
  is_current: b.isCurrent,
})

describe('v_student_balance ↔ subscriptionBalances on the seed', () => {
  it('every subscription: the same paid, used, debt and refund (accountant sees all)', async () => {
    const supabase = await signIn('0555 300 300') // Айгерим, accountant
    const [view, ts] = await Promise.all([viewRows(supabase), tsBalances(supabase)])
    expect(ts.length).toBeGreaterThanOrEqual(32)
    expect(view.size).toBe(ts.length)
    for (const b of ts) expect(view.get(b.subscriptionId)).toEqual(asView(b))

    // Seed (#47): one debt of 2 lessons (Азамат, 740 сом), partial payments, one refund.
    const fixture = await fixtureSubscriptions(supabase)
    const seed = ts.filter((b) => !fixture.has(b.subscriptionId))
    expect(seed.filter((b) => b.debtLessons > 0).map((b) => [b.debtLessons, b.debtSom])).toEqual([
      [2, 740],
    ])
    expect(
      ts.filter((b) => b.isCurrent && b.paidLessons < b.lessonsTotal).length,
    ).toBeGreaterThanOrEqual(2)
    expect(ts.filter((b) => b.refunded)).toHaveLength(1)
  })

  it('Гульзат reads the same numbers for her own students (Д3)', async () => {
    const supabase = await signIn('0555 123 456')
    const [view, ts] = await Promise.all([viewRows(supabase), tsBalances(supabase)])
    expect(ts.length).toBeGreaterThan(0)
    expect(view.size).toBe(ts.length)
    for (const b of ts) expect(view.get(b.subscriptionId)).toEqual(asView(b))
  })
})

describe('after-school by hours (#82 fixture)', () => {
  it('credit hours, an unpaid invoice — the same in the view and in balance.ts', async () => {
    const supabase = await signIn('0555 300 300')
    const [view, ts, fixture] = await Promise.all([
      viewRows(supabase),
      tsBalances(supabase),
      fixtureSubscriptions(supabase),
    ])
    const own = ts.filter((b) => fixture.has(b.subscriptionId))
    expect(own).toHaveLength(3)
    for (const b of own) expect(view.get(b.subscriptionId)).toEqual(asView(b))
    // F1 November: 54 h billed + 6 h credit (paid on October) — the credit counts as paid
    expect(own.some((b) => b.lessonsTotal === 60 && b.paidLessons === 6)).toBe(true)
    // F2 October unpaid: 6 h used → debt 6 h × 117
    expect(own.filter((b) => b.debtLessons > 0).map((b) => [b.debtLessons, b.debtSom])).toEqual([
      [6, 702],
    ])
  })

  it('a month not invoiced (И69): v_afterschool_unbilled ↔ unbilledDebt, and in v_student_balance', async () => {
    const supabase = await signIn('0555 300 300')
    const [{ data: view, error }, { data: marks, error: e2 }, { data: virtual, error: e3 }] =
      await Promise.all([
        supabase
          .from('v_afterschool_unbilled')
          .select('student_id, month, hours, amount')
          .eq('group_id', FIXTURE.group),
        supabase
          .from('attendance')
          .select(
            'student_id, consumes_credit, hours, unbilled_hour_price, lesson:lessons!inner(lesson_date, group_id)',
          )
          .eq('lesson.group_id', FIXTURE.group)
          .is('subscription_id', null),
        supabase
          .from('v_student_balance')
          .select('student_id, debt_lessons, debt_som, unbilled')
          .eq('group_id', FIXTURE.group)
          .is('subscription_id', null),
      ])
    if (error) throw error
    if (e2) throw e2
    if (e3) throw e3
    const ts = unbilledDebt(
      marks
        .filter((m) => m.consumes_credit && m.hours !== null && m.student_id === FIXTURE.f2)
        .map((m) => ({
          lesson_date: m.lesson.lesson_date,
          hours: m.hours ?? 0,
          hourPrice: m.unbilled_hour_price ?? 0,
        })),
    )
    expect(ts).toEqual([{ month: '2025-11-01', hours: 6, som: 702 }])
    expect(view).toEqual([{ student_id: FIXTURE.f2, month: '2025-11-01', hours: 6, amount: 702 }])
    expect(virtual).toEqual([
      { student_id: FIXTURE.f2, debt_lessons: 6, debt_som: 702, unbilled: true },
    ])
  })
})
