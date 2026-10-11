// «Сегодня» data (У2 / УД1). Reads under RLS: a teacher sees only own groups' lessons.
// Admin+teacher (Каныкей) is staff and sees everything, so rows are also scoped by groups.teacher_id.
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { supabase } from '@/lib/supabase/client'
import { addDays } from '@/features/groups/model'

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
        () => void queryClient.invalidateQueries({ queryKey: [TODAY_KEY] }),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, teacherId, groups])
}

// ─── One lesson (/lessons/:id stub until R1-8) ──────────────────────────────

export const lessonQuery = (lessonId: string) =>
  queryOptions({
    queryKey: ['lesson', lessonId],
    queryFn: async (): Promise<TeacherLesson | null> => {
      const { data, error } = await supabase
        .from('lessons')
        .select(LESSON_FIELDS)
        .eq('id', lessonId)
        .maybeSingle()
      if (error) throw error
      return data ? toLesson(lessonSchema.parse(data)) : null
    },
  })
