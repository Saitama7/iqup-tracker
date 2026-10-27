// #81: leaving a group — «Перевести в другую группу» (the remainder moves), «Ушёл из группы» (finish +
// refund or keep), «Записан по ошибке — удалить» (marks deleted, payroll drops). Admin-only RPCs of 0024;
// the database checks every rule and computes every number the dialogs show.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import type { PaymentMethod } from '@/features/payments/api'
import { supabase } from '@/lib/supabase/client'
import { EnrollError } from './api'
import { AFTERSCHOOL_NO_TRANSFER } from './exit-model'
import { priceErrorMessage } from './model'

type DbError = { code?: string; message?: string }

/** Shared refusals of the three RPCs, in words. */
function commonMessage(error: DbError): string | null {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Это может только администратор'
  if (error.code === '23503') return 'Зачисление или группа не найдены — обновите страницу'
  if (error.code === '23505') return 'Ученик уже зачислен в выбранную группу'
  if (error.code !== '23514') return null
  if (m.includes('closed period')) return 'Есть отметки в закрытом периоде — их не изменить'
  if (m.includes('enrollment is finished')) return 'Зачисление уже завершено — обновите страницу'
  if (m.includes('archived')) return 'Группа в архиве'
  if (m.includes('already in this group')) return 'Ученик уже в этой группе'
  if (m.includes('outside the group dates')) return 'Дата — вне дат выбранной группы'
  if (m.includes('payment method is required')) return 'Выберите способ возврата'
  if (m.includes('no tariff')) return 'Нет тарифа для этой группы на эту дату'
  if (m.includes('price must be')) return priceErrorMessage
  return null
}

const fallback = (error: DbError, what: string) =>
  commonMessage(error) ??
  (error.code === '23514'
    ? `${what} невозможно. Проверьте даты и суммы`
    : `${what} не удалось. Проверьте интернет и попробуйте ещё раз.`)

export function transferErrorMessage(error: DbError): string {
  const m = error.message ?? ''
  if (error.code === '23514') {
    if (m.includes('after the enrollment start'))
      return 'Дата перевода — позже начала зачисления. Если ученик с начала ходил не туда — «Записан по ошибке»'
    if (m.includes('present or burned marks'))
      return 'С этой даты у ученика уже есть отметки «был» / «не был» — выберите дату позже'
    if (m.includes('after the enrollment end')) return 'Дата позже окончания зачисления'
    if (m.includes('after-school by hours')) return AFTERSCHOOL_NO_TRANSFER
  }
  return fallback(error, 'Перевод')
}

export function withdrawErrorMessage(error: DbError): string {
  const m = error.message ?? ''
  if (error.code === '23514') {
    if (m.includes('present or burned marks'))
      return 'После этой даты есть отметки «был» / «не был» — выберите дату позже'
    if (m.includes('before the enrollment start')) return 'Дата раньше начала зачисления'
    if (m.includes('refund must be')) return 'Сумма возврата — от 0 до остатка'
    if (m.includes('left to the center'))
      return 'Невозвращённый остаток — только явно центру, с причиной'
  }
  return fallback(error, 'Завершение')
}

export function deleteErrorMessage(error: DbError): string {
  const m = error.message ?? ''
  if (error.code === '23514') {
    if (m.includes('has payments'))
      return 'Есть оплаты — выберите: перевести деньги в правильную группу или вернуть'
    if (m.includes('debt cannot be refunded'))
      return 'На зачислении долг — его можно только перевести'
  }
  return fallback(error, 'Удаление')
}

// ─── Queries ────────────────────────────────────────────────────────────────

const settlementRow = z.object({
  present_marks: z.number().int(),
  burned_marks: z.number().int(),
  frozen_marks: z.number().int(),
  locked_marks: z.number().int(),
  last_mark_date: z.string().nullable(),
  payments: z.number().int(),
  money_som: z.number().int(),
  paid_som: z.number().int(),
  lessons_used: z.number(),
  used_som: z.number().int(),
  remainder: z.number().int(),
  lesson_price: z.number().nullable(),
  has_trial: z.boolean(),
  unit: z.enum(['lesson', 'hour']),
  hours_used: z.number(),
})

export interface Settlement {
  present: number
  burned: number
  frozen: number
  locked: number
  /** Last lesson with «был» / «не был» — the enrollment cannot end before it. */
  lastMarkDate: string | null
  payments: number
  /** Σ every payment of the enrollment (refunded subscriptions too). */
  moneySom: number
  /** Σ payments of the live subscriptions. */
  paidSom: number
  /** Lessons of the packages. */
  lessonsUsed: number
  /** Hours of the after-school month bills and of the months not invoiced yet (#82, И69). */
  hoursUsed: number
  usedSom: number
  /** paid − used; negative — a debt. */
  remainder: number
  /** Paid price of a lesson (of an hour, unit = hour) of the newest subscription. */
  lessonPrice: number | null
  hasTrial: boolean
  unit: 'lesson' | 'hour'
}

export const settlementQuery = (enrollmentId: string) =>
  queryOptions({
    queryKey: ['enrollment-settlement', enrollmentId],
    gcTime: 0,
    queryFn: async (): Promise<Settlement> => {
      const { data, error } = await supabase.rpc('enrollment_settlement', {
        p_enrollment_id: enrollmentId,
      })
      if (error) throw new EnrollError(fallback(error, 'Загрузка'))
      const r = z.array(settlementRow).parse(data)[0]
      if (!r) throw new EnrollError('Зачисление не найдено — обновите страницу')
      return {
        present: r.present_marks,
        burned: r.burned_marks,
        frozen: r.frozen_marks,
        locked: r.locked_marks,
        lastMarkDate: r.last_mark_date,
        payments: r.payments,
        moneySom: r.money_som,
        paidSom: r.paid_som,
        lessonsUsed: r.lessons_used,
        hoursUsed: r.hours_used,
        usedSom: r.used_som,
        remainder: r.remainder,
        lessonPrice: r.lesson_price,
        hasTrial: r.has_trial,
        unit: r.unit,
      }
    },
  })

