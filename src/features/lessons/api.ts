// «Сегодня» (У2 / УД1) and the attendance sheet (У3 / УД2). Reads under RLS: a teacher sees only own groups' lessons.
// Admin+teacher (Каныкей) is staff and sees everything, so rows are also scoped by groups.teacher_id.
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType, type TariffTerms } from '@/features/tariffs/current'
import { PAYROLL_KEY } from '@/features/payroll/api'
import { supabase } from '@/lib/supabase/client'
import { addDays } from '@/features/groups/model'
import type { EnrollmentSource, Mark } from './attendance'

/** Safety net for a dropped realtime socket — docs/02-architecture.md §7.1. */
const POLL_MS = 60_000

const lessonSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  duration_min: z.number().int(),
  status: z.enum(['planned', 'held', 'cancelled']),
  is_extra: z.boolean(),
  confirmed_at: z.string().nullable(),
  group: z.object({
    id: z.uuid(),
    name: z.string(),
    subject: z.string(),
    group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
    room: z.string().nullable(),
    enrollments: z.array(z.object({ status: z.enum(['active', 'finished']) })),
  }),
  attendance: z.array(z.object({ status: z.enum(['present', 'absent_frozen', 'absent_burned']) })),
})

export interface TeacherLesson {
  id: string
  lesson_date: string
  planned_start: string
  duration_min: number
  status: 'planned' | 'held' | 'cancelled'
  is_extra: boolean
  confirmed_at: string | null
  group: { id: string; name: string; subject: string; group_type: GroupType; room: string | null }
  /** Active enrollments of the group now. */
  students: number
  marks: { present: number; frozen: number; burned: number }
}

const LESSON_FIELDS =
  'id, lesson_date, planned_start, duration_min, status, is_extra, confirmed_at, group:groups!inner(id, name, subject, group_type, room, enrollments(status)), attendance(status)'

function toLesson(row: z.infer<typeof lessonSchema>): TeacherLesson {
  const { group, attendance, ...rest } = row
  const { enrollments, ...g } = group
  const count = (s: string) => attendance.filter((a) => a.status === s).length
  return {
    ...rest,
    group: g,
    students: enrollments.filter((e) => e.status === 'active').length,
    marks: {
      present: count('present'),
      frozen: count('absent_frozen'),
      burned: count('absent_burned'),
    },
  }
}

// ─── Me as a teacher ────────────────────────────────────────────────────────

export interface MyTeacher {
  id: string
  groupIds: string[]
}

/** The teachers row linked to the user and its groups (null — the user has no teachers row). */
export const myTeacherQuery = (userId: string) =>
  queryOptions({
    queryKey: ['my-teacher', userId],
    queryFn: async (): Promise<MyTeacher | null> => {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, groups(id)')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const row = z
        .object({ id: z.uuid(), groups: z.array(z.object({ id: z.uuid() })) })
        .parse(data)
      return { id: row.id, groupIds: row.groups.map((g) => g.id) }
    },
    refetchInterval: POLL_MS,
  })

// ─── Lessons around today ───────────────────────────────────────────────────

export const TODAY_KEY = 'today-lessons'

/**
 * Start of the month … tomorrow for one teacher: today's deck and list, «Завтра» and the lessons of
 * this month still not confirmed (Б2).
 * The key holds the date, so at midnight the list is fetched for the new day by itself (§7.1).
 */
export const todayLessonsQuery = (teacherId: string, date: string) =>
  queryOptions({
    queryKey: [TODAY_KEY, teacherId, date],
    queryFn: async (): Promise<TeacherLesson[]> => {
      const { data, error } = await supabase
        .from('lessons')
        .select(LESSON_FIELDS)
        .eq('group.teacher_id', teacherId)
        .gte('lesson_date', `${date.slice(0, 8)}01`)
        .lte('lesson_date', addDays(date, 1))
        .order('lesson_date')
        .order('planned_start')
      if (error) throw error
      return z.array(lessonSchema).parse(data).map(toLesson)
    },
    refetchInterval: POLL_MS,
  })

export function useTodayLessons(teacherId: string | undefined, date: string) {
  return useQuery({
    ...todayLessonsQuery(teacherId ?? '', date),
    enabled: !!teacherId,
  })
}

/**
 * Someone else's change (admin cancelled a lesson, added an extra one) → refetch.
 * Supabase Realtime on lessons of my groups; RLS applies to the events as well.
 */
