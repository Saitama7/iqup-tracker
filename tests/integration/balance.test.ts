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
    expect(ts.filter((b) => b.debtLessons > 0).map((b) => [b.debtLessons, b.debtSom])).toEqual([
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
