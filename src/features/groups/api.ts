// А3 / А4 data. Reads go straight to Postgres under RLS (staff read all, a teacher — own groups);
// every write is an admin-only RPC from 0008 — one transaction, rules checked in the database.
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import type { GroupRow, LessonRow, TariffRow, TeacherRow } from './model'

const ruleSchema = z.object({
  weekday: z.number().int(),
  start_time: z.string(),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
})

const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subject_id: z.uuid(),
  subject: subjectName,
  grade: z.number().int().nullable(),
  group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
  status: z.enum(['forming', 'active', 'archived']),
  start_date: z.string(),
  end_date: z.string().nullable(),
  room: z.string().nullable(),
  lesson_duration_min: z.number().int().nullable(),
  teacher_id: z.uuid(),
  teacher: z.object({ full_name: z.string() }).nullable(),
  schedule_rules: z.array(ruleSchema),
  enrollments: z.array(z.object({ status: z.enum(['active', 'finished']) })),
})

const tariffSchema = z.object({
  group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
  valid_from: z.string(),
  lessons_in_package: z.number().int(),
  package_price: z.number().int(),
  max_students: z.number().int(),
  lesson_duration_min: z.number().int(),
})

const teacherSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  rates: z.array(z.object({ percent: z.number(), valid_from: z.string() })),
})

export interface GroupsSource {
  groups: GroupRow[]
  tariffs: TariffRow[]
  teachers: TeacherRow[]
  holidays: string[]
}

export const GROUPS_KEY = ['admin-groups'] as const

/** Groups with rules and head count, tariffs, teachers with rates, holidays — one screen, one fetch. */
export const groupsQuery = () =>
  queryOptions({
    queryKey: GROUPS_KEY,
    queryFn: async (): Promise<GroupsSource> => {
      const [groups, tariffs, teachers, holidays] = await Promise.all([
        supabase
          .from('groups')
          .select(
            'id, name, subject_id, subject:subjects(name), grade, group_type, status, start_date, end_date, room, lesson_duration_min, teacher_id, teacher:teachers(full_name), schedule_rules(weekday, start_time, valid_from, valid_to), enrollments(status)',
          ),
        supabase
          .from('tariffs')
          .select(
            'group_type, valid_from, lessons_in_package, package_price, max_students, lesson_duration_min',
          )
          .order('valid_from'),
        supabase
          .from('teachers')
          .select('id, full_name, rates:teacher_rates(percent, valid_from)')
          .order('full_name'),
        supabase.from('holidays').select('day'),
      ])
      if (groups.error) throw groups.error
      if (tariffs.error) throw tariffs.error
      if (teachers.error) throw teachers.error
      if (holidays.error) throw holidays.error
      return {
        groups: z
          .array(groupSchema)
          .parse(groups.data)
          .map(({ enrollments, ...g }) => ({
            ...g,
            students: enrollments.filter((e) => e.status === 'active').length,
          })),
        tariffs: z.array(tariffSchema).parse(tariffs.data),
        teachers: z.array(teacherSchema).parse(teachers.data),
        holidays: z
          .array(z.object({ day: z.string() }))
          .parse(holidays.data)
          .map((h) => h.day),
      }
    },
  })

const lessonSchema = z.object({
  id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
  duration_min: z.number().int(),
  status: z.enum(['planned', 'held', 'cancelled']),
  cancel_reason: z.enum(['center', 'teacher', 'holiday', 'all_frozen']).nullable(),
  is_extra: z.boolean(),
  makes_up_for_lesson_id: z.uuid().nullable(),
  substitute_teacher_id: z.uuid().nullable(),
  confirmed_at: z.string().nullable(),
  confirmed_late: z.boolean(),
  comment: z.string().nullable(),
  attendance: z.array(z.object({ status: z.enum(['present', 'absent_frozen', 'absent_burned']) })),
})

export const lessonsKey = (groupId: string) => ['group-lessons', groupId] as const

/** All lessons of one group with attendance marks (~40 per term). */
export const lessonsQuery = (groupId: string) =>
  queryOptions({
    queryKey: lessonsKey(groupId),
    queryFn: async (): Promise<LessonRow[]> => {
      const { data, error } = await supabase
        .from('lessons')
        .select(
          'id, lesson_date, planned_start, duration_min, status, cancel_reason, is_extra, makes_up_for_lesson_id, substitute_teacher_id, confirmed_at, confirmed_late, comment, attendance(status)',
        )
        .eq('group_id', groupId)
        .order('lesson_date')
      if (error) throw error
      return z.array(lessonSchema).parse(data)
    },
  })

// ─── Errors ─────────────────────────────────────────────────────────────────

export class GroupsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroupsApiError'
  }
}

