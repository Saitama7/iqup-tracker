// А7 / А5 / А6 data: payments and v_student_balance straight from Postgres. RLS (0016) — the admin
// writes (through the RPCs below, one transaction each), the accountant reads, a teacher reads only
// own students (Д3).
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import {
  discountByPct,
  lessonsErrorMessage,
  subscriptionLessons,
} from '@/features/subscriptions/model'
import type { SubscriptionBalance } from './balance'

export const PAYMENTS_KEY = 'payments'
export const BALANCES_KEY = 'student-balances'

export type PaymentMethod = 'cash' | 'mbank'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'mbank']

// ─── v_student_balance ──────────────────────────────────────────────────────

const balanceSchema = z.object({
  subscription_id: z.uuid(),
  student_id: z.uuid(),
  group_id: z.uuid(),
  status: z.enum(['active', 'exhausted', 'refunded']),
  // units: lessons, or hours of an after-school month (#82) — halves possible
  lessons_total: z.number(),
  price_final: z.number().int(),
  paid_som: z.number().int(),
  paid_lessons: z.number(),
  carried_in: z.number(),
  lessons_used: z.number(),
  lessons_left: z.number(),
  debt_lessons: z.number(),
  debt_som: z.number().int(),
  refund_suggested: z.number().int(),
  freezes_used: z.number().int(),
  freeze_limit: z.number().int().nullable(),
  is_current: z.boolean(),
  unit: z.enum(['lesson', 'hour']),
  hours_total: z.number().nullable(),
  period_month: z.string().nullable(),
})

export interface StudentBalance extends SubscriptionBalance {
  studentId: string
  groupId: string
  freezesUsed: number
  /** null — no limit (К9). */
  freezeLimit: number | null
  /** lesson — a package; hour — an after-school month, every count in hours (#82). */
  unit: 'lesson' | 'hour'
  /** After-school: the billed month (first day). */
  periodMonth: string | null
  /** Units the price is for: billed hours of an hour invoice (without its credit), else lessons_total. */
  pricedTotal: number
}

const BALANCE_FIELDS =
  'subscription_id, student_id, group_id, status, lessons_total, price_final, paid_som, paid_lessons, carried_in, lessons_used, lessons_left, debt_lessons, debt_som, refund_suggested, freezes_used, freeze_limit, is_current, unit, hours_total, period_month'

const toBalance = (r: z.infer<typeof balanceSchema>): StudentBalance => ({
  subscriptionId: r.subscription_id,
  studentId: r.student_id,
  groupId: r.group_id,
  refunded: r.status === 'refunded',
  lessonsTotal: r.lessons_total,
  priceFinal: r.price_final,
  paidSom: r.paid_som,
  paidLessons: r.paid_lessons,
  carriedIn: r.carried_in,
  lessonsUsed: r.lessons_used,
  lessonsLeft: r.lessons_left,
  debtLessons: r.debt_lessons,
  debtSom: r.debt_som,
  refundSuggested: r.refund_suggested,
  isCurrent: r.is_current,
  freezesUsed: r.freezes_used,
  freezeLimit: r.freeze_limit,
  unit: r.unit,
  periodMonth: r.period_month,
  pricedTotal: r.hours_total ?? r.lessons_total,
})

/** Every visible subscription's balance (~100 rows) — А5 / А6 / А7 read the view, not the formula. */
export const balancesQuery = () =>
  queryOptions({
    queryKey: [BALANCES_KEY],
    queryFn: async (): Promise<StudentBalance[]> => {
      // the months not invoiced (subscription_id null, И69) — unbilledQuery
      const { data, error } = await supabase
        .from('v_student_balance')
        .select(BALANCE_FIELDS)
        .not('subscription_id', 'is', null)
      if (error) throw error
      return z.array(balanceSchema).parse(data).map(toBalance)
    },
  })

// ─── v_afterschool_unbilled ─────────────────────────────────────────────────

const unbilledSchema = z.object({
  enrollment_id: z.uuid(),
  student_id: z.uuid(),
  group_id: z.uuid(),
  month: z.string(),
  hours: z.number(),
  amount: z.number().int(),
  active: z.boolean(),
})

/** After-school hours charged with no invoice for their month (И69) — a debt at the hour price. */
export interface UnbilledMonth {
  enrollmentId: string
  studentId: string
  groupId: string
  /** First day of the month. */
  month: string
  hours: number
  som: number
  /** The enrollment is still on — «Требует внимания»: the invoice is to be issued. */
  active: boolean
}

export const UNBILLED_KEY = 'afterschool-unbilled'

