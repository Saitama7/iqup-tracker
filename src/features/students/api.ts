// А5 / А6 data: straight to Postgres. RLS — admin writes, staff read all, a teacher reads only
// students of own groups (0001). Enrollment goes through the RPC in features/subscriptions/api.ts.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { normalizePhone } from '@/lib/phone'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import type { StudentsSource } from './model'

const subscriptionSchema = z.object({
  id: z.uuid(),
  lessons_total: z.number().int(),
  price_full: z.number().int(),
  price_final: z.number().int(),
  discount_percent: z.number().int(),
  discount_reason: z.enum(['none', 'returning', 'referral']),
  started_at: z.string(),
  status: z.enum(['active', 'exhausted', 'refunded']),
  created_at: z.string(),
})

const enrollmentSchema = z.object({
  id: z.uuid(),
  group_id: z.uuid(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  status: z.enum(['active', 'finished']),
  subscriptions: z.array(subscriptionSchema),
})

const studentSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  grade: z.number().int().nullable(),
  parent_name: z.string().nullable(),
  parent_phone: z.string().nullable(),
  is_returning: z.boolean(),
  referred_by_student_id: z.uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  enrollments: z.array(enrollmentSchema),
})

const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: subjectName,
  group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
  status: z.enum(['forming', 'active', 'archived']),
  start_date: z.string(),
  end_date: z.string().nullable(),
  teacher: z.object({ full_name: z.string() }).nullable(),
  schedule_rules: z.array(
    z.object({
      weekday: z.number().int(),
      start_time: z.string(),
      valid_from: z.string(),
      valid_to: z.string().nullable(),
    }),
  ),
})

const balanceSchema = z.object({
  subscription_id: z.uuid(),
  lessons_used: z.number().int(),
  lessons_left: z.number().int(),
  freezes_used: z.number().int(),
  freeze_limit: z.number().int(),
})

export const STUDENTS_KEY = ['admin-students'] as const

/** All students with enrollments and subscriptions, groups and balances — ~100 rows, one fetch. */
export const studentsQuery = () =>
  queryOptions({
    queryKey: STUDENTS_KEY,
    queryFn: async (): Promise<StudentsSource> => {
      const [students, groups, balances] = await Promise.all([
        supabase
          .from('students')
          .select(
            'id, full_name, grade, parent_name, parent_phone, is_returning, referred_by_student_id, notes, created_at, enrollments(id, group_id, start_date, end_date, status, subscriptions(id, lessons_total, price_full, price_final, discount_percent, discount_reason, started_at, status, created_at))',
          ),
        supabase
          .from('groups')
          .select(
            'id, name, subject:subjects(name), group_type, status, start_date, end_date, teacher:teachers(full_name), schedule_rules(weekday, start_time, valid_from, valid_to)',
          ),
        supabase
          .from('v_subscription_balances')
          .select('subscription_id, lessons_used, lessons_left, freezes_used, freeze_limit'),
      ])
      if (students.error) throw students.error
      if (groups.error) throw groups.error
      if (balances.error) throw balances.error
      return {
        students: z.array(studentSchema).parse(students.data),
        groups: z.array(groupSchema).parse(groups.data),
        balances: z.array(balanceSchema).parse(balances.data),
      }
    },
  })

// ─── Attendance of one student (А6) ─────────────────────────────────────────

const attendanceSchema = z.object({
  id: z.uuid(),
  status: z.enum(['present', 'absent_frozen', 'absent_burned']),
  consumes_credit: z.boolean(),
  marked_at: z.string(),
  marked_by: z.uuid().nullable(),
  subscription_id: z.uuid().nullable(),
  lesson: z.object({
    lesson_date: z.string(),
    planned_start: z.string(),
    group_id: z.uuid(),
  }),
})

export type AttendanceRecord = z.infer<typeof attendanceSchema> & { markedByName: string | null }

export const attendanceQuery = (studentId: string) =>
  queryOptions({
    queryKey: ['student-attendance', studentId],
    queryFn: async (): Promise<AttendanceRecord[]> => {
      const res = await supabase
        .from('attendance')
        .select(
          'id, status, consumes_credit, marked_at, marked_by, subscription_id, lesson:lessons(lesson_date, planned_start, group_id)',
        )
        .eq('student_id', studentId)
      if (res.error) throw res.error
      const rows = z.array(attendanceSchema).parse(res.data)

      const ids = [...new Set(rows.flatMap((r) => (r.marked_by ? [r.marked_by] : [])))]
      let names: Record<string, string> = {}
      if (ids.length > 0) {
        const p = await supabase.from('profiles').select('id, full_name').in('id', ids)
        if (p.error) throw p.error
        names = Object.fromEntries(
          z
            .array(z.object({ id: z.uuid(), full_name: z.string() }))
            .parse(p.data)
            .map((x) => [x.id, x.full_name.split(' ')[0] ?? x.full_name]),
        )
      }
      return rows
        .map((r) => ({ ...r, markedByName: r.marked_by ? (names[r.marked_by] ?? null) : null }))
        .sort((a, b) =>
          `${b.lesson.lesson_date} ${b.lesson.planned_start}`.localeCompare(
            `${a.lesson.lesson_date} ${a.lesson.planned_start}`,
          ),
        )
    },
  })

// ─── Form input ─────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Слишком длинный текст')
    .transform((v) => (v === '' ? null : v))

/** «Новый ученик» / «Изменить»: phone as typed in the +996 field (`555 999 000`). */
export const studentForm = z.object({
  fullName: z.string().trim().min(1, 'Введите имя и фамилию').max(200, 'Слишком длинное имя'),
  grade: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1 || n > 11) {
        ctx.addIssue({ code: 'custom', message: 'Класс — от 1 до 11' })
        return z.NEVER
      }
      return n
    }),
  parentName: optionalText(200),
  parentPhone: z.string().transform((v, ctx) => {
    if (v.trim() === '') return null
    try {
      return normalizePhone(v)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Телефон: 9 цифр после +996' })
      return z.NEVER
    }
  }),
  isReturning: z.boolean(),
  referredBy: z
    .string()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.uuid().nullable()),
  notes: optionalText(2000),
})

export type StudentInput = z.output<typeof studentForm>

const toRow = (v: StudentInput) => ({
  full_name: v.fullName,
  grade: v.grade,
  parent_name: v.parentName,
  parent_phone: v.parentPhone,
  is_returning: v.isReturning,
  referred_by_student_id: v.referredBy,
  notes: v.notes,
})

// ─── Writes ─────────────────────────────────────────────────────────────────

export class StudentsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudentsApiError'
  }
}

function fail(error: { code?: string }): never {
  const messages: Record<string, string> = {
    '42501': 'Учеников ведёт администратор',
    '23514': 'Проверьте поля формы',
    '23503': 'Ученик, который привёл, не найден',
  }
  throw new StudentsApiError(
    (error.code && messages[error.code]) ??
      'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.',
  )
}

export async function createStudent(input: StudentInput): Promise<string> {
  const { data, error } = await supabase.from('students').insert(toRow(input)).select('id').single()
  if (error) fail(error)
  return z.object({ id: z.uuid() }).parse(data).id
}

export async function updateStudent(id: string, input: StudentInput): Promise<void> {
  if (input.referredBy === id) throw new StudentsApiError('Ученик не может привести сам себя')
  const { error } = await supabase.from('students').update(toRow(input)).eq('id', id)
  if (error) fail(error)
}
