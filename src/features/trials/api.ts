// Пробные занятия (А11 + sections on У2/У3/УД2/А1/А2/А4) — table trials, 0015. RLS: admin writes,
// a teacher reads own groups' trials and marks them «Был / Не пришёл» (trials_guard), accountant reads.
// A trial never touches attendance / subscriptions / payroll (Ж2, Ж6).
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { subjectName } from '@/features/subjects/api'
import { discountByPct } from '@/features/subscriptions/model'
import { normalizePhone } from '@/lib/phone'
import { supabase } from '@/lib/supabase/client'
import type { TablesInsert } from '@/lib/supabase/types.gen'
import { TRIAL_SOURCES, TRIAL_STATUSES, type Trial } from './model'

export const TRIALS_KEY = 'trials'

const trialSchema = z.object({
  id: z.uuid(),
  student_id: z.uuid().nullable(),
  full_name: z.string(),
  grade: z.number().int().nullable(),
  parent_phone: z.string().nullable(),
  group_id: z.uuid(),
  lesson_id: z.uuid(),
  status: z.enum(TRIAL_STATUSES),
  came: z.boolean().nullable(),
  source: z.enum(TRIAL_SOURCES).nullable(),
  note: z.string().nullable(),
  enrollment_id: z.uuid().nullable(),
  created_at: z.string(),
  marked_at: z.string().nullable(),
  lesson: z.object({
    lesson_date: z.string(),
    planned_start: z.string(),
    status: z.enum(['planned', 'held', 'cancelled']),
  }),
  group: z.object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(['forming', 'active', 'archived']),
    subject: subjectName,
    teacher: z.object({ id: z.uuid(), full_name: z.string() }).nullable(),
  }),
  // RLS: a teacher does not read other profiles → null
  author: z.object({ full_name: z.string() }).nullable(),
})

const TRIAL_FIELDS =
  'id, student_id, full_name, grade, parent_phone, group_id, lesson_id, status, came, source, note, enrollment_id, created_at, marked_at, lesson:lessons!inner(lesson_date, planned_start, status), group:groups!inner(id, name, status, subject:subjects(name), teacher:teachers(id, full_name)), author:profiles!trials_created_by_fkey(full_name)'

function toTrial(row: z.infer<typeof trialSchema>): Trial {
  const { lesson, group, author, ...rest } = row
  return {
    ...rest,
    lessonDate: lesson.lesson_date,
    lessonStart: lesson.planned_start.slice(0, 5),
    lessonStatus: lesson.status,
    group: {
      id: group.id,
      name: group.name,
      subject: group.subject,
      status: group.status,
      teacherId: group.teacher?.id ?? null,
      teacherName: group.teacher?.full_name ?? null,
    },
    authorName: author?.full_name ?? null,
  }
}

export interface TrialsFilter {
  /** Lessons on or after this day (YYYY-MM-DD). */
  from?: string
  /** Lessons on or before this day. */
  to?: string
  lessonId?: string
  groupId?: string
  /** Only trials that wait for a mark or a decision (scheduled / attended / no_show). */
  open?: boolean
}

/**
 * Trials visible to the caller (RLS) — А11 reads all of them (tens a month), teacher screens and
 * А1/А2/А4 narrow by day, lesson or group. Key ['trials', filter]: invalidate ['trials'] after a write.
 */
export const trialsQuery = (filter: TrialsFilter = {}) =>
  queryOptions({
    queryKey: [TRIALS_KEY, filter],
    queryFn: async (): Promise<Trial[]> => {
      let q = supabase.from('trials').select(TRIAL_FIELDS)
      if (filter.from) q = q.gte('lesson.lesson_date', filter.from)
      if (filter.to) q = q.lte('lesson.lesson_date', filter.to)
      if (filter.lessonId) q = q.eq('lesson_id', filter.lessonId)
      if (filter.groupId) q = q.eq('group_id', filter.groupId)
      if (filter.open) q = q.in('status', ['scheduled', 'attended', 'no_show'])
      const { data, error } = await q.order('created_at')
      if (error) throw error
      return z.array(trialSchema).parse(data).map(toTrial)
    },
    refetchInterval: 60_000,
  })

/** Someone booked / marked / decided a trial → refetch every trials query (architecture §7.1). */
export function useTrialsRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel('trials')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trials' }, () => {
        void queryClient.invalidateQueries({ queryKey: [TRIALS_KEY] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class TrialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrialError'
  }
}

/** Postgres error → Russian text; trials_guard / enroll_trial raise one message per rule (0015). */
export function trialErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (m.includes('already enrolled')) return 'Ученик уже зачислен в эту группу'
  if (error.code === '23505') return 'Этот ученик уже записан на это занятие'
  if (m.includes('planned lesson today or later')) return 'Выберите занятие сегодня или позже'
  if (m.includes('not today yet')) return 'Отметить можно в день занятия'
  if (m.includes('was cancelled')) return 'Занятие отменено — перенесите пробное'
  if (m.includes('already decided')) return 'По этому пробному уже принято решение'
  if (m.includes('another lesson')) return 'Выберите другое занятие'
  if (m.includes('starts after the trial lesson'))
    return 'Абонемент начинается после пробного занятия — выберите дату позже'
  if (m.includes('only an attended trial')) return 'Зачислить можно после отметки «был»'
  if (m.includes('archived')) return 'Группа в архиве'
  if (m.includes('outside the group dates')) return 'Дата начала — вне дат группы'
  if (m.includes('no tariff')) return 'На эту дату нет тарифа для группы'
  if (error.code === '42501') return 'Недостаточно прав'
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

