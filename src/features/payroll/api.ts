// «Мой месяц» (У6 / УД4), Б1 «Расчёт ЗП», the month cards on УД1 / А1.
// The teacher's month is computed on the client by calc.ts from lessons + marks (the screen lists
// every lesson anyway); Б1 / А1 / УД1 read the totals from v_payroll_preview (0011) — same rules.
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import { monthEnd, monthStart } from './model'
import type { Adjustment, MyMonthGroup, MyMonthSource, PayrollSource, PreviewRow } from './model'

/** Every payroll query starts with this key — realtime and «Провести» invalidate them at once. */
export const PAYROLL_KEY = 'payroll'

const POLL_MS = 60_000

const GROUP_TYPE = z.enum(GROUP_TYPES as [GroupType, ...GroupType[]])
const MARK = z.enum(['present', 'absent_frozen', 'absent_burned'])
const RATE = z.object({ percent: z.number(), valid_from: z.string() })
/** A mark with the subscription it was written off — its price is the teacher's base (К6). */
export const PAY_ATTENDANCE = z.object({
  status: MARK,
  subscription: z
    .object({
      price_full: z.number(),
      lessons_total: z.number().int(),
      hours_total: z.number().nullable(),
    })
    .nullable(),
  /** After-school: hours charged by the student's plan (#82). */
  hours: z.number().nullable(),
  /** After-school hours not invoiced yet: the hour price on the lesson date (И69). */
  unbilled_hour_price: z.number().nullable(),
})
export const PAY_ATTENDANCE_FIELDS =
  'attendance(status, hours, unbilled_hour_price, subscription:subscriptions(price_full, lessons_total, hours_total))'

const tariffSchema = z.object({
  group_type: GROUP_TYPE,
  valid_from: z.string(),
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
})

const myGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: subjectName,
  group_type: GROUP_TYPE,
  enrollments: z.array(
    z.object({
      student_id: z.uuid(),
      start_date: z.string(),
      end_date: z.string().nullable(),
      status: z.enum(['active', 'finished']),
    }),
  ),
})

const myLessonSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  duration_min: z.number().int(),
  status: z.enum(['planned', 'held', 'cancelled']),
  confirmed_at: z.string().nullable(),
  confirmed_late: z.boolean(),
  group: myGroupSchema,
  attendance: z.array(PAY_ATTENDANCE),
})

const adjustmentSchema = z.object({
  id: z.uuid(),
  teacher_id: z.uuid(),
  month: z.string(),
  kind: z.enum(['advance', 'bonus', 'correction']),
  amount: z.number().int(),
  issued_on: z.string(),
  comment: z.string().nullable(),
  created_at: z.string(),
  author: z.object({ full_name: z.string() }).nullable(),
})

const ADJUSTMENT_FIELDS =
  'id, teacher_id, month, kind, amount, issued_on, comment, created_at, author:profiles!created_by(full_name)'

/** payroll_adjustments of `month`, oldest first; RLS leaves a teacher only her own. */
async function fetchAdjustments(month: string, teacherId?: string): Promise<Adjustment[]> {
  let query = supabase
    .from('payroll_adjustments')
    .select(ADJUSTMENT_FIELDS)
    .eq('month', monthStart(month))
    .order('issued_on')
    .order('created_at')
  if (teacherId) query = query.eq('teacher_id', teacherId)
  const { data, error } = await query
  if (error) throw error
  return z
    .array(adjustmentSchema)
    .parse(data)
    .map((a) => ({
      id: a.id,
      teacherId: a.teacher_id,
      month: a.month,
      kind: a.kind,
      amount: a.amount,
      issuedOn: a.issued_on,
      comment: a.comment,
      author: a.author?.full_name ?? null,
      createdAt: a.created_at,
    }))
}

async function fetchTariffs() {
  const { data, error } = await supabase
    .from('tariffs')
    .select('group_type, valid_from, lessons_in_package, package_price')
  if (error) throw error
  return z.array(tariffSchema).parse(data)
}

/**
 * The signed-in teacher's lessons of `month` (`YYYY-MM`) by lessons.teacher_id — the teacher paid
 * for the lesson, whatever group.teacher_id is now (0020) — with marks, folded by group (archived
 * and handed-over groups too: their lessons were paid); null — the user has no teachers row.
 */
