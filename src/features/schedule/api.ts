// А1 Дашборд / АМ1 / А2 Расписание data. Admin is staff: RLS gives every teacher's lessons.
// Reads go through v_lesson_status (0001). Its effective_status counts days by the server date; the
// screens decide «не подтверждено» by lessonState(now) instead — the same rule plus И14 for today.
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { supabase } from '@/lib/supabase/client'
import type { LessonStatus } from '@/features/lessons/select'

/** Safety net for a dropped realtime socket — docs/02-architecture.md §7.1, only on А1 / А2. */
const POLL_MS = 60_000

/** Every query of these screens starts with this key — realtime invalidates them all at once. */
export const ADMIN_LESSONS_KEY = 'admin-lessons'

const lessonSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  duration_min: z.number().int(),
  status: z.enum(['planned', 'held', 'cancelled']),
  is_extra: z.boolean(),
  makes_up_for_lesson_id: z.uuid().nullable(),
  cancel_reason: z.enum(['center', 'teacher', 'holiday', 'all_frozen']).nullable(),
  confirmed_at: z.string().nullable(),
  group: z.object({
    id: z.uuid(),
    name: z.string(),
    subject: z.string(),
    group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
    room: z.string().nullable(),
    status: z.enum(['forming', 'active', 'archived']),
    teacher: z.object({ id: z.uuid(), full_name: z.string() }),
    enrollments: z.array(z.object({ status: z.enum(['active', 'finished']) })),
  }),
  attendance: z.array(z.object({ status: z.enum(['present', 'absent_frozen', 'absent_burned']) })),
})

export interface AdminLesson {
  id: string
  lesson_date: string
  planned_start: string
  duration_min: number
  status: LessonStatus
  is_extra: boolean
  cancel_reason: 'center' | 'teacher' | 'holiday' | 'all_frozen' | null
  confirmed_at: string | null
  /** Date of the cancelled lesson an extra one makes up for (А2 «доп · за 1 окт»). */
  makesUpFor: string | null
  group: {
    id: string
    name: string
    subject: string
    group_type: GroupType
    room: string | null
    status: 'forming' | 'active' | 'archived'
  }
  teacher: { id: string; name: string }
  /** Active enrollments of the group now. */
  students: number
  attendance: { status: 'present' | 'absent_frozen' | 'absent_burned' }[]
}

const LESSON_FIELDS =
  'id, lesson_date, planned_start, duration_min, status, is_extra, makes_up_for_lesson_id, cancel_reason, confirmed_at, group:groups!inner(id, name, subject, group_type, room, status, teacher:teachers!inner(id, full_name), enrollments(status)), attendance(status)'

async function toLessons(data: unknown): Promise<AdminLesson[]> {
  const rows = z.array(lessonSchema).parse(data)
  // The view has two relationships with lessons (made up / makes up), so the date of the original
  // lesson comes in a second small read instead of an embed.
  const originals = [...new Set(rows.flatMap((r) => r.makes_up_for_lesson_id ?? []))]
  const dates = new Map<string, string>()
  if (originals.length > 0) {
    const { data: found, error } = await supabase
      .from('lessons')
      .select('id, lesson_date')
      .in('id', originals)
    if (error) throw error
    for (const o of z.array(z.object({ id: z.uuid(), lesson_date: z.string() })).parse(found)) {
      dates.set(o.id, o.lesson_date)
    }
  }
  return rows.map((r) => {
    const { teacher, enrollments, ...group } = r.group
    return {
      id: r.id,
      lesson_date: r.lesson_date,
      planned_start: r.planned_start,
      duration_min: r.duration_min,
      status: r.status,
      is_extra: r.is_extra,
      cancel_reason: r.cancel_reason,
      confirmed_at: r.confirmed_at,
      makesUpFor: r.makes_up_for_lesson_id ? (dates.get(r.makes_up_for_lesson_id) ?? null) : null,
      group,
      teacher: { id: teacher.id, name: teacher.full_name },
      students: enrollments.filter((e) => e.status === 'active').length,
      attendance: r.attendance,
    }
  })
}

/**
 * All teachers' lessons from `from` to `to` inclusive: today on А1 / АМ1, a week on А2.
 * The key holds the dates, so a new day / week is fetched by itself (§7.1).
 */
export const adminLessonsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: [ADMIN_LESSONS_KEY, 'range', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_lesson_status')
        .select(LESSON_FIELDS)
        .gte('lesson_date', from)
        .lte('lesson_date', to)
        .order('lesson_date')
        .order('planned_start')
      if (error) throw error
      return toLessons(data)
    },
    refetchInterval: POLL_MS,
  })

/**
 * Lessons of the current month up to today still `planned` — the candidates for «Не подтверждено»
 * (v_lesson_status: planned and before today; plus today's that are over, docs/05-decisions И14).
 * Which of them are over is decided on the client by lessonState(now), not by the server date.
 */
export const adminUnconfirmedQuery = (today: string) =>
  queryOptions({
    queryKey: [ADMIN_LESSONS_KEY, 'unconfirmed', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_lesson_status')
        .select(LESSON_FIELDS)
        .eq('status', 'planned')
        .gte('lesson_date', `${today.slice(0, 8)}01`)
        .lte('lesson_date', today)
        .order('lesson_date')
        .order('planned_start')
      if (error) throw error
      return toLessons(data)
    },
    refetchInterval: POLL_MS,
  })

export interface TeacherOption {
  id: string
  name: string
}

/** А2 teacher filter: «Все учителя», then every teacher by name. */
export const teacherOptionsQuery = () =>
  queryOptions({
    queryKey: ['admin-teachers'],
    queryFn: async (): Promise<TeacherOption[]> => {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, full_name')
        .order('full_name')
      if (error) throw error
      return z
        .array(z.object({ id: z.uuid(), full_name: z.string() }))
        .parse(data)
        .map((t) => ({ id: t.id, name: t.full_name }))
    },
  })

export const useTeacherOptions = () => useQuery(teacherOptionsQuery())

/**
 * One channel for the admin: any change of lessons or attendance (a teacher confirmed a lesson,
 * someone cancelled one) → refetch А1 / А2. RLS gives the admin every row, so no filter.
 */
export function useAdminLessonsRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: [ADMIN_LESSONS_KEY] })
    const channel = supabase
      .channel('lessons:admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, invalidate)
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
