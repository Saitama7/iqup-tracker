// Продлёнка (#82, #111 К13) — the student's plan for А6 and the enrollment form. The subscription is a
// package of days like every type (enroll_student / buy_subscription, p_lessons / p_price); the plan
// only decides on which days the student is on the roster. Writes — set_afterschool_plan (admin, 0035:
// marks of days that become 0 h are deleted); enroll_student takes the plan (p_plan).
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import type { PlanHours, PlanVersion } from './model'

export const AFTERSCHOOL_KEY = 'afterschool'

const planSchema = z.object({ valid_from: z.string(), hours: z.array(z.number()) })

/** One enrollment: its plan versions (oldest first). */
export const enrollmentPlanVersionsQuery = (enrollmentId: string) =>
  queryOptions({
    queryKey: [AFTERSCHOOL_KEY, enrollmentId],
    queryFn: async (): Promise<PlanVersion[]> => {
      const { data, error } = await supabase
        .from('afterschool_plans')
        .select('valid_from, hours')
        .eq('enrollment_id', enrollmentId)
        .order('valid_from')
      if (error) throw error
      return z.array(planSchema).parse(data)
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

// ─── RPC ────────────────────────────────────────────────────────────────────

export class AfterschoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AfterschoolError'
  }
}

/** Postgres error of set_afterschool_plan / afterschool_plan_preview → admin-facing text. */
export function afterschoolErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Это делает администратор'
  if (error.code === '23514') {
    if (m.includes('reason is required')) return 'Дата в прошлом — укажите причину'
    if (m.includes('outside the enrollment')) return 'Дата вне периода зачисления'
    if (m.includes('closed period')) return 'С этой даты есть отметки в закрытом периоде'
    if (m.includes('no hours') || m.includes('hours must'))
      return 'Укажите часы хотя бы на один день (0,5–4 ч)'
    return 'Проверьте данные'
  }
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

const previewSchema = z.array(
  z.object({
    marks: z.number().int(),
    weekdays: z.array(z.number().int()),
    payroll: z.array(
      z.object({
        teacher_id: z.uuid(),
        teacher_name: z.string(),
        month: z.string(),
        marks: z.number().int(),
        amount: z.number().int(),
      }),
    ),
  }),
)

export interface PlanPreview {
  /** Marks on days that become 0 h — deleted by the change. */
  marks: number
  /** ISO weekdays of those marks. */
  weekdays: number[]
  /** The teacher's payroll Δ per month, сом (negative — less). */
  payroll: { teacherName: string; month: string; amount: number }[]
}

/** What «Изменить с даты» deletes (afterschool_plan_preview, admin, К13). */
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
        weekdays: r?.weekdays ?? [],
        payroll: (r?.payroll ?? []).map((p) => ({
          teacherName: p.teacher_name,
          month: p.month,
          amount: p.amount,
        })),
      }
    },
  })

/**
 * «Изменить с даты»: a plan version from `validFrom`; marks from that date on days with 0 h by it are
 * deleted (a journal row each). A date in the past needs a reason (the journal).
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