/** Postgres error → admin-facing text; each RPC raises one code per rule (0008). */
export function groupsErrorMessage(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (error.code === '42501') {
    if (m.includes('extra lesson')) return 'Доп. урок добавляет учитель этой группы'
    return 'Группы и занятия ведёт администратор'
  }
  if (error.code === '23505') {
    if (m.includes('made up')) return 'Это занятие уже восполнено'
    if (m.includes('groups_active_name_key'))
      return 'Группа с таким названием по этому предмету уже есть'
    return 'В это время у группы уже есть занятие'
  }
  if (error.code === '23514') {
    if (m.includes('closed period')) return 'С этой даты есть занятия в закрытом периоде'
    if (m.includes('after-school group has no lesson duration'))
      return 'У продлёнки нет своей длительности — часы по графику ученика'
    if (m.includes('out of 15')) return 'Длительность — от 15 до 600 минут'
    if (m.includes('on the group start')) return 'На дату старта нет тарифа для этого типа группы'
    if (m.includes('no tariff')) return 'На эту дату нет тарифа для этого типа группы'
    if (m.includes('held or cancelled lessons before'))
      return 'Раньше этой даты есть проведённые или отменённые занятия — старт не перенести позже'
    if (m.includes('enrollments before'))
      return 'Раньше этой даты есть зачисления — сначала измените даты зачисления учеников'
    if (m.includes('trial lessons before')) return 'Раньше этой даты есть записи на пробное'
    if (m.includes('attendance marks before')) return 'Раньше этой даты есть отметки посещаемости'
    if (m.includes('after the group end')) return 'Старт группы позже даты окончания'
    if (m.includes('extra lesson in the past')) return 'Доп. урок — на сегодня или позже'
    if (m.includes('in the past') || m.includes('today or later'))
      return 'Новое расписание — с сегодняшнего дня или позже'
    if (m.includes('outside the group dates')) return 'Дата вне дат группы'
    if (m.includes('archived')) return 'Группа в архиве'
    if (m.includes('only a planned')) return 'Отменить можно только запланированное занятие'
    if (m.includes('makes up a cancelled')) return 'Восполнить можно только отменённое занятие'
    if (m.includes('weekday')) return 'Выберите хотя бы один день недели'
    return 'Проверьте поля формы'
  }
  if (error.code === '23503') return 'Группа или учитель не найдены'
  return 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.'
}

// ─── Form input ─────────────────────────────────────────────────────────────

const timeField = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ')
  .transform((v) => v.padStart(5, '0'))

const dateField = z.string().transform((v, ctx) => {
  const iso = parseDateRu(v)
  if (!iso) {
    ctx.addIssue({ code: 'custom', message: 'Дата в формате ДД.ММ.ГГГГ' })
    return z.NEVER
  }
  return iso
})

/** Lesson length, minutes (#100): 15…600; the form's step is 15. */
const durationField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = Number(v)
    if (v === '' || !Number.isInteger(n) || n < 15 || n > 600) {
      ctx.addIssue({ code: 'custom', message: 'Длительность — от 15 до 600 минут' })
      return z.NEVER
    }
    return n
  })

const weekdaysField = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'Выберите хотя бы один день недели')

/** «Новая группа» (А3). */
export const groupForm = z.object({
  name: z.string().trim().min(1, 'Введите название').max(120, 'Слишком длинное название'),
  subjectId: z.uuid({ error: 'Выберите предмет' }),
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
  groupType: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
  teacherId: z.uuid({ error: 'Выберите учителя' }),
  weekdays: weekdaysField,
  time: timeField,
  /** null — as in the tariff (after-school always). */
  durationMin: durationField.nullable(),
  startDate: dateField,
  room: z
    .string()
    .trim()
    .max(20, 'Слишком длинно')
    .transform((v) => (v === '' ? null : v)),
})

export type GroupInput = z.output<typeof groupForm>

/** «Изменить расписание» (А4): new days and time from a date. */
export const rescheduleForm = z.object({
  weekdays: weekdaysField,
  time: timeField,
  validFrom: dateField,
})

export type RescheduleInput = z.output<typeof rescheduleForm>

/** «Длительность занятий» (А4, #100): new length of the planned lessons from a date. */
export const durationForm = z.object({
  minutes: durationField,
  from: dateField,
})

export type DurationInput = z.output<typeof durationForm>

/** «Доп. урок» (А4): date and time set by the admin, optionally for a cancelled lesson. */
export const extraLessonForm = z.object({
  date: dateField,
  time: timeField,
  makesUpFor: z
    .string()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.uuid().nullable()),
})

export type ExtraLessonInput = z.output<typeof extraLessonForm>

