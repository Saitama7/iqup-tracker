// «Мой месяц» (У6 / УД4), Б1 «Расчёт ЗП», the month cards on УД1 / А1.
// The teacher's month is computed on the client by calc.ts from lessons + marks (the screen lists
// every lesson anyway); Б1 / А1 / УД1 read the totals from v_payroll_preview (0011) — same rules.
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { supabase } from '@/lib/supabase/client'
import { monthEnd, monthStart } from './model'
import type { MyMonthSource, PayrollSource, PreviewRow } from './model'

/** Every payroll query starts with this key — realtime and «Провести» invalidate them at once. */
export const PAYROLL_KEY = 'payroll'

const POLL_MS = 60_000

const GROUP_TYPE = z.enum(GROUP_TYPES as [GroupType, ...GroupType[]])
const MARK = z.enum(['present', 'absent_frozen', 'absent_burned'])
const RATE = z.object({ percent: z.number(), valid_from: z.string() })

const tariffSchema = z.object({
  group_type: GROUP_TYPE,
  valid_from: z.string(),
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
})

const myMonthSchema = z.object({
  id: z.uuid(),
  rates: z.array(RATE),
  groups: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      subject: z.string(),
      group_type: GROUP_TYPE,
      enrollments: z.array(
        z.object({
          student_id: z.uuid(),
          start_date: z.string(),
          end_date: z.string().nullable(),
          status: z.enum(['active', 'finished']),
        }),
      ),
      lessons: z.array(
        z.object({
          id: z.uuid(),
          lesson_date: z.string(),
          planned_start: z.string(),
          duration_min: z.number().int(),
          status: z.enum(['planned', 'held', 'cancelled']),
          confirmed_at: z.string().nullable(),
          confirmed_late: z.boolean(),
          attendance: z.array(z.object({ status: MARK })),
        }),
      ),
    }),
  ),
})

async function fetchTariffs() {
  const { data, error } = await supabase
    .from('tariffs')
    .select('group_type, valid_from, lessons_in_package, package_price')
  if (error) throw error
  return z.array(tariffSchema).parse(data)
}

/**
 * The signed-in teacher's groups (archived too — their lessons were paid) with the lessons of
 * `month` (`YYYY-MM`) and marks; null — the user has no teachers row.
 */
export const myMonthQuery = (userId: string, month: string) =>
  queryOptions({
    queryKey: [PAYROLL_KEY, 'my-month', userId, month],
    queryFn: async (): Promise<MyMonthSource | null> => {
      const [teacher, tariffs] = await Promise.all([
        supabase
          .from('teachers')
          .select(
            'id, rates:teacher_rates(percent, valid_from), groups(id, name, subject, group_type, enrollments(student_id, start_date, end_date, status), lessons(id, lesson_date, planned_start, duration_min, status, confirmed_at, confirmed_late, attendance(status)))',
          )
          .eq('user_id', userId)
          .gte('groups.lessons.lesson_date', monthStart(month))
          .lte('groups.lessons.lesson_date', monthEnd(month))
          .maybeSingle(),
        fetchTariffs(),
      ])
      if (teacher.error) throw teacher.error
      if (!teacher.data) return null
      const row = myMonthSchema.parse(teacher.data)
      return { teacherId: row.id, rates: row.rates, groups: row.groups, tariffs }
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
})

/** v_payroll_preview rows of `month`; RLS leaves a teacher only her own. */
async function fetchPreview(month: string, teacherId?: string): Promise<PreviewRow[]> {
  let query = supabase
    .from('v_payroll_preview')
    .select('teacher_id, month, lessons_held, hours, student_lessons, base_amount')
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
      amount: r.base_amount,
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
    z.object({ subject: z.string(), status: z.enum(['forming', 'active', 'archived']) }),
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
      const [preview, teachers, planned] = await Promise.all([
        fetchPreview(month),
        supabase
          .from('teachers')
          .select(
            'id, full_name, rates:teacher_rates(percent, valid_from), groups(subject, status)',
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
        teachers: z.array(payrollTeacherSchema).parse(teachers.data),
        planned: z.array(plannedSchema).parse(planned.data),
      }
    },
    refetchInterval: POLL_MS,
  })

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
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
