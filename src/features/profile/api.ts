import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import { bishkekDate } from '@/lib/time'

const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  phone: z.string(),
})

const rateSchema = z.object({
  percent: z.number(),
  valid_from: z.string(),
})

export interface Profile {
  id: string
  fullName: string
  phone: string
}

export const profileQuery = (userId: string) =>
  queryOptions({
    queryKey: ['profile', userId],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('id', userId)
        .single()
      if (error) throw error
      const p = profileSchema.parse(data)
      return { id: p.id, fullName: p.full_name, phone: p.phone }
    },
    staleTime: 5 * 60_000,
  })

/** Rate in effect on `date` — the latest valid_from not after it. */
export function currentRate(
  rates: readonly { percent: number; valid_from: string }[],
  date: string,
): number | null {
  let best: { percent: number; valid_from: string } | null = null
  for (const r of rates) {
    if (r.valid_from <= date && (!best || r.valid_from > best.valid_from)) best = r
  }
  return best ? best.percent : null
}

const teacherRowSchema = z.object({
  created_at: z.string(),
  teacher_rates: z.array(rateSchema),
  groups: z.array(
    z.object({
      subject: subjectName,
      status: z.enum(['forming', 'active', 'archived']),
      enrollments: z.array(
        z.object({ student_id: z.uuid(), status: z.enum(['active', 'finished']) }),
      ),
    }),
  ),
})

export interface TeacherSummary {
  percent: number | null
  /** Non-archived groups. */
  groups: number
  /** Distinct students actively enrolled in those groups. */
  students: number
  subjects: string[]
  /** teachers.created_at — when the teacher was added to the system. */
  since: string
}

export function summarizeTeacher(
  row: z.infer<typeof teacherRowSchema>,
  today: string,
): TeacherSummary {
  const groups = row.groups.filter((g) => g.status !== 'archived')
  const students = new Set(
    groups.flatMap((g) =>
      g.enrollments.filter((e) => e.status === 'active').map((e) => e.student_id),
    ),
  )
  const subjects = [...new Set(groups.map((g) => g.subject.trim().toLowerCase()))].sort()
  return {
    percent: currentRate(row.teacher_rates, today),
    groups: groups.length,
    students: students.size,
    subjects,
    since: row.created_at,
  }
}

// Teacher's own row: RLS lets a teacher read only their teachers row, rates and groups.
// Admin+teacher (staff) sees all groups — the embed is still scoped by groups.teacher_id.
export const teacherSummaryQuery = (userId: string, nowMs: number) => {
  const today = bishkekDate(nowMs)
  return queryOptions({
    queryKey: ['teacher-summary', userId, today],
    queryFn: async (): Promise<TeacherSummary | null> => {
      const { data, error } = await supabase
        .from('teachers')
        .select(
          'created_at, teacher_rates(percent, valid_from), groups(subject:subjects(name), status, enrollments(student_id, status))',
        )
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return summarizeTeacher(teacherRowSchema.parse(data), today)
    },
  })
}

export const passwordSchema = z
  .object({
    password: z.string().min(8, 'Минимум 8 символов'),
    repeat: z.string(),
  })
  .refine((v) => v.password === v.repeat, {
    message: 'Пароли не совпадают',
    path: ['repeat'],
  })

export async function changePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}
