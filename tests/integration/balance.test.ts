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
      'id, status, started_at, created_at, lessons_total, hours_total, credit_hours, credit_out_hours, price_final, enrollment:enrollments!inner(student_id, group_id), attendance(consumes_credit, hours), payments(amount)',
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
      creditOut: s.credit_out_hours ?? 0,
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

describe('delete_payment / update_payment (#92): the view and balance.ts still agree', () => {
  async function expectAgree(supabase: Client) {
    const [view, ts] = await Promise.all([viewRows(supabase), tsBalances(supabase)])
    expect(view.size).toBe(ts.length)
    for (const b of ts) expect(view.get(b.subscriptionId)).toEqual(asView(b))
    return view
  }

  async function lastPayment(supabase: Client, subscriptionId: string) {
    const { data, error } = await supabase
      .from('payments')
      .select('id')
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (error) throw error
    return data.id
  }

  it('a duplicate payment and a duplicate «новый абонемент» are recorded, edited, deleted', async () => {
    const supabase = await signIn('0555 775 772') // Алишка, admin
    const before = await expectAgree(supabase)
    const fixture = await fixtureSubscriptions(supabase)
    const { data: subs, error } = await supabase
      .from('v_student_balance')
      .select('subscription_id, enrollment_id')
      .eq('unit', 'lesson')
      .eq('status', 'active')
      .eq('is_current', true)
      .gt('lessons_used', 0)
      .gt('paid_som', 0)
    if (error) throw error
    const target = subs.find((s) => s.subscription_id && !fixture.has(s.subscription_id))
    if (!target?.subscription_id || !target.enrollment_id) throw new Error('no seed subscription')
    const subscriptionId = target.subscription_id

    const rec = await supabase.rpc('record_payment', {
      p_subscription_id: subscriptionId,
      p_amount: 500,
      p_method: 'cash',
    })
    if (rec.error) throw rec.error
    await expectAgree(supabase)
    const paymentId = await lastPayment(supabase, subscriptionId)

    const upd = await supabase.rpc('update_payment', {
      p_payment_id: paymentId,
      p_amount: 700,
      p_method: 'mbank',
      p_paid_on: new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bishkek' }),
      p_comment: 'опечатка',
      p_reason: 'интеграционный тест',
    })
    if (upd.error) throw upd.error
    await expectAgree(supabase)

    const del = await supabase.rpc('delete_payment', {
      p_payment_id: paymentId,
      p_reason: 'интеграционный тест',
    })
    if (del.error) throw del.error
    expect(del.data).toBe('deleted')
    expect((await expectAgree(supabase)).get(subscriptionId)).toEqual(before.get(subscriptionId))

    const buy = await supabase.rpc('buy_subscription', {
      p_enrollment_id: target.enrollment_id,
      p_amount: 1000,
      p_method: 'cash',
    })
    if (buy.error) throw buy.error
    const bought = buy.data[0]
    if (!bought) throw new Error('no subscription bought')
    await expectAgree(supabase)
    const del2 = await supabase.rpc('delete_payment', {
      p_payment_id: bought.payment_id,
      p_reason: 'интеграционный тест',
    })
    if (del2.error) throw del2.error
    expect(del2.data).toBe('subscription_deleted')
    const after = await expectAgree(supabase)
    expect(after.has(bought.subscription_id)).toBe(false)
    expect(after).toEqual(before)
  })

  it('an extra payment on an hour invoice with credit is deleted (#82 fixture)', async () => {
    const supabase = await signIn('0555 775 772')
    const before = await expectAgree(supabase)
    const fixture = await fixtureSubscriptions(supabase)
    const invoice = [...before.values()].find(
      (r) => r.subscription_id && fixture.has(r.subscription_id) && r.paid_som > 0,
    )
    if (!invoice?.subscription_id) throw new Error('no paid fixture invoice')
    const rec = await supabase.rpc('record_payment', {
      p_subscription_id: invoice.subscription_id,
      p_amount: 123,
      p_method: 'cash',
    })
    if (rec.error) throw rec.error
    await expectAgree(supabase)
    const del = await supabase.rpc('delete_payment', {
      p_payment_id: await lastPayment(supabase, invoice.subscription_id),
      p_reason: 'интеграционный тест',
    })
    if (del.error) throw del.error
    expect(await expectAgree(supabase)).toEqual(before)
  })
})