const impactRow = z.object({
  teacher_id: z.uuid(),
  teacher_name: z.string(),
  lessons: z.number().int(),
  amount: z.number().int(),
  hour_marks: z.number().int(),
  hours: z.number(),
})

export interface PayrollImpact {
  teacherId: string
  teacherName: string
  /** Marks paid to the teacher; `hourMarks` of them are after-school days by hours (#82). */
  lessons: number
  amount: number
  hourMarks: number
  hours: number
}

/** What the teachers were paid for the enrollment's «был» / «не был» (by lessons.teacher_id). */
export const payrollImpactQuery = (enrollmentId: string) =>
  queryOptions({
    queryKey: ['enrollment-payroll-impact', enrollmentId],
    gcTime: 0,
    queryFn: async (): Promise<PayrollImpact[]> => {
      const { data, error } = await supabase.rpc('enrollment_payroll_impact', {
        p_enrollment_id: enrollmentId,
      })
      if (error) throw new EnrollError(fallback(error, 'Загрузка'))
      return z
        .array(impactRow)
        .parse(data)
        .map((r) => ({
          teacherId: r.teacher_id,
          teacherName: r.teacher_name,
          lessons: r.lessons,
          amount: r.amount,
          hourMarks: r.hour_marks,
          hours: r.hours,
        }))
    },
  })

const previewRow = z.object({
  start_date: z.string(),
  whole_move: z.boolean(),
  lessons_total: z.number().int().nullable(),
  price: z.number().int().nullable(),
  remainder: z.number().int(),
  to_pay: z.number().int().nullable(),
  surplus: z.number().int().nullable(),
})

export interface TransferPreview {
  startDate: string
  /** Same type, nothing written off — the enrollment moves whole with its payments (#73). */
  wholeMove: boolean
  lessonsTotal: number | null
  /** New group's package price on the start date; null — no tariff. */
  price: number | null
  remainder: number
  toPay: number
  surplus: number
}

/** startDate null — the server's default (next lesson of the new group). */
export const transferPreviewQuery = (
  enrollmentId: string,
  groupId: string,
  startDate: string | null,
) =>
  queryOptions({
    queryKey: ['transfer-preview', enrollmentId, groupId, startDate],
    gcTime: 0,
    queryFn: async (): Promise<TransferPreview> => {
      const { data, error } = await supabase.rpc('transfer_preview', {
        p_enrollment_id: enrollmentId,
        p_group_id: groupId,
        ...(startDate ? { p_start_date: startDate } : {}),
      })
      if (error) throw new EnrollError(transferErrorMessage(error))
      const r = z.array(previewRow).parse(data)[0]
      if (!r) throw new EnrollError('Не удалось посчитать перевод')
      return {
        startDate: r.start_date,
        wholeMove: r.whole_move,
        lessonsTotal: r.lessons_total,
        price: r.price,
        remainder: r.remainder,
        toPay: r.to_pay ?? 0,
        surplus: r.surplus ?? 0,
      }
    },
  })

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function transferStudent(input: {
  enrollmentId: string
  groupId: string
  startDate: string
  refundSurplus: boolean
  method: PaymentMethod | null
  /** The new package's price (К12); null — the default of the target group. */
  price?: number | null
}) {
  const { error } = await supabase.rpc('transfer_student', {
    p_enrollment_id: input.enrollmentId,
    p_group_id: input.groupId,
    p_start_date: input.startDate,
    p_refund_surplus: input.refundSurplus,
    ...(input.method ? { p_method: input.method } : {}),
    ...(input.price != null ? { p_price: input.price } : {}),
  })
  if (error) throw new EnrollError(transferErrorMessage(error))
}

export async function withdrawEnrollment(input: {
  enrollmentId: string
  endDate: string
  refund: number
  method: PaymentMethod | null
  reason: string
  /** Why the rest (remainder − refund) stays with the center; required when there is a rest. */
  centerReason: string
}) {
  const { error } = await supabase.rpc('withdraw_enrollment', {
    p_enrollment_id: input.enrollmentId,
    p_end_date: input.endDate,
    p_refund: input.refund,
    ...(input.method ? { p_method: input.method } : {}),
    ...(input.reason.trim() ? { p_reason: input.reason.trim() } : {}),
    ...(input.centerReason.trim() ? { p_center_reason: input.centerReason.trim() } : {}),
  })
  if (error) throw new EnrollError(withdrawErrorMessage(error))
}

export type DeleteMoney =
  | { kind: 'none' }
  | { kind: 'transfer'; groupId: string; startDate: string }
  | { kind: 'refund'; method: PaymentMethod }

export async function deleteEnrollment(enrollmentId: string, money: DeleteMoney) {
  const { error } = await supabase.rpc('delete_enrollment', {
    p_enrollment_id: enrollmentId,
    ...(money.kind === 'transfer'
      ? { p_money: 'transfer', p_group_id: money.groupId, p_start_date: money.startDate }
      : money.kind === 'refund'
        ? { p_money: 'refund', p_method: money.method }
        : {}),
  })
  if (error) throw new EnrollError(deleteErrorMessage(error))
}