export const unbilledQuery = () =>
  queryOptions({
    queryKey: [BALANCES_KEY, UNBILLED_KEY],
    queryFn: async (): Promise<UnbilledMonth[]> => {
      const { data, error } = await supabase
        .from('v_afterschool_unbilled')
        .select('enrollment_id, student_id, group_id, month, hours, amount, active')
        .order('month')
      if (error) throw error
      return z
        .array(unbilledSchema)
        .parse(data)
        .map((r) => ({
          enrollmentId: r.enrollment_id,
          studentId: r.student_id,
          groupId: r.group_id,
          month: r.month,
          hours: r.hours,
          som: r.amount,
          active: r.active,
        }))
    },
  })

// ─── Payments ───────────────────────────────────────────────────────────────

const paymentSchema = z.object({
  id: z.uuid(),
  amount: z.number().int(),
  /** null — a transfer between subscriptions (#81): no money changed hands. */
  method: z.enum(['cash', 'mbank']).nullable(),
  paid_at: z.string(),
  kind: z.enum(['payment', 'refund', 'transfer']),
  reason: z.string().nullable(),
  created_by: z.uuid().nullable(),
  subscription: z.object({
    id: z.uuid(),
    lessons_total: z.number().int(),
    price_final: z.number().int(),
    discount_percent: z.number().int(),
    /** After-school month in hours (#82). */
    hours_total: z.number().nullable(),
    period_month: z.string().nullable(),
    enrollment: z.object({ student_id: z.uuid(), group_id: z.uuid() }),
  }),
})

export type PaymentRow = z.infer<typeof paymentSchema> & { createdByName: string | null }

const PAYMENT_FIELDS =
  'id, amount, method, paid_at, kind, reason, created_by, subscription:subscriptions!inner(id, lessons_total, price_final, discount_percent, hours_total, period_month, enrollment:enrollments!inner(student_id, group_id))'

async function withAuthors(rows: z.infer<typeof paymentSchema>[]): Promise<PaymentRow[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.created_by ? [r.created_by] : [])))]
  let names: Record<string, string> = {}
  if (ids.length > 0) {
    const p = await supabase.from('profiles').select('id, full_name').in('id', ids)
    if (p.error) throw p.error
    names = Object.fromEntries(
      z
        .array(z.object({ id: z.uuid(), full_name: z.string() }))
        .parse(p.data)
        .map((x) => [x.id, x.full_name.split(' ')[0] ?? x.full_name]),
    )
  }
  return rows.map((r) => ({
    ...r,
    createdByName: r.created_by ? (names[r.created_by] ?? null) : null,
  }))
}

/** Payments and refunds with paid_at in [from, to) — А7 journal of a month, newest first. */
export const paymentsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: [PAYMENTS_KEY, from, to],
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('payments')
        .select(PAYMENT_FIELDS)
        .gte('paid_at', from)
        .lt('paid_at', to)
        .order('paid_at', { ascending: false })
      if (error) throw error
      return withAuthors(z.array(paymentSchema).parse(data))
    },
  })

/** Every payment of one student (А6 «Платежи»), newest first. */
export const studentPaymentsQuery = (studentId: string) =>
  queryOptions({
    queryKey: [PAYMENTS_KEY, 'student', studentId],
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('payments')
        .select(PAYMENT_FIELDS)
        .eq('subscription.enrollment.student_id', studentId)
        .order('paid_at', { ascending: false })
      if (error) throw error
      return withAuthors(z.array(paymentSchema).parse(data))
    },
  })

/**
 * Every payment, newest first — «Записать оплату» shows each student's last payment and warns of a
 * repeat (#93). ~200 students × a payment a month: a few thousand rows a year.
 */
export const allPaymentsQuery = () =>
  queryOptions({
    queryKey: [PAYMENTS_KEY, 'all'],
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('payments')
        .select(PAYMENT_FIELDS)
        .order('paid_at', { ascending: false })
      if (error) throw error
      return withAuthors(z.array(paymentSchema).parse(data))
    },
  })

// ─── Form input ─────────────────────────────────────────────────────────────

const amount = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(
    z
      .string()
      .regex(/^\d+$/, 'Сумма — целое число сом')
      .transform(Number)
      .pipe(z.number().int().positive('Сумма больше нуля').max(1_000_000, 'Слишком большая сумма')),
  )

