// У4 / У5 / УД3 data: the signed-in teacher's groups (not archived) — one request under RLS.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { ENROLLMENT_FIELDS, enrollmentSchema, toEnrollment } from '@/features/lessons/api'
import { PAY_ATTENDANCE, PAY_ATTENDANCE_FIELDS } from '@/features/payroll/api'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { supabase } from '@/lib/supabase/client'
import { addDays } from './model'
import type { TeacherGroupsSource } from './teacher-model'

export const TEACHER_GROUPS_KEY = 'teacher-groups'

const GROUP_TYPE = z.enum(GROUP_TYPES as [GroupType, ...GroupType[]])

const sourceSchema = z.object({
  rates: z.array(z.object({ percent: z.number(), valid_from: z.string() })),
  groups: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      subject: z.string(),
      group_type: GROUP_TYPE,
      status: z.enum(['forming', 'active', 'archived']),
      room: z.string().nullable(),
      schedule_rules: z.array(
        z.object({
          weekday: z.number().int(),
          start_time: z.string(),
          valid_from: z.string(),
          valid_to: z.string().nullable(),
        }),
      ),
      enrollments: z.array(enrollmentSchema),
      lessons: z.array(
        z.object({
          id: z.uuid(),
          lesson_date: z.string(),
          planned_start: z.string(),
          duration_min: z.number().int(),
          status: z.enum(['planned', 'held', 'cancelled']),
          attendance: z.array(PAY_ATTENDANCE),
        }),
      ),
    }),
  ),
})

const tariffSchema = z.object({
  group_type: GROUP_TYPE,
  valid_from: z.string(),
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
  max_students: z.number().int(),
  lesson_duration_min: z.number().int(),
})

/** First day of the next month of `today`. */
function nextMonth(today: string): string {
  return addDays(`${today.slice(0, 8)}28`, 4).slice(0, 8) + '01'
}

/**
 * Groups of the teacher linked to `userId` with enrollments, subscriptions and marks, lessons of the
 * month of `today`; null — the user has no teachers row. The key holds the month (§7.1).
 */
export const teacherGroupsQuery = (userId: string, today: string) =>
  queryOptions({
    queryKey: [TEACHER_GROUPS_KEY, userId, today.slice(0, 7)],
    queryFn: async (): Promise<TeacherGroupsSource | null> => {
      const [teacher, tariffs] = await Promise.all([
        supabase
          .from('teachers')
          .select(
            `rates:teacher_rates(percent, valid_from), groups(id, name, subject, group_type, status, room, schedule_rules(weekday, start_time, valid_from, valid_to), enrollments(${ENROLLMENT_FIELDS}), lessons(id, lesson_date, planned_start, duration_min, status, ${PAY_ATTENDANCE_FIELDS}))`,
          )
          .eq('user_id', userId)
          .neq('groups.status', 'archived')
          .gte('groups.lessons.lesson_date', `${today.slice(0, 8)}01`)
          .lt('groups.lessons.lesson_date', nextMonth(today))
          .maybeSingle(),
        supabase
          .from('tariffs')
          .select(
            'group_type, valid_from, lessons_in_package, package_price, max_students, lesson_duration_min',
          ),
      ])
      if (teacher.error) throw teacher.error
      if (tariffs.error) throw tariffs.error
      if (!teacher.data) return null
      const row = sourceSchema.parse(teacher.data)
      return {
        rates: row.rates,
        tariffs: z.array(tariffSchema).parse(tariffs.data),
        groups: row.groups.map((g) => ({ ...g, enrollments: g.enrollments.map(toEnrollment) })),
      }
    },
    refetchInterval: 60_000,
  })