const fail = (error: { code?: string; message?: string }): never => {
  throw new TrialError(trialErrorMessage(error))
}

// ─── Form input ─────────────────────────────────────────────────────────────

const personSchema = z.object({
  fullName: z.string().trim().min(1, { error: 'Введите имя ученика' }),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null
      try {
        return normalizePhone(v)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Телефон родителя: 0XXX XXX XXX' })
        return z.NEVER
      }
    }),
})

/** «Записать на пробное» (А11): a lead (or several — «вся группа») or an existing student. */
export const bookForm = z
  .object({
    studentId: z.uuid().nullable(),
    people: z.array(personSchema),
    grade: z.number().int().min(1).max(11).nullable(),
    groupId: z.uuid({ error: 'Выберите группу' }),
    lessonId: z.uuid({ error: 'Выберите занятие' }),
    source: z.enum(TRIAL_SOURCES).nullable(),
    note: z.string().trim(),
  })
  .refine((v) => v.studentId !== null || v.people.length > 0, {
    error: 'Введите имя ученика',
    path: ['people'],
  })
  .refine((v) => v.studentId !== null || v.people.every((p) => p.phone !== null), {
    error: 'Телефон родителя нужен, чтобы позвонить после пробного',
    path: ['people'],
  })

export type BookInput = z.output<typeof bookForm>

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function bookTrials(input: BookInput): Promise<number> {
  const common = {
    lesson_id: input.lessonId,
    group_id: input.groupId, // trials_guard keeps it equal to the lesson's group
    source: input.source,
    note: input.note || null,
  }
  // an existing student: name / class / phone are copied from students by trials_guard
  const rows: TablesInsert<'trials'>[] = input.studentId
    ? [{ ...common, student_id: input.studentId, full_name: '—', grade: input.grade }]
    : input.people.map((p) => ({
        ...common,
        full_name: p.fullName,
        parent_phone: p.phone,
        grade: input.grade,
      }))
  const { error } = await supabase.from('trials').insert(rows)
  if (error) fail(error)
  return rows.length
}

/** Teacher «Был / Не пришёл» (also admin). */
export async function markTrial(id: string, status: 'attended' | 'no_show') {
  const { error } = await supabase.from('trials').update({ status }).eq('id', id)
  if (error) fail(error)
}

/** «Перенести» (scheduled) and «Записать заново» (no_show / not marked) — another lesson. */
export async function rebookTrial(id: string, lessonId: string) {
  const { error } = await supabase
    .from('trials')
    .update({ lesson_id: lessonId, status: 'scheduled' })
    .eq('id', id)
  if (error) fail(error)
}

/** «Отказ» (attended) / «Закрыть» (no_show). */
export async function closeTrial(id: string) {
  const { error } = await supabase.from('trials').update({ status: 'closed' }).eq('id', id)
  if (error) fail(error)
}

export interface EnrollTrialInput {
  trialId: string
  /** YYYY-MM-DD */
  startDate: string
  discount: 0 | 5 | 15
}

/** «Оплатил → зачислить» (Ж5): lead → student, enrollment + subscription, trial → enrolled. */
export async function enrollTrial(input: EnrollTrialInput) {
  const discount = discountByPct(input.discount)
  const { data, error } = await supabase.rpc('enroll_trial', {
    p_trial_id: input.trialId,
    p_start_date: input.startDate,
    p_discount_pct: discount.pct,
    p_discount_reason: discount.reason,
  })
  if (error) fail(error)
  const row = z
    .array(z.object({ enrollment_id: z.uuid(), subscription_id: z.uuid(), student_id: z.uuid() }))
    .parse(data)[0]
  if (!row) throw new TrialError('Не удалось зачислить. Попробуйте ещё раз.')
  return row
}

// ─── Lessons to book on ─────────────────────────────────────────────────────

const lessonOptionSchema = z.object({
  id: z.uuid(),
  group_id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
})

export interface LessonOption {
  id: string
  groupId: string
  date: string
  start: string
}

/** Planned lessons of a group from `from` on («Занятие» select, «Перенести», Ж5 start date). */
export const groupLessonsQuery = (groupId: string | null, from: string, limit = 12) =>
  queryOptions({
    queryKey: [TRIALS_KEY, 'lessons', groupId, from, limit],
    enabled: !!groupId,
    queryFn: async (): Promise<LessonOption[]> => {
      const { data, error } = await supabase
        .from('lessons')
        .select('id, group_id, lesson_date, planned_start')
        .eq('group_id', groupId ?? '')
        .eq('status', 'planned')
        .gte('lesson_date', from)
        .order('lesson_date')
        .order('planned_start')
        .limit(limit)
      if (error) throw error
      return z
        .array(lessonOptionSchema)
        .parse(data)
        .map((l) => ({
          id: l.id,
          groupId: l.group_id,
          date: l.lesson_date,
          start: l.planned_start.slice(0, 5),
        }))
    },
  })
