// #109 · «Изменить абонемент» (К12, И91): size and price of a live package — update_subscription
// (0033, admin, a reason), the preview of payroll and balance «было → станет» from the database.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { EnrollError } from './api'
import { lessonsErrorMessage, priceErrorMessage } from './model'
import type { BalancePreview, PayrollPreview } from './edit-model'

type DbError = { code?: string; message?: string }

/** Postgres error of update_subscription / its previews (0033) → admin-facing text. */
export function subscriptionEditErrorMessage(error: DbError): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Абонемент меняет только администратор'
  if (error.code === 'P0002') return 'Абонемент не найден — обновите страницу'
  if (error.code === '23514') {
    if (m.includes('closed period'))
      return 'Есть отметки в закрытом периоде — сначала откройте период'
    if (m.includes('refunded')) return 'По абонементу оформлен возврат — его не изменить'
    if (m.includes('priced by hours')) return 'Счёт продлёнки по часам так не меняется'
    if (m.includes('lessons must be')) return lessonsErrorMessage(m)
    if (m.includes('price must be')) return priceErrorMessage
    if (m.includes('reason is required')) return 'Укажите причину'
    if (m.includes('reason is too long')) return 'Причина — до 500 символов'
    if (m.includes('nothing to change')) return 'Размер и цена не изменились'
  }
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

/** The package the «⋯» edits: the newest live one of the enrollment (as currentSubscription). */
const editableRow = z.object({
  id: z.uuid(),
  lessons_total: z.number().int(),
  price_full: z.number().int(),
  price_final: z.number().int(),
  discount_percent: z.number().int(),
  hours_total: z.number().nullable(),
  status: z.enum(['active', 'exhausted', 'refunded']),
  tariff: z.object({ lessons_in_package: z.number().int() }),
})

export type EditableSubscription = z.infer<typeof editableRow>

export const editableSubscriptionQuery = (enrollmentId: string) =>
  queryOptions({
    queryKey: ['editable-subscription', enrollmentId],
    gcTime: 0,
    queryFn: async (): Promise<EditableSubscription | null> => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select(
          'id, lessons_total, price_full, price_final, discount_percent, hours_total, status, tariff:tariffs!inner(lessons_in_package)',
        )
        .eq('enrollment_id', enrollmentId)
        .neq('status', 'refunded')
        .order('started_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw new EnrollError(subscriptionEditErrorMessage(error))
      const row = data[0]
      return row ? editableRow.parse(row) : null
    },
  })

const payrollRow = z.object({
  teacher_id: z.uuid(),
  teacher_name: z.string(),
  month: z.string(),
  marks: z.number().int(),
  mark_before: z.number().int(),
  mark_after: z.number().int(),
  amount_before: z.number().int(),
  amount_after: z.number().int(),
})

const balanceRow = z.object({
  phase: z.enum(['before', 'after']),
  lessons_total: z.number().int(),
  price_final: z.number().int(),
  paid_som: z.number().int(),
  lessons_used: z.number().int(),
  lessons_left: z.number().int(),
  debt_lessons: z.number().int(),
  debt_som: z.number().int(),
})

export interface EditPreview {
  payroll: PayrollPreview[]
  balance: { before: BalancePreview; after: BalancePreview } | null
}

const toBalance = (r: z.infer<typeof balanceRow>): BalancePreview => ({
  lessonsTotal: r.lessons_total,
  priceFinal: r.price_final,
  paidSom: r.paid_som,
  lessonsUsed: r.lessons_used,
  lessonsLeft: r.lessons_left,
  debtLessons: r.debt_lessons,
  debtSom: r.debt_som,
})

/** «было → станет» of an edit: subscription_update_preview + subscription_balance_preview. */
export const subscriptionEditPreviewQuery = (id: string, lessons: number, price: number) =>
  queryOptions({
    queryKey: ['subscription-edit-preview', id, lessons, price],
    gcTime: 0,
    queryFn: async (): Promise<EditPreview> => {
      const args = { p_id: id, p_lessons: lessons, p_price: price }
      const [payroll, balance] = await Promise.all([
        supabase.rpc('subscription_update_preview', args),
        supabase.rpc('subscription_balance_preview', args),
      ])
      if (payroll.error) throw new EnrollError(subscriptionEditErrorMessage(payroll.error))
      if (balance.error) throw new EnrollError(subscriptionEditErrorMessage(balance.error))
      const rows = z.array(balanceRow).parse(balance.data)
      const before = rows.find((r) => r.phase === 'before')
      const after = rows.find((r) => r.phase === 'after')
      return {
        payroll: z
          .array(payrollRow)
          .parse(payroll.data)
          .map((r) => ({
            teacherId: r.teacher_id,
            teacherName: r.teacher_name,
            month: r.month,
            marks: r.marks,
            markBefore: r.mark_before,
            markAfter: r.mark_after,
            amountBefore: r.amount_before,
            amountAfter: r.amount_after,
          })),
        balance: before && after ? { before: toBalance(before), after: toBalance(after) } : null,
      }
    },
  })

export const subscriptionEditForm = z.object({
  lessons: z
    .number({ error: 'Уроков — целое число' })
    .int('Уроков — целое число')
    .min(1, 'Уроков — от 1'),
  price: z
    .number({ error: 'Цена — целое число сом' })
    .int('Цена — целое число сом')
    .min(1, 'Цена — от 1 сом')
    .max(1_000_000, 'Цена — не больше 1 000 000 сом'),
  reason: z.string().trim().min(1, 'Укажите причину').max(500, 'Причина — до 500 символов'),
})

export async function updateSubscription(input: {
  id: string
  lessons: number
  price: number
  reason: string
}) {
  const { error } = await supabase.rpc('update_subscription', {
    p_id: input.id,
    p_lessons: input.lessons,
    p_price: input.price,
    p_reason: input.reason,
  })
  if (error) throw new EnrollError(subscriptionEditErrorMessage(error))
}
