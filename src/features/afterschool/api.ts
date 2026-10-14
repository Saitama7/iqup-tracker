// Продлёнка по часам (#82) — data for А6 (plan, invoices) and the enrollment form. Writes go through
// the RPCs of 0025 (admin only, one transaction each): set_afterschool_plan,
// issue_afterschool_invoice; enroll_student takes the plan (p_plan).
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { discountByPct, type DiscountPct } from '@/features/subscriptions/model'
import { nextMonth, type PlanHours, type PlanVersion, type QuoteRow } from './model'

export const AFTERSCHOOL_KEY = 'afterschool'

const planSchema = z.object({ valid_from: z.string(), hours: z.array(z.number()) })

const invoiceSchema = z.object({
  id: z.uuid(),
  period_month: z.string(),
  hours_total: z.number(),
  credit_hours: z.number(),
  price_full: z.number().int(),
  price_final: z.number().int(),
  discount_percent: z.number().int(),
  status: z.enum(['active', 'exhausted', 'refunded']),
})

const quoteSchema = z.array(
  z.object({ weekday: z.number().int(), hours: z.number(), days: z.number().int() }),
)

export type Invoice = z.infer<typeof invoiceSchema>

export interface MonthBill {
  /** First day of the month. */
  month: string
  /**
   * First billed day (afterschool_bill_from): the month start, or — the first invoice after an old
   * 20-lesson package — the day after it; past the month — the package covers it.
   */
  from: string
  /** Planned hours by weekday (afterschool_month_quote) — the authority. */
  rows: QuoteRow[]
  /** The live invoice of the month, if issued. */
  invoice: Invoice | null
}

export interface EnrollmentAfterschool {
  plans: PlanVersion[]
  /** Current and next month. */
  months: [MonthBill, MonthBill]
  /** Live invoices of earlier months (oldest first). */
  earlier: Invoice[]
  /** Unused hours of earlier invoices not yet taken off one (И61). */
  credit: number
}

/** One enrollment: plan versions, the bills of `month` and the next one, the credit. */
export const enrollmentAfterschoolQuery = (enrollmentId: string, month: string) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, enrollmentId, month],
    queryFn: async (): Promise<EnrollmentAfterschool> => {
      const months = [month, nextMonth(month)] as const
      const billFrom = async (m: string) => {
        const { data, error } = await supabase.rpc('afterschool_bill_from', {
          p_enrollment_id: enrollmentId,
          p_month: m,
        })
        if (error) throw error
        return z.string().nullable().parse(data) ?? m
      }
      const [from1, from2] = await Promise.all([billFrom(months[0]), billFrom(months[1])])
      const [plans, invoices, q1, q2, credit] = await Promise.all([
        supabase
          .from('afterschool_plans')
          .select('valid_from, hours')
          .eq('enrollment_id', enrollmentId)
          .order('valid_from'),
        supabase
          .from('subscriptions')
          .select(
            'id, period_month, hours_total, credit_hours, price_full, price_final, discount_percent, status',
          )
          .eq('enrollment_id', enrollmentId)
          .not('period_month', 'is', null)
          .neq('status', 'refunded'),
        supabase.rpc('afterschool_month_quote', {
          p_enrollment_id: enrollmentId,
          p_month: months[0],
          p_from: from1,
        }),
        supabase.rpc('afterschool_month_quote', {
          p_enrollment_id: enrollmentId,
          p_month: months[1],
          p_from: from2,
        }),
        supabase.rpc('afterschool_credit_hours', { p_enrollment_id: enrollmentId }),
      ])
      for (const r of [plans, invoices, q1, q2, credit]) if (r.error) throw r.error
      const list = z.array(invoiceSchema).parse(invoices.data)
      const bill = (m: string, from: string, rows: unknown): MonthBill => ({
        month: m,
        from,
        rows: quoteSchema.parse(rows),
        invoice: list.find((i) => i.period_month === m) ?? null,
      })
      return {
        plans: z.array(planSchema).parse(plans.data),
        months: [bill(months[0], from1, q1.data), bill(months[1], from2, q2.data)],
        earlier: list
          .filter((i) => i.period_month < months[0])
          .sort((a, b) => a.period_month.localeCompare(b.period_month)),
        credit: z.number().parse(credit.data ?? 0),
      }
    },
  })

/** Plan versions of the after-school enrollments, by enrollment id — «Заморозка заранее» skips 0 h days. */
export const enrollmentPlansQuery = (enrollmentIds: readonly string[]) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, 'plans', [...enrollmentIds].sort().join(',')],
    queryFn: async (): Promise<Map<string, PlanVersion[]>> => {
      const byEnrollment = new Map<string, PlanVersion[]>()
      if (enrollmentIds.length === 0) return byEnrollment
      const { data, error } = await supabase
        .from('afterschool_plans')
        .select('enrollment_id, valid_from, hours')
        .in('enrollment_id', [...enrollmentIds])
      if (error) throw error
      for (const r of z.array(planSchema.extend({ enrollment_id: z.uuid() })).parse(data)) {
        const list = byEnrollment.get(r.enrollment_id) ?? []
        list.push({ valid_from: r.valid_from, hours: r.hours })
        byEnrollment.set(r.enrollment_id, list)
      }
      return byEnrollment
    },
  })

