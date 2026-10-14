// Продлёнка по часам (#82) — data for А6 (plan, invoices) and the enrollment form. Writes go through
// the RPCs of 0023 (admin only, one transaction each): set_afterschool_plan,
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
  /** Frozen hours not yet taken off an invoice (И57). */
  credit: number
}

/** One enrollment: plan versions, the bills of `month` and the next one, the credit. */
export const enrollmentAfterschoolQuery = (enrollmentId: string, month: string) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, enrollmentId, month],
    queryFn: async (): Promise<EnrollmentAfterschool> => {
      const months = [month, nextMonth(month)] as const
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
        }),
        supabase.rpc('afterschool_month_quote', {
          p_enrollment_id: enrollmentId,
          p_month: months[1],
        }),
        supabase.rpc('afterschool_credit_hours', { p_enrollment_id: enrollmentId }),
      ])
      for (const r of [plans, invoices, q1, q2, credit]) if (r.error) throw r.error
      const list = z.array(invoiceSchema).parse(invoices.data)
      const bill = (m: string, rows: unknown): MonthBill => ({
        month: m,
        rows: quoteSchema.parse(rows),
        invoice: list.find((i) => i.period_month === m) ?? null,
      })
      return {
        plans: z.array(planSchema).parse(plans.data),
        months: [bill(months[0], q1.data), bill(months[1], q2.data)],
        earlier: list
          .filter((i) => i.period_month < months[0])
          .sort((a, b) => a.period_month.localeCompare(b.period_month)),
        credit: z.number().parse(credit.data ?? 0),
      }
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

/** Postgres error of the 0023 RPCs → admin-facing text. */
export function afterschoolErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Это делает администратор'
  if (error.code === '23505') return 'Счёт за этот месяц уже выставлен'
  if (error.code === '23514') {
    if (m.includes('later month')) return 'Уже выставлен счёт за более поздний месяц'
    if (m.includes('no planned hours')) return 'В этом месяце по графику нет часов'
    if (m.includes('credit covers')) return 'Кредит часов покрывает весь месяц — счёт не нужен'
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

/** «Изменить с даты»: a plan version from `validFrom`; marks from that date are re-priced. */
export async function setAfterschoolPlan(
  enrollmentId: string,
  validFrom: string,
  hours: PlanHours,
) {
  const { error } = await supabase.rpc('set_afterschool_plan', {
    p_enrollment_id: enrollmentId,
    p_valid_from: validFrom,
    p_hours: [...hours],
  })
  if (error) throw new AfterschoolError(afterschoolErrorMessage(error))
}

/** «Выставить счёт за ноябрь»: the hour subscription of the month, no payment. */
export async function issueAfterschoolInvoice(
  enrollmentId: string,
  month: string,
  discount: DiscountPct,
) {
  const d = discountByPct(discount)
  const { data, error } = await supabase.rpc('issue_afterschool_invoice', {
    p_enrollment_id: enrollmentId,
    p_month: month,
    p_discount_pct: d.pct,
    p_discount_reason: d.reason,
  })
  if (error) throw new AfterschoolError(afterschoolErrorMessage(error))
  return z.uuid().parse(data)
}