/** ДД.ММ.ГГГГ, not after today (Bishkek). */
const paidOn = (today: string) =>
  z.string().transform((v, ctx) => {
    const iso = parseDateRu(v)
    if (!iso) {
      ctx.addIssue({ code: 'custom', message: 'Дата в формате ДД.ММ.ГГГГ' })
      return z.NEVER
    }
    if (iso > today) {
      ctx.addIssue({ code: 'custom', message: 'Дата оплаты — не позже сегодня' })
      return z.NEVER
    }
    return iso
  })

/** «Записать оплату»: on the current subscription or a new one (with a discount, В5). */
export const paymentForm = (today: string) =>
  z.discriminatedUnion('target', [
    z.object({
      target: z.literal('current'),
      subscriptionId: z.uuid({ error: 'Выберите абонемент' }),
      amount,
      method: z.enum(['cash', 'mbank']),
      paidOn: paidOn(today),
      comment: z.string().trim().max(500, 'Слишком длинный комментарий'),
    }),
    z.object({
      target: z.literal('new'),
      enrollmentId: z.uuid({ error: 'Выберите группу' }),
      discount: z.union([z.literal(0), z.literal(5), z.literal(15)]),
      /** Package size (И89); null — the tariff's package. Bounds — subscriptionLessons. */
      lessons: subscriptionLessons,
      amount,
      method: z.enum(['cash', 'mbank']),
      paidOn: paidOn(today),
      comment: z.string().trim().max(500, 'Слишком длинный комментарий'),
    }),
  ])

export type PaymentInput = z.output<ReturnType<typeof paymentForm>>

/** «Возврат» (В8): the amount may be 0 (nothing paid back) up to what was paid; reason required. */
export const refundForm = (today: string, maxAmount: number) =>
  z.object({
    subscriptionId: z.uuid(),
    amount: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(
        z
          .string()
          .regex(/^\d+$/, 'Сумма — целое число сом')
          .transform(Number)
          .pipe(z.number().int().min(0).max(maxAmount, 'Не больше, чем оплачено')),
      ),
    method: z.enum(['cash', 'mbank']),
    paidOn: paidOn(today),
    reason: z.string().trim().min(1, 'Укажите причину возврата').max(500, 'Слишком длинный текст'),
  })

export type RefundInput = z.output<ReturnType<typeof refundForm>>

// ─── RPC ────────────────────────────────────────────────────────────────────

export class PaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentError'
  }
}

/** Postgres error → admin-facing text; the RPCs raise one code per rule (0016). */
export function paymentErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Оплаты записывает только администратор'
  if (error.code === '23514') {
    if (m.includes('future')) return 'Дата оплаты — не позже сегодня'
    if (m.includes('refunded')) return 'По этому абонементу уже оформлен возврат'
    if (m.includes('finished')) return 'Ученик уже не занимается в этой группе'
    if (m.includes('15 %')) return '15 % — только на первый абонемент бывшего ученика'
    if (m.includes('5 %')) return '5 % — один абонемент за каждого приведённого друга'
    if (m.includes('lessons must be')) return lessonsErrorMessage(m)
    if (m.includes('no tariff')) return 'На сегодня нет тарифа для группы'
    if (m.includes('between 0')) return 'Возврат — не больше, чем оплачено'
    return 'Проверьте сумму и дату'
  }
  return 'Не удалось записать. Проверьте интернет и попробуйте ещё раз.'
}

const nullable = (s: string) => (s === '' ? null : s)

export async function recordPayment(input: PaymentInput): Promise<void> {
  if (input.target === 'current') {
    const { error } = await supabase.rpc('record_payment', {
      p_subscription_id: input.subscriptionId,
      p_amount: input.amount,
      p_method: input.method,
      p_paid_on: input.paidOn,
      p_comment: nullable(input.comment) ?? undefined,
    })
    if (error) throw new PaymentError(paymentErrorMessage(error))
    return
  }
  const discount = discountByPct(input.discount)
  const { error } = await supabase.rpc('buy_subscription', {
    p_enrollment_id: input.enrollmentId,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_on: input.paidOn,
    p_comment: nullable(input.comment) ?? undefined,
    p_discount_pct: discount.pct,
    p_discount_reason: discount.reason,
    p_lessons: input.lessons ?? undefined,
  })
  if (error) throw new PaymentError(paymentErrorMessage(error))
}

export async function refundSubscription(input: RefundInput): Promise<void> {
  const { error } = await supabase.rpc('refund_subscription', {
    p_subscription_id: input.subscriptionId,
    p_amount: input.amount,
    p_method: input.method,
    p_reason: input.reason,
    p_paid_on: input.paidOn,
  })
  if (error) throw new PaymentError(paymentErrorMessage(error))
}