export const myMonthQuery = (userId: string, month: string) =>
  queryOptions({
    queryKey: [PAYROLL_KEY, 'my-month', userId, month],
    queryFn: async (): Promise<MyMonthSource | null> => {
      const teacher = await supabase
        .from('teachers')
        .select('id, rates:teacher_rates(percent, valid_from)')
        .eq('user_id', userId)
        .maybeSingle()
      if (teacher.error) throw teacher.error
      if (!teacher.data) return null
      const me = z.object({ id: z.uuid(), rates: z.array(RATE) }).parse(teacher.data)
      const [lessons, tariffs, adjustments] = await Promise.all([
        supabase
          .from('lessons')
          .select(
            `id, lesson_date, planned_start, duration_min, status, confirmed_at, confirmed_late, group:groups!inner(id, name, subject:subjects(name), group_type, enrollments(student_id, start_date, end_date, status)), ${PAY_ATTENDANCE_FIELDS}`,
          )
          .eq('teacher_id', me.id)
          .gte('lesson_date', monthStart(month))
          .lte('lesson_date', monthEnd(month))
          .order('lesson_date')
          .order('planned_start'),
        fetchTariffs(),
        fetchAdjustments(month, me.id),
      ])
      if (lessons.error) throw lessons.error
      const byGroup = new Map<string, MyMonthGroup>()
      for (const { group, ...lesson } of z.array(myLessonSchema).parse(lessons.data)) {
        const entry = byGroup.get(group.id) ?? { ...group, lessons: [] }
        entry.lessons.push(lesson)
        byGroup.set(group.id, entry)
      }
      return {
        teacherId: me.id,
        rates: me.rates,
        groups: [...byGroup.values()],
        tariffs,
        adjustments,
      }
    },
    refetchInterval: POLL_MS,
  })

const previewSchema = z.object({
  teacher_id: z.uuid(),
  month: z.string(),
  lessons_held: z.number().int(),
  hours: z.number(),
  student_lessons: z.number().int(),
  base_amount: z.number().int(),
  no_subscription: z.number().int(),
  advances: z.number().int(),
  to_pay: z.number().int(),
  student_hours: z.number(),
})

/** v_payroll_preview rows of `month`; RLS leaves a teacher only her own. */
async function fetchPreview(month: string, teacherId?: string): Promise<PreviewRow[]> {
  let query = supabase
    .from('v_payroll_preview')
    .select(
      'teacher_id, month, lessons_held, hours, student_lessons, base_amount, no_subscription, advances, to_pay, student_hours',
    )
    .eq('month', monthStart(month))
  if (teacherId) query = query.eq('teacher_id', teacherId)
  const { data, error } = await query
  if (error) throw error
  return z
    .array(previewSchema)
    .parse(data)
    .map((r) => ({
      teacherId: r.teacher_id,
      lessonsHeld: r.lessons_held,
      hours: r.hours,
      studentLessons: r.student_lessons,
      noSubscription: r.no_subscription,
      studentHours: r.student_hours,
      amount: r.base_amount,
      advances: r.advances,
      toPay: r.to_pay,
    }))
}

/** УД1 month card: the teacher's row of v_payroll_preview (null — nothing held yet). */
export const myPreviewQuery = (teacherId: string, month: string) =>
  queryOptions({
    queryKey: [PAYROLL_KEY, 'my-preview', teacherId, month],
    queryFn: async (): Promise<PreviewRow | null> =>
      (await fetchPreview(month, teacherId))[0] ?? null,
    refetchInterval: POLL_MS,
  })

/** А1 card «Расчёт ЗП → N сом»: everyone's accrual of `month`. */
export const monthTotalQuery = (month: string) =>
  queryOptions({
    queryKey: [PAYROLL_KEY, 'total', month],
    queryFn: async () => (await fetchPreview(month)).reduce((sum, r) => sum + r.amount, 0),
    refetchInterval: POLL_MS,
  })

const payrollTeacherSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  rates: z.array(RATE),
  groups: z.array(
    z.object({ subject: subjectName, status: z.enum(['forming', 'active', 'archived']) }),
  ),
})

const plannedSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  duration_min: z.number().int(),
  status: z.enum(['planned', 'held', 'cancelled']),
})

/**
 * Б1: v_payroll_preview of `month`, every teacher (with nothing held — zeros) and the month's
 * planned lessons up to `today` — which of them are over decides lessonState(now) on the client.
 */
export const payrollQuery = (month: string, today: string) =>
  queryOptions({
    queryKey: [PAYROLL_KEY, 'table', month, today],
    queryFn: async (): Promise<PayrollSource> => {
      const last = monthEnd(month) < today ? monthEnd(month) : today
      const [preview, adjustments, teachers, planned] = await Promise.all([
        fetchPreview(month),
        fetchAdjustments(month),
        supabase
          .from('teachers')
          .select(
            'id, full_name, rates:teacher_rates(percent, valid_from), groups(subject:subjects(name), status)',
          )
          .order('full_name'),
        supabase
          .from('lessons')
          .select('id, lesson_date, planned_start, duration_min, status')
          .eq('status', 'planned')
          .gte('lesson_date', monthStart(month))
          .lte('lesson_date', last),
      ])
      if (teachers.error) throw teachers.error
      if (planned.error) throw planned.error
      return {
        preview,
        adjustments,
        teachers: z.array(payrollTeacherSchema).parse(teachers.data),
        planned: z.array(plannedSchema).parse(planned.data),
      }
    },
    refetchInterval: POLL_MS,
  })

// ─── Advances (А8, #83) ─────────────────────────────────────────────────────

/** «Выдать аванс»: amount in whole som, date ДД.ММ.ГГГГ not after today, payroll month, comment. */
export const advanceForm = (today: string) =>
  z.object({
    teacherId: z.uuid(),
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
    issuedOn: z.string().transform((v, ctx) => {
      const iso = parseDateRu(v)
      if (!iso) {
        ctx.addIssue({ code: 'custom', message: 'Дата в формате ДД.ММ.ГГГГ' })
        return z.NEVER
      }
      if (iso > today) {
        ctx.addIssue({ code: 'custom', message: 'Дата выдачи — не позже сегодня' })
        return z.NEVER
      }
      return iso
    }),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Выберите месяц'),
    comment: z.string().trim().max(500, 'Слишком длинный комментарий'),
  })

export type AdvanceInput = z.output<ReturnType<typeof advanceForm>>

export const deleteAdjustmentForm = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, 'Укажите причину').max(500, 'Слишком длинный текст'),
})

export type DeleteAdjustmentInput = z.output<typeof deleteAdjustmentForm>

export class AdvanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdvanceError'
  }
}

/** Postgres error → staff-facing text (0022 raises one code per rule). */
export function advanceErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Авансы выдают только администратор и бухгалтер'
  if (error.code === '23514') {
    if (m.includes('closed')) return 'Месяц закрыт — аванс уже не изменить'
    if (m.includes('future')) return 'Дата выдачи — не позже сегодня'
    if (m.includes('reason')) return 'Укажите причину'
    return 'Проверьте сумму и дату'
  }
  if (error.code === 'P0002') return 'Запись уже удалена'
  return 'Не удалось записать. Проверьте интернет и попробуйте ещё раз.'
}

export async function issueAdvance(input: AdvanceInput): Promise<void> {
  const { error } = await supabase.rpc('issue_advance', {
    p_teacher_id: input.teacherId,
    p_amount: input.amount,
    p_issued_on: input.issuedOn,
    p_month: monthStart(input.month),
    p_comment: input.comment === '' ? undefined : input.comment,
  })
  if (error) throw new AdvanceError(advanceErrorMessage(error))
}

export async function deleteAdjustment(input: DeleteAdjustmentInput): Promise<void> {
  const { error } = await supabase.rpc('delete_payroll_adjustment', {
    p_id: input.id,
    p_reason: input.reason,
  })
  if (error) throw new AdvanceError(advanceErrorMessage(error))
}

/**
 * Someone confirmed or edited a lesson → refetch every payroll query. RLS filters the events:
 * a teacher hears only her own lessons, staff — all.
 */
export function usePayrollRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: [PAYROLL_KEY] })
    const channel = supabase
      .channel('lessons:payroll')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, invalidate)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payroll_adjustments' },
        invalidate,
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
