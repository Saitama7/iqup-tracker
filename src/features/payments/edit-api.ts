// #92 · Правка и удаление оплаты админом (Г9, Г10): delete_payment / update_payment (0026) and the
// rows the dialog «Удалить оплату» needs to say what happens to the subscription.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import { PaymentError } from './api'
import type { ImpactSubscription } from './edit-model'

const impactSchema = z.array(
  z.object({
    id: z.uuid(),
    status: z.enum(['active', 'exhausted', 'refunded']),
    started_at: z.string(),
    created_at: z.string(),
    lessons_total: z.number(),
    hours_total: z.number().nullable(),
    credit_hours: z.number(),
    credit_out_hours: z.number().nullable(),
    price_final: z.number().int(),
    attendance: z.array(z.object({ consumes_credit: z.boolean(), hours: z.number().nullable() })),
    payments: z.array(z.object({ id: z.uuid(), amount: z.number().int() })),
  }),
)

/** Every subscription of the enrollment behind `subscriptionId`, with payments and marks. */
export const paymentImpactQuery = (subscriptionId: string) =>
  queryOptions({
    // not under PAYMENTS_KEY: the invalidation after a delete must not refetch a subscription that went
    queryKey: ['payment-impact', subscriptionId],
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<ImpactSubscription[]> => {
      const own = await supabase
        .from('subscriptions')
        .select('enrollment_id')
        .eq('id', subscriptionId)
        .single()
      if (own.error) throw own.error
      const { data, error } = await supabase
        .from('subscriptions')
        .select(
          'id, status, started_at, created_at, lessons_total, hours_total, credit_hours, credit_out_hours, price_final, attendance(consumes_credit, hours), payments(id, amount)',
        )
        .eq('enrollment_id', own.data.enrollment_id)
      if (error) throw error
      return impactSchema.parse(data).map((s) => ({
        id: s.id,
        status: s.status,
        started_at: s.started_at,
        created_at: s.created_at,
        lessons_total: s.hours_total ?? s.lessons_total,
        credit: s.credit_hours,
        creditOut: s.credit_out_hours ?? 0,
        price_final: s.price_final,
        used: s.attendance
          .filter((a) => a.consumes_credit)
          .reduce((n, a) => n + (s.hours_total ? (a.hours ?? 0) : 1), 0),
        unit: s.hours_total ? 'hour' : 'lesson',
        hours: s.hours_total !== null,
        marks: s.attendance.length,
        payments: s.payments,
      }))
    },
  })

const reason = z
  .string()
  .trim()
  .min(1, 'Укажите причину')
  .max(500, 'Причина — не длиннее 500 символов')

export const deletePaymentForm = z.object({ paymentId: z.uuid(), reason })
export type DeletePaymentInput = z.output<typeof deletePaymentForm>

/** «Изменить оплату»: the money of the row (a refund too — positive), method, date, comment. */
export const editPaymentForm = (today: string, refund: boolean) =>
  z.object({
    paymentId: z.uuid(),
    amount: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(
        z
          .string()
          .regex(/^\d+$/, 'Сумма — целое число сом')
          .transform(Number)
          .pipe(
            z.number().int().positive('Сумма больше нуля').max(1_000_000, 'Слишком большая сумма'),
          ),
      ),
    method: z.enum(['cash', 'mbank']),
    paidOn: z.string().transform((v, ctx) => {
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
    }),
    comment: refund
      ? z.string().trim().min(1, 'Укажите причину возврата').max(500, 'Слишком длинный текст')
      : z.string().trim().max(500, 'Слишком длинный комментарий'),
    reason,
    /** #119: move the payment to another subscription of the enrollment; null — it stays. */
    subscriptionId: z.uuid().nullable(),
  })
export type EditPaymentInput = z.output<ReturnType<typeof editPaymentForm>>

/** Postgres error of delete_payment / update_payment → admin-facing text (0026). */
export function editErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Оплаты правит только администратор'
  if (error.code === 'P0002') return 'Оплата уже удалена — обновите страницу'
  if (error.code === '23514') {
    if (m.includes('reason is required')) return 'Укажите причину'
    if (m.includes('reason is too long')) return 'Причина — не длиннее 500 символов'
    if (m.includes('transfer')) return 'Перенос удаляется только откатом перевода или ухода'
    if (m.includes('delete the refund first')) return 'Сначала удалите возврат по этому абонементу'
    if (m.includes('deleted by mistake'))
      return 'Возврат по записи «Записан по ошибке» не удаляется'
    if (m.includes('same enrollment')) return 'Перенести можно только на абонемент этой же группы'
    if (m.includes('subscription is refunded')) return 'По этому абонементу оформлен возврат'
    if (m.includes('stays on its subscription')) return 'Возврат не переносится'
    if (m.includes('another invoice')) return 'За этот месяц у ученика уже есть другой счёт'
    if (m.includes('future')) return 'Дата оплаты — не позже сегодня'
    if (m.includes('between 0')) return 'Возврат — не больше, чем оплачено'
    if (m.includes('positive')) return 'Сумма больше нуля'
    return 'Проверьте сумму и дату'
  }
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

export type DeleteOutcome = 'deleted' | 'subscription_deleted' | 'reactivated'

export async function deletePayment(input: DeletePaymentInput): Promise<DeleteOutcome> {
  const { data, error } = await supabase.rpc('delete_payment', {
    p_payment_id: input.paymentId,
    p_reason: input.reason,
  })
  if (error) throw new PaymentError(editErrorMessage(error))
  return z.enum(['deleted', 'subscription_deleted', 'reactivated']).parse(data)
}

export async function updatePayment(input: EditPaymentInput): Promise<void> {
  const { error } = await supabase.rpc('update_payment', {
    p_payment_id: input.paymentId,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_on: input.paidOn,
    p_comment: input.comment,
    p_reason: input.reason,
    p_subscription_id: input.subscriptionId ?? undefined,
  })
  if (error) throw new PaymentError(editErrorMessage(error))
}