// ─── RPC ────────────────────────────────────────────────────────────────────

const fail = (error: { code?: string; message?: string }): never => {
  throw new GroupsApiError(groupsErrorMessage(error))
}

/** Lessons for every running group up to `until` (А3 on open; later the dashboard). */
export async function ensureLessons(until: string): Promise<number> {
  const { data, error } = await supabase.rpc('ensure_lessons', { p_until: until })
  if (error) fail(error)
  return z.number().int().parse(data)
}

export async function createGroup(input: GroupInput, until: string) {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: input.name,
    p_subject_id: input.subjectId,
    // a group without a class (Продлёнка, ОРТ) is a valid row: the RPC takes null
    p_grade: input.grade as number,
    p_group_type: input.groupType,
    p_teacher_id: input.teacherId,
    p_weekdays: input.weekdays,
    p_start_time: input.time,
    p_start_date: input.startDate,
    p_room: input.room as string,
    p_until: until,
    ...(input.durationMin !== null ? { p_duration_min: input.durationMin } : {}),
  })
  if (error) fail(error)
  const row = z
    .array(z.object({ group_id: z.uuid(), lessons_created: z.number().int() }))
    .parse(data)[0]
  if (!row) throw new GroupsApiError('Не удалось создать группу. Попробуйте ещё раз.')
  return { groupId: row.group_id, lessonsCreated: row.lessons_created }
}

export async function rescheduleGroup(groupId: string, input: RescheduleInput, until: string) {
  const { data, error } = await supabase.rpc('reschedule_group', {
    p_group_id: groupId,
    p_valid_from: input.validFrom,
    p_weekdays: input.weekdays,
    p_start_time: input.time,
    p_until: until,
  })
  if (error) fail(error)
  const row = z
    .array(z.object({ lessons_deleted: z.number().int(), lessons_created: z.number().int() }))
    .parse(data)[0]
  return { deleted: row?.lessons_deleted ?? 0, created: row?.lessons_created ?? 0 }
}

export async function cancelLesson(
  lessonId: string,
  reason: 'center' | 'teacher' | 'all_frozen',
  comment: string,
) {
  const { error } = await supabase.rpc('cancel_lesson', {
    p_lesson_id: lessonId,
    p_reason: reason,
    p_comment: comment.trim(),
  })
  if (error) fail(error)
}

export async function createExtraLesson(groupId: string, input: ExtraLessonInput) {
  const { error } = await supabase.rpc('create_extra_lesson', {
    p_group_id: groupId,
    p_date: input.date,
    p_start: input.time,
    // none — an extra lesson for frozen students (В3), not tied to a cancelled one
    ...(input.makesUpFor ? { p_makes_up_for: input.makesUpFor } : {}),
  })
  if (error) fail(error)
}

/** «Замена учителя» — informational, payroll stays with the group's teacher (А7). */
export async function setSubstitute(lessonId: string, teacherId: string | null) {
  const { error } = await supabase
    .from('lessons')
    .update({ substitute_teacher_id: teacherId })
    .eq('id', lessonId)
  if (error) fail(error)
}

export async function archiveGroup(groupId: string) {
  const { error } = await supabase.rpc('archive_group', { p_group_id: groupId })
  if (error) fail(error)
}

/** forming ↔ active (А4 «Изменить»); archived only via archiveGroup. */
export async function setGroupStatus(groupId: string, status: 'forming' | 'active') {
  const { error } = await supabase.from('groups').update({ status }).eq('id', groupId)
  if (error) fail(error)
}

/**
 * «Старт группы» задним числом (#60): earlier — lessons of the new stretch are generated; later —
 * planned lessons before it are removed (refused if anything was held, cancelled or enrolled).
 */
export async function setGroupStart(groupId: string, startDate: string) {
  const { data, error } = await supabase.rpc('set_group_start', {
    p_group_id: groupId,
    p_start_date: startDate,
  })
  if (error) fail(error)
  const row = z
    .array(z.object({ lessons_created: z.number().int(), lessons_deleted: z.number().int() }))
    .parse(data)[0]
  return { created: row?.lessons_created ?? 0, deleted: row?.lessons_deleted ?? 0 }
}

/**
 * «Длительность занятий» (#100, И88): the group's own length (null — back to the tariff) and the
 * planned lessons from `from`; held and cancelled ones keep theirs. Returns lessons changed.
 */
export async function setGroupDuration(groupId: string, minutes: number | null, from: string) {
  const { data, error } = await supabase.rpc('set_group_duration', {
    p_group_id: groupId,
    // null resets the group to its tariff; the generated Args type says number
    p_minutes: minutes as number,
    p_from: from,
  })
  if (error) fail(error)
  return z.number().int().parse(data)
}
