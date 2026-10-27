// TS ↔ SQL reconciliation (issue #47): subscriptionBalances() from src/features/payments/balance.ts
// against v_student_balance (0016) on the seed, subscription by subscription.
// Needs the local stack: `supabase start && supabase db reset && pnpm seed:users`. Run with
// `pnpm test:integration`.
import { createClient } from '@supabase/supabase-js'
import {
  subscriptionBalances,
  type BalanceSubscription,
  type SubscriptionBalance,
} from '../../src/features/payments/balance'
import type { Database } from '../../src/lib/supabase/types.gen'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import { localSupabase } from '../../scripts/local-supabase'
import { admin, ensureAfterschoolFixture, FIXTURE } from './afterschool-fixture'
import { ensurePriceFixture, PRICE_FIXTURE, resetPriceFixture } from './price-fixture'
import { ensureSizeFixture, SIZE_FIXTURE } from './size-fixture'

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

/** Subscription ids of the fixture groups (#82, #101) — kept out of the seed's own numbers. */
async function fixtureSubscriptions(
  supabase: Client,
  groups = [FIXTURE.group, SIZE_FIXTURE.group, PRICE_FIXTURE.individual, PRICE_FIXTURE.group],
) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, enrollment:enrollments!inner(group_id)')
    .in('enrollment.group_id', groups)
  if (error) throw error
  return new Set(data.map((s) => s.id))
}

beforeAll(async () => {
  await ensureAfterschoolFixture()
  await ensureSizeFixture()
  await ensurePriceFixture()
})

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

describe('after-school days (#111 fixture, К13)', () => {
  it('12 days for 5 400, paid: 11 of 12 used, 1 left, no debt — the same in the view and balance.ts', async () => {
    const supabase = await signIn('0555 300 300')
    const [view, ts, fixture] = await Promise.all([
      viewRows(supabase),
      tsBalances(supabase),
      fixtureSubscriptions(supabase, [FIXTURE.group]),
    ])
    const own = ts.filter((b) => fixture.has(b.subscriptionId))
    expect(own).toHaveLength(2)
    for (const b of own) expect(view.get(b.subscriptionId)).toEqual(asView(b))
    expect(
      own.map((b) => [b.lessonsTotal, b.paidSom, b.lessonsUsed, b.lessonsLeft, b.debtSom]),
    ).toEqual(
      expect.arrayContaining([
        // F1: 10 October days + 4 November
        [12, 5400, 11, 1, 0],
        // F2: ПТ 3, 10 October not paid — 2 × 350
        [20, 0, 2, 18, 700],
      ]),
    )
  })

  it('v_afterschool_unbilled is empty — the month without a bill is off', async () => {
    const supabase = await signIn('0555 300 300')
    const { data, error } = await supabase.from('v_afterschool_unbilled').select('enrollment_id')
    if (error) throw error
    expect(data).toEqual([])
  })
})

describe('subscription size (#101 fixture): 8 lessons at the same lesson price', () => {
  it('8 / 2 400: paid → 8 of 8, 6 used → refund 2 × 300; half paid → debt 2 × 300', async () => {
    const supabase = await signIn('0555 300 300')
    const [view, ts] = await Promise.all([viewRows(supabase), tsBalances(supabase)])
    const ids = await fixtureSubscriptions(supabase, [SIZE_FIXTURE.group])
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select(
        'id, lessons_total, price_full, price_final, enrollment:enrollments!inner(student_id)',
      )
      .in('id', [...ids])
    if (error) throw error
    expect(subs.map((s) => [s.lessons_total, s.price_full, s.price_final])).toEqual([
      [8, 2400, 2400],
      [8, 2400, 2400],
    ])
    const of = (student: string) => {
      const id = subs.find((s) => s.enrollment.student_id === student)?.id
      const b = ts.find((x) => x.subscriptionId === id)
      if (!b) throw new Error('no fixture balance')
      expect(view.get(b.subscriptionId)).toEqual(asView(b))
      return b
    }
    expect(of(SIZE_FIXTURE.z1)).toMatchObject({
      lessonsTotal: 8,
      paidLessons: 8,
      lessonsUsed: 6,
      lessonsLeft: 2,
      debtLessons: 0,
      refundSuggested: 600,
    })
    expect(of(SIZE_FIXTURE.z2)).toMatchObject({
      paidLessons: 4,
      lessonsUsed: 6,
      debtLessons: 2,
      debtSom: 600,
      refundSuggested: 0,
    })
  })
})

describe('К12 (#109 fixture): own price edited — 20 / 7 400 → 12 / 5 400', () => {
  it('paid 5 400: 2 000 left to pay before, nothing after; the view and balance.ts agree', async () => {
    const id = await resetPriceFixture(PRICE_FIXTURE.p2, 20, 7400)
    const supabase = await signIn('0555 300 300')
    const of = async () => {
      const [view, ts] = await Promise.all([viewRows(supabase), tsBalances(supabase)])
      const b = ts.find((x) => x.subscriptionId === id)
      if (!b) throw new Error('no fixture balance')
      expect(view.get(id)).toEqual(asView(b))
      return b
    }
    expect(await of()).toMatchObject({
      lessonsTotal: 20,
      priceFinal: 7400,
      paidSom: 5400,
      paidLessons: 14,
      lessonsUsed: 12,
      debtLessons: 0,
    })

    const a = await admin()
    const { error } = await a.rpc('update_subscription', {
      p_id: id,
      p_lessons: 12,
      p_price: 5400,
      p_reason: 'Продлёнка: 12 дней за 5 400',
    })
    if (error) throw error
    expect(await of()).toMatchObject({
      lessonsTotal: 12,
      priceFinal: 5400,
      paidSom: 5400,
      paidLessons: 12,
      lessonsUsed: 12,
      lessonsLeft: 0,
      debtLessons: 0,
      debtSom: 0,
    })
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
    const bought = buy.data[0] as (typeof buy.data)[number] | undefined
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

  it('an extra payment on a paid after-school package is deleted (#111 fixture)', async () => {
    const supabase = await signIn('0555 775 772')
    const before = await expectAgree(supabase)
    const fixture = await fixtureSubscriptions(supabase, [FIXTURE.group])
    const invoice = [...before.values()].find(
      (r) => r.subscription_id && fixture.has(r.subscription_id) && (r.paid_som ?? 0) > 0,
    )
    if (!invoice?.subscription_id) throw new Error('no paid fixture package')
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
