// #74 · Исправление отметок: admin RPCs (0021) and the teacher's requests. RLS: a teacher reads own
// requests and inserts for own held lessons; staff read all; apply / reject are admin RPCs.
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import type { Mark } from './attendance'
import { correctionErrorReason, type CorrectionRequest } from './corrections'

const POLL_MS = 60_000

export const CORRECTIONS_KEY = 'correction-requests'

const markSchema = z.enum(['present', 'absent_frozen', 'absent_burned'])

const requestSchema = z.object({
  id: z.uuid(),
  lesson_id: z.uuid(),
  status: z.enum(['pending', 'approved', 'rejected']),
  marks: z.array(z.object({ student_id: z.uuid(), status: markSchema })),
  comment: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  decision_comment: z.string().nullable(),
})

const REQUEST_FIELDS =
  'id, lesson_id, status, marks, comment, created_at, decided_at, decision_comment'

export class CorrectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CorrectionError'
  }
}

const fail = (error: { code?: string; message?: string }) =>
  new CorrectionError(correctionErrorReason(error))

/** Requests of one lesson, newest first. */
export const lessonRequestsQuery = (lessonId: string) =>
  queryOptions({
    queryKey: [CORRECTIONS_KEY, 'lesson', lessonId],
    queryFn: async (): Promise<CorrectionRequest[]> => {
      const { data, error } = await supabase
        .from('attendance_correction_requests')
        .select(REQUEST_FIELDS)
        .eq('lesson_id', lessonId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return z.array(requestSchema).parse(data)
    },
    refetchInterval: POLL_MS,
  })

export interface PendingRequest {
  id: string
  lessonId: string
  createdAt: string
  teacher: string
  lessonDate: string
  start: string
  group: string
  subject: string
  /** The lesson's period is closed: only «Отклонить» is possible. */
  locked: boolean
}

const pendingSchema = z.object({
  id: z.uuid(),
  lesson_id: z.uuid(),
  created_at: z.string(),
  teacher: z.object({ full_name: z.string() }),
  lesson: z.object({
    lesson_date: z.string(),
    planned_start: z.string(),
    is_locked: z.boolean(),
    group: z.object({ name: z.string(), subject: subjectName }),
  }),
})

/** Admin: requests waiting for a decision — «Требует внимания» and the menu badge. */
export const pendingRequestsQuery = () =>
  queryOptions({
    queryKey: [CORRECTIONS_KEY, 'pending'],
    queryFn: async (): Promise<PendingRequest[]> => {
      const { data, error } = await supabase
        .from('attendance_correction_requests')
        .select(
          'id, lesson_id, created_at, teacher:teachers(full_name), lesson:lessons(lesson_date, planned_start, is_locked, group:groups(name, subject:subjects(name)))',
        )
        .eq('status', 'pending')
        .order('created_at')
      if (error) throw error
      return z
        .array(pendingSchema)
        .parse(data)
        .map((r) => ({
          id: r.id,
          lessonId: r.lesson_id,
          createdAt: r.created_at,
          teacher: r.teacher.full_name,
          lessonDate: r.lesson.lesson_date,
          start: r.lesson.planned_start,
          group: r.lesson.group.name,
          subject: r.lesson.group.subject,
          locked: r.lesson.is_locked,
        }))
    },
    refetchInterval: POLL_MS,
  })

export function usePendingRequests(enabled: boolean) {
  useCorrectionsRealtime(enabled)
  return useQuery({ ...pendingRequestsQuery(), enabled })
}

/** A request created or decided elsewhere → refetch (RLS applies to the events). */
export function useCorrectionsRealtime(enabled = true) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const channel = supabase
      .channel(`corrections:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_correction_requests' },
        () => {
          void queryClient.invalidateQueries({ queryKey: [CORRECTIONS_KEY] })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, enabled])
}

type Payload = { student_id: string; status: Mark }[]

/** Admin: new marks of a held lesson with a reason. Returns how many marks changed. */
export async function correctAttendance(lessonId: string, marks: Payload, reason: string) {
  const { data, error } = await supabase.rpc('correct_attendance', {
    p_lesson_id: lessonId,
    p_marks: marks,
    p_reason: reason.trim(),
  })
  if (error) throw fail(error)
  return z.number().int().parse(data)
}

/** Teacher: ask the admin to correct the marks; author and status come from the database. */
export async function requestCorrection(lessonId: string, marks: Payload, comment: string) {
  const { error } = await supabase
    .from('attendance_correction_requests')
    // teacher_id, author and status are set by attendance_correction_requests_guard
    .insert({ lesson_id: lessonId, marks, comment: comment.trim() })
  if (error) throw fail(error)
}

export async function applyRequest(requestId: string) {
  const { data, error } = await supabase.rpc('apply_correction_request', {
    p_request_id: requestId,
  })
  if (error) throw fail(error)
  return z.number().int().parse(data)
}

export async function rejectRequest(requestId: string, reason: string) {
  const { error } = await supabase.rpc('reject_correction_request', {
    p_request_id: requestId,
    p_reason: reason.trim(),
  })
  if (error) throw fail(error)
}
