// #84 · attendance_presets (0023): staff read all, the lesson's teacher reads own; writes — admin RPCs.
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { addDays } from '@/features/groups/model'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import { presetErrorReason } from './model'

const POLL_MS = 60_000

export const PRESETS_KEY = 'attendance-presets'

export class PresetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresetError'
  }
}

const fail = (error: { code?: string; message?: string }) =>
  new PresetError(presetErrorReason(error))

/** «Предупредил о пропуске»: sets (or re-comments) the preset of one student on one lesson. */
export async function setPreset(lessonId: string, studentId: string, comment: string) {
  const { error } = await supabase.rpc('set_attendance_preset', {
    p_lesson_id: lessonId,
    p_student_id: studentId,
    p_comment: comment.trim() || undefined,
  })
  if (error) throw fail(error)
}

/** «Снять»: false — there was nothing to remove. */
export async function clearPreset(lessonId: string, studentId: string) {
  const { data, error } = await supabase.rpc('clear_attendance_preset', {
    p_lesson_id: lessonId,
    p_student_id: studentId,
  })
  if (error) throw fail(error)
  return z.boolean().parse(data)
}

const lessonSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  status: z.enum(['planned', 'held', 'cancelled']),
  group: z.object({ id: z.uuid(), name: z.string(), subject: subjectName }),
})

export interface PresetLesson {
  id: string
  lesson_date: string
  planned_start: string
  group: { id: string; name: string; subject: string }
}

export interface PresetRow {
  id: string
  studentId: string
  studentName: string
  comment: string | null
  lesson: PresetLesson
}

const toLesson = (l: z.infer<typeof lessonSchema>): PresetLesson => ({
  id: l.id,
  lesson_date: l.lesson_date,
  planned_start: l.planned_start,
  group: l.group,
})

const LESSON_FIELDS =
  'id, lesson_date, planned_start, status, group:groups!inner(id, name, subject:subjects(name))'

const presetSchema = z.object({
  id: z.uuid(),
  student_id: z.uuid(),
  comment: z.string().nullable(),
  student: z.object({ full_name: z.string() }),
  lesson: lessonSchema,
})

function toRow(r: z.infer<typeof presetSchema>): PresetRow | null {
  if (r.lesson.status !== 'planned') return null
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student.full_name,
    comment: r.comment,
    lesson: toLesson(r.lesson),
  }
}

const byLesson = (a: PresetRow, b: PresetRow) =>
  a.lesson.lesson_date.localeCompare(b.lesson.lesson_date) ||
  a.lesson.planned_start.localeCompare(b.lesson.planned_start) ||
  a.studentName.localeCompare(b.studentName, 'ru')

const PRESET_FIELDS = `id, student_id, comment, student:students!inner(full_name), lesson:lessons!inner(${LESSON_FIELDS})`

/** Presets of planned lessons from `from` to `to` (dates inclusive) — the dashboard list. */
export const presetsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: [PRESETS_KEY, 'range', from, to],
    queryFn: async (): Promise<PresetRow[]> => {
      const { data, error } = await supabase
        .from('attendance_presets')
        .select(PRESET_FIELDS)
        .gte('lesson.lesson_date', from)
        .lte('lesson.lesson_date', to)
      if (error) throw error
      return z
        .array(presetSchema)
        .parse(data)
        .flatMap((r) => toRow(r) ?? [])
        .sort(byLesson)
    },
    refetchInterval: POLL_MS,
  })

/** One student's presets of planned lessons from `today` on — the student card. */
export const studentPresetsQuery = (studentId: string, today: string) =>
  queryOptions({
    queryKey: [PRESETS_KEY, 'student', studentId, today],
    queryFn: async (): Promise<PresetRow[]> => {
      const { data, error } = await supabase
        .from('attendance_presets')
        .select(PRESET_FIELDS)
        .eq('student_id', studentId)
        .gte('lesson.lesson_date', today)
      if (error) throw error
      return z
        .array(presetSchema)
        .parse(data)
        .flatMap((r) => toRow(r) ?? [])
        .sort(byLesson)
    },
    refetchInterval: POLL_MS,
  })

/** How far ahead «Предупредил о пропуске» on the student card offers lessons. */
export const PRESET_DAYS_AHEAD = 30

/** Planned lessons of the groups from today on — the lesson picker of the student card. */
export const upcomingLessonsQuery = (groupIds: readonly string[], today: string) =>
  queryOptions({
    queryKey: [PRESETS_KEY, 'lessons', [...groupIds].sort().join(','), today],
    queryFn: async (): Promise<PresetLesson[]> => {
      if (groupIds.length === 0) return []
      const { data, error } = await supabase
        .from('lessons')
        .select(LESSON_FIELDS)
        .in('group_id', groupIds)
        .eq('status', 'planned')
        .eq('is_locked', false)
        .gte('lesson_date', today)
        .lte('lesson_date', addDays(today, PRESET_DAYS_AHEAD))
        .order('lesson_date')
        .order('planned_start')
      if (error) throw error
      return z.array(lessonSchema).parse(data).map(toLesson)
    },
  })

/**
 * A preset set or removed elsewhere (the admin on another device, the teacher's open sheet) →
 * refetch the presets and the lesson sheets. RLS applies to the events.
 */
export function usePresetsRealtime(enabled = true) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const channel = supabase
      .channel(`presets:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_presets' }, () => {
        void queryClient.invalidateQueries({ queryKey: [PRESETS_KEY] })
        void queryClient.invalidateQueries({ queryKey: ['lesson'] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, enabled])
}