export function useLessonsRealtime(teacher: MyTeacher | null | undefined) {
  const queryClient = useQueryClient()
  const groups = teacher?.groupIds.join(',') ?? ''
  const teacherId = teacher?.id

  useEffect(() => {
    if (!teacherId || !groups) return
    const channel = supabase
      .channel(`lessons:teacher:${teacherId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lessons', filter: `group_id=in.(${groups})` },
        () => {
          void queryClient.invalidateQueries({ queryKey: [TODAY_KEY] })
          void queryClient.invalidateQueries({ queryKey: [PAYROLL_KEY] })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, teacherId, groups])
}

// ─── One lesson: attendance sheet (У3 / УД2) ────────────────────────────────

const markSchema = z.enum(['present', 'absent_frozen', 'absent_burned'])

const subscriptionSchema = z.object({
  id: z.uuid(),
  status: z.enum(['active', 'exhausted', 'refunded']),
  started_at: z.string(),
  created_at: z.string(),
  lessons_total: z.number().int(),
  price_final: z.number(),
  tariff: z.object({ freeze_limit: z.number().int() }),
  attendance: z.array(z.object({ lesson_id: z.uuid(), status: markSchema })),
})

export const enrollmentSchema = z.object({
  start_date: z.string(),
  end_date: z.string().nullable(),
  status: z.enum(['active', 'finished']),
  student: z.object({ id: z.uuid(), full_name: z.string(), parent_phone: z.string().nullable() }),
  subscriptions: z.array(subscriptionSchema),
})

/** subscriptions(…) of an enrollment, with every mark charged to them. */
export const ENROLLMENT_FIELDS =
  'start_date, end_date, status, student:students(id, full_name, parent_phone), subscriptions(id, status, started_at, created_at, lessons_total, price_final, tariff:tariffs(freeze_limit), attendance(lesson_id, status))'

export function toEnrollment(row: z.infer<typeof enrollmentSchema>): EnrollmentSource {
  return {
    ...row,
    subscriptions: row.subscriptions.map(({ tariff, attendance, ...s }) => ({
      ...s,
      freeze_limit: tariff.freeze_limit,
      marks: attendance,
    })),
  }
}

const sheetSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  duration_min: z.number().int(),
  status: z.enum(['planned', 'held', 'cancelled']),
  is_extra: z.boolean(),
  confirmed_at: z.string().nullable(),
  confirmed_late: z.boolean(),
  group: z.object({
    id: z.uuid(),
    name: z.string(),
    subject: z.string(),
    group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
    room: z.string().nullable(),
    teacher: z.object({
      rates: z.array(z.object({ percent: z.number(), valid_from: z.string() })),
    }),
    enrollments: z.array(enrollmentSchema),
  }),
  attendance: z.array(z.object({ student_id: z.uuid(), status: markSchema })),
})

export interface LessonSheet {
  id: string
  lesson_date: string
  planned_start: string
  duration_min: number
  status: 'planned' | 'held' | 'cancelled'
  is_extra: boolean
  confirmed_at: string | null
  confirmed_late: boolean
  group: { id: string; name: string; subject: string; group_type: GroupType; room: string | null }
  /** Rates of the group's teacher — payroll goes to groups.teacher_id (invariant 6). */
  rates: { percent: number; valid_from: string }[]
  enrollments: EnrollmentSource[]
  /** Marks saved on this lesson. */
  marks: Map<string, Mark>
  tariffs: TariffTerms[]
}

export const lessonKey = (lessonId: string) => ['lesson', lessonId] as const

/** The lesson, every enrollment of its group with subscriptions and their marks, tariffs. */
export const lessonSheetQuery = (lessonId: string) =>
  queryOptions({
    queryKey: lessonKey(lessonId),
    queryFn: async (): Promise<LessonSheet | null> => {
      const [lesson, tariffs] = await Promise.all([
        supabase
          .from('lessons')
          .select(
            `id, lesson_date, planned_start, duration_min, status, is_extra, confirmed_at, confirmed_late, group:groups!inner(id, name, subject, group_type, room, teacher:teachers!inner(rates:teacher_rates(percent, valid_from)), enrollments(${ENROLLMENT_FIELDS})), attendance(student_id, status)`,
          )
          .eq('id', lessonId)
          .maybeSingle(),
        supabase
          .from('tariffs')
          .select('group_type, valid_from, lessons_in_package, package_price'),
      ])
      if (lesson.error) throw lesson.error
      if (tariffs.error) throw tariffs.error
      if (!lesson.data) return null
      const { group, attendance, ...rest } = sheetSchema.parse(lesson.data)
      const { teacher, enrollments, ...g } = group
      return {
        ...rest,
        group: g,
        rates: teacher.rates,
        enrollments: enrollments.map(toEnrollment),
        marks: new Map(attendance.map((a) => [a.student_id, a.status])),
        tariffs: z
          .array(
            z.object({
              group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
              valid_from: z.string(),
              lessons_in_package: z.number().int(),
              package_price: z.number().int(),
            }),
          )
          .parse(tariffs.data),
      }
    },
  })

// ─── «Провести занятие» ─────────────────────────────────────────────────────

export class LessonsApiError extends Error {
  /**
   * offline — no answer from the server, worth retrying; already_confirmed — the lesson is held
   * (e.g. a retry after a lost response); rejected — any other rule.
   */
  readonly kind: 'offline' | 'already_confirmed' | 'rejected'
  constructor(message: string, kind: LessonsApiError['kind']) {
    super(message)
    this.name = 'LessonsApiError'
    this.kind = kind
  }
}

/** confirm_lesson error → teacher-facing text (one code per rule, 0010 / 0001 triggers). */
export function confirmErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') return 'Провести занятие может только учитель группы'
  if (m.includes('already confirmed')) return 'Занятие уже проведено'
  if (m.includes('freeze limit')) return 'Лимит заморозок: 2 на абонемент — отметьте «Не был»'
  if (m.includes('not started')) return 'Занятие ещё не началось'
  if (m.includes('closed period')) return 'Период закрыт — исправления через администратора'
  if (m.includes('cancelled')) return 'Занятие отменено'
  if (m.includes('not marked') || m.includes('not enrolled'))
    return 'Состав группы изменился — обновите страницу'
  return 'Не удалось провести занятие. Попробуйте ещё раз.'
}

/** One RPC, one transaction: marks of the whole roster + lesson → held. Returns confirmed_at. */
export async function confirmLesson(
  lessonId: string,
  marks: { student_id: string; status: Mark }[],
): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_lesson', {
    p_lesson_id: lessonId,
    p_marks: marks,
  })
  if (error) {
    // supabase-js reports a failed fetch as an error without a Postgres code
    const kind = !error.code
      ? 'offline'
      : error.message.includes('already confirmed')
        ? 'already_confirmed'
        : 'rejected'
    throw new LessonsApiError(confirmErrorMessage(error), kind)
  }
  return z.string().parse(data)
}