/** Non-cancelled lesson dates of a group in [from, before) — the enrollment form's «≈ 21 ч в октябре». */
export const groupLessonDatesQuery = (groupId: string, from: string, before: string) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, 'lesson-dates', groupId, from, before],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('lessons')
        .select('lesson_date')
        .eq('group_id', groupId)
        .neq('status', 'cancelled')
        .gte('lesson_date', from)
        .lt('lesson_date', before)
      if (error) throw error
      return z
        .array(z.object({ lesson_date: z.string() }))
        .parse(data)
        .map((r) => r.lesson_date)
    },
  })

// ─── RPC ────────────────────────────────────────────────────────────────────

export class AfterschoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AfterschoolError'
  }
}

/** Postgres error of the 0025 RPCs → admin-facing text. */
export function afterschoolErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Это делает администратор'
  if (error.code === '23505') return 'Счёт за этот месяц уже выставлен'
  if (error.code === '23514') {
    if (m.includes('later month')) return 'Уже выставлен счёт за более поздний месяц'
    if (m.includes('no planned hours')) return 'В этом месяце по графику нет часов'
    if (m.includes('billing date')) return 'Дата должна быть в месяце счёта'
    if (m.includes('reason is required')) return 'Дата в прошлом — укажите причину'
    if (m.includes('outside the enrollment')) return 'Дата вне периода зачисления'
    if (m.includes('closed period')) return 'С этой даты есть отметки в закрытом периоде'
    if (m.includes('no hours') || m.includes('hours must'))
      return 'Укажите часы хотя бы на один день (0,5–4 ч)'
    if (m.includes('finished')) return 'Зачисление завершено'
    if (m.includes('no tariff')) return 'Нет тарифа продлёнки на этот месяц'
    if (m.includes('15 %')) return '15 % — только на первый абонемент бывшего ученика'
    if (m.includes('5 %')) return '5 % — один абонемент за каждого приведённого друга'
    return 'Проверьте данные'
  }
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

/** Hours of a month from a date (afterschool_month_quote) — the first invoice's «Считать с». */
export const monthQuoteQuery = (enrollmentId: string, month: string, from: string) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, enrollmentId, 'quote', month, from],
    queryFn: async (): Promise<QuoteRow[]> => {
      const { data, error } = await supabase.rpc('afterschool_month_quote', {
        p_enrollment_id: enrollmentId,
        p_month: month,
        p_from: from,
      })
      if (error) throw error
      return quoteSchema.parse(data)
    },
  })

const previewSchema = z.array(
  z.object({
    marks: z.number().int(),
    hours_delta: z.number(),
    payroll_delta: z.number().int(),
    balance_delta: z.number().int(),
  }),
)

export interface PlanPreview {
  /** Marks whose hours change. */
  marks: number
  hoursDelta: number
  /** Teacher's pay Δ, сом (+ — more). */
  payrollDelta: number
  /** What the student owes Δ, сом (+ — owes more). */
  balanceDelta: number
}

/** What «Изменить с даты» does to the marks already there (afterschool_plan_preview, admin). */
export const planPreviewQuery = (enrollmentId: string, validFrom: string, hours: PlanHours) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, enrollmentId, 'preview', validFrom, hours.join(',')],
    queryFn: async (): Promise<PlanPreview> => {
      const { data, error } = await supabase.rpc('afterschool_plan_preview', {
        p_enrollment_id: enrollmentId,
        p_valid_from: validFrom,
        p_hours: [...hours],
      })
      if (error) throw new AfterschoolError(afterschoolErrorMessage(error))
      const [r] = previewSchema.parse(data)
      return {
        marks: r?.marks ?? 0,
        hoursDelta: r?.hours_delta ?? 0,
        payrollDelta: r?.payroll_delta ?? 0,
        balanceDelta: r?.balance_delta ?? 0,
      }
    },
  })

/**
 * «Изменить с даты»: a plan version from `validFrom`; marks from that date are re-priced. A date in
 * the past needs a reason (the journal).
 */
export async function setAfterschoolPlan(
  enrollmentId: string,
  validFrom: string,
  hours: PlanHours,
  reason?: string,
) {
  const { error } = await supabase.rpc('set_afterschool_plan', {
    p_enrollment_id: enrollmentId,
    p_valid_from: validFrom,
    p_hours: [...hours],
    ...(reason?.trim() ? { p_reason: reason.trim() } : {}),
  })
  if (error) throw new AfterschoolError(afterschoolErrorMessage(error))
}

/** «Выставить счёт за ноябрь»: the hour subscription of the month, no payment. */
export async function issueAfterschoolInvoice(
  enrollmentId: string,
  month: string,
  discount: DiscountPct,
  from?: string,
) {
  const d = discountByPct(discount)
  const { data, error } = await supabase.rpc('issue_afterschool_invoice', {
    p_enrollment_id: enrollmentId,
    p_month: month,
    p_discount_pct: d.pct,
    p_discount_reason: d.reason,
    ...(from ? { p_from: from } : {}),
  })
  if (error) throw new AfterschoolError(afterschoolErrorMessage(error))
  return z.uuid().parse(data)
}
