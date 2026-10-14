// А10 «Журнал изменений»: one audit_log row → a line a person can read. Pure: (row, lookups) only —
// names come from lookups (current names), everything else from the row's before/after snapshots, so
// a deleted lesson or rate still reads. Every table with the audit trigger (CLAUDE.md invariant 4)
// has its describer here; a table without one falls back to «… запись изменена».
import { firstName, groupLabel, ATTENDANCE_LABEL } from '@/features/students/model'
import { pluralRu } from '@/features/lessons/select'
import { CANCEL_REASON_LABEL, type AttendanceStatus } from '@/features/groups/model'
import { formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import type { GroupType } from '@/features/tariffs/current'

export type AuditAction = 'insert' | 'update' | 'delete'
/** v_audit_feed.kind (0014) — the filter chips. */
export type AuditKind = 'retro' | 'late' | 'payment' | 'attendance' | 'other'
export type Snapshot = Record<string, unknown>

export interface AuditRow {
  id: string
  actorId: string | null
  entity: string
  entityId: string
  action: AuditAction
  before: Snapshot | null
  after: Snapshot | null
  reason: string | null
  at: string
  kind: AuditKind
  /** Statuses of the marks written by the same «Провести» (lesson rows only). */
  marks: string[] | null
}

export interface AuditLookups {
  /** profiles.id → full_name (authors). */
  profiles: Record<string, string>
  students: Record<string, string>
  teachers: Record<string, string>
  groups: Record<string, { name: string; subject: string }>
  lessons: Record<string, { groupId: string; date: string; start: string }>
  enrollments: Record<string, { studentId: string; groupId: string }>
  /** Subscriptions behind payments: enrollment and package. */
  subscriptions: Record<string, { enrollmentId: string; lessons: number; price: number }>
  tariffs: { id: string; groupType: GroupType; validFrom: string; price: number; lessons: number }[]
}

export const EMPTY_LOOKUPS: AuditLookups = {
  profiles: {},
  students: {},
  teachers: {},
  groups: {},
  lessons: {},
  enrollments: {},
  subscriptions: {},
  tariffs: [],
}

export type BadgeTone = 'present' | 'burned' | 'warn' | 'stone' | 'teal' | 'trial'
export type TextTone = 'present' | 'burned' | 'frozen'
/** A piece of the line: plain text, or a name / status shown in bold or colour (as on the artboard). */
export type Part = string | { text: string; strong?: true; tone?: TextTone }

export type AuditLink =
  | { to: '/admin/groups/$groupId'; params: { groupId: string }; label: string }
  | { to: '/admin/students/$studentId'; params: { studentId: string }; label: string }
  | { to: '/admin/users'; label: string }
  | { to: '/admin/settings'; label: string }

export interface AuditEntry {
  id: string
  at: string
  kind: AuditKind
  /** Full name, «Система» for service role / migrations, «Пользователь» if the profile is gone. */
  author: string
  badge: { label: string; tone: BadgeTone }
  parts: Part[]
  /** «Причина: «…»», a cancel comment. */
  note: string | null
  link: AuditLink | null
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<AuditKind, string> = {
  retro: 'Правки задним числом',
  late: 'Поздние подтверждения',
  payment: 'Оплаты',
  attendance: 'Посещаемость',
  other: 'Остальное',
}

/** Tables with the audit trigger, for «Все таблицы ▾». */
export const ENTITY_LABEL: Record<string, string> = {
  lessons: 'Занятия',
  attendance: 'Посещаемость',
  subscriptions: 'Абонементы',
  payments: 'Платежи',
  enrollments: 'Зачисления',
  teacher_rates: 'Ставки учителей',
  tariffs: 'Тарифы',
  subjects: 'Предметы',
  trials: 'Пробные',
  groups: 'Группы',
  attendance_correction_requests: 'Запросы на исправление',
  payroll_adjustments: 'Авансы',
}

const STATUS_TONE: Record<AttendanceStatus, TextTone> = {
  present: 'present',
  absent_frozen: 'frozen',
  absent_burned: 'burned',
}

// ─── Snapshot readers ───────────────────────────────────────────────────────

const str = (s: Snapshot | null, key: string): string | null => {
  const v = s?.[key]
  return typeof v === 'string' ? v : null
}
const num = (s: Snapshot | null, key: string): number | null => {
  const v = s?.[key]
  return typeof v === 'number' ? v : null
}
const bool = (s: Snapshot | null, key: string): boolean | null => {
  const v = s?.[key]
  return typeof v === 'boolean' ? v : null
}
const changed = (row: AuditRow, key: string) =>
  JSON.stringify(row.before?.[key] ?? null) !== JSON.stringify(row.after?.[key] ?? null)
/** The row as it is now (after), or as it was before a delete. */
const current = (row: AuditRow): Snapshot | null => row.after ?? row.before

/** A label from an enum map; an unknown value (a newer enum than the client) is shown as is. */
const labelOf = (labels: Record<string, string>, value: string): string =>
  (labels as Partial<Record<string, string>>)[value] ?? value

const isAttendanceStatus = (v: string | null): v is AttendanceStatus =>
  v === 'present' || v === 'absent_frozen' || v === 'absent_burned'

// ─── Formatting ─────────────────────────────────────────────────────────────

/** '2026-10-10' → «10.10»; another year → «10.10.2025» is not needed for a journal of this year. */
export const dayMonth = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
/** '2026-10-10' → «10.10.2026». */
const fullDate = (iso: string) => `${dayMonth(iso)}.${iso.slice(0, 4)}`
/** '09:00:00' → «09:00». */
const hhmm = (time: string) => time.slice(0, 5)

const BISHKEK_MS = 6 * 60 * 60 * 1000
/** Postgres sends microseconds; older WebKit parses at most milliseconds. */
const parseTs = (ts: string) => Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'))
/** Bishkek wall clock of a timestamptz: «13:40». */
export const bishkekTime = (at: string) =>
  new Date(parseTs(at) + BISHKEK_MS).toISOString().slice(11, 16)
/** Bishkek calendar date of a timestamptz. */
export const bishkekDay = (at: string) =>
  new Date(parseTs(at) + BISHKEK_MS).toISOString().slice(0, 10)

const strong = (text: string): Part => ({ text, strong: true })
const status = (s: string | null): Part =>
  isAttendanceStatus(s) ? { text: ATTENDANCE_LABEL[s], tone: STATUS_TONE[s] } : (s ?? '—')

/** «был 7, заморозка 1, не был 1» — a held lesson's marks. */
export function marksSummary(marks: readonly string[]): string {
  const count = (s: AttendanceStatus) => marks.filter((m) => m === s).length
  return [
    `был ${count('present')}`,
    count('absent_frozen') > 0 ? `заморозка ${count('absent_frozen')}` : null,
    count('absent_burned') > 0 ? `не был ${count('absent_burned')}` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/** Text of the parts, for tests and aria. */
export const entryText = (parts: readonly Part[]) =>
  parts.map((p) => (typeof p === 'string' ? p : p.text)).join('')

// ─── Describers ─────────────────────────────────────────────────────────────

type Described = Pick<AuditEntry, 'badge' | 'parts' | 'link'> & { note?: string | null }

const groupName = (id: string | null, l: AuditLookups) => {
  const g = id ? l.groups[id] : undefined
  return g ? groupLabel(g) : 'группа'
}
const groupLink = (groupId: string | null): AuditLink | null =>
  groupId ? { to: '/admin/groups/$groupId', params: { groupId }, label: 'Группа' } : null
const studentLink = (studentId: string | null): AuditLink | null =>
  studentId ? { to: '/admin/students/$studentId', params: { studentId }, label: 'Ученик' } : null

/** «Математика · 8 класс Б, 10.10 в 09:00». */
function lessonWhere(
  lesson: { groupId: string | null; date: string | null; start: string | null },
  l: AuditLookups,
) {
  const when = [
    lesson.date ? dayMonth(lesson.date) : null,
    lesson.start ? `в ${hhmm(lesson.start)}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return [groupName(lesson.groupId, l), when].filter(Boolean).join(', ')
}

function describeAttendance(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const studentId = str(s, 'student_id')
  const lessonId = str(s, 'lesson_id')
  const lesson = lessonId ? l.lessons[lessonId] : undefined
  const student = strong((studentId && l.students[studentId]) || 'ученик')
  const where = lesson
    ? ` · ${lessonWhere({ groupId: lesson.groupId, date: lesson.date, start: lesson.start }, l)}`
    : ''
  const link = groupLink(lesson?.groupId ?? null)
  const badge = { label: 'Правка', tone: 'burned' as const }
  const before = str(row.before, 'status')
  const after = str(row.after, 'status')

  if (row.action === 'insert') {
    return { badge, link, parts: ['Отметка ', student, ' добавлена: ', status(after), where] }
  }
  if (row.action === 'delete') {
    return {
      badge,
      link,
      parts: ['Отметка ', student, ' удалена (была ', status(before), ')', where],
    }
  }
  if (before !== after && isHumanReason(row.reason)) {
    // correct_attendance / an applied request (#74): the reason is the admin's or the teacher's words
    return {
      badge: { label: 'Исправление', tone: 'burned' },
      link,
      parts: [
        'Отметки занятия',
        lesson ? ` ${lessonWhere(lesson, l)}` : '',
        ' исправлены: ',
        student,
        ' ',
        status(before),
        ' → ',
        status(after),
      ],
    }
  }
  if (before !== after) {
    return {
      badge,
      link,
      parts: ['Отметка ', student, ': ', status(before), ' → ', status(after), where],
    }
  }
  return {
    badge,
    link,
    parts: ['Отметка ', student, ': урок списан с другого абонемента', where],
  }
}

function lateBy(row: AuditRow): string | null {
  const date = str(row.after, 'lesson_date')
  const confirmedAt = str(row.after, 'confirmed_at') ?? row.at
  if (!date) return null
  const days = Math.round((Date.parse(bishkekDay(confirmedAt)) - Date.parse(date)) / 86_400_000)
  if (days <= 0) return null
  return days === 1
    ? 'на следующий день'
    : `через ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}`
}

const teacherName = (id: string | null, l: AuditLookups) => (id && l.teachers[id]) || 'учитель'

function describeLesson(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const groupId = str(s, 'group_id')
  const where = lessonWhere(
    { groupId, date: str(s, 'lesson_date'), start: str(s, 'planned_start') },
    l,
  )
  const link = groupLink(groupId)
  const before = str(row.before, 'status')
  const after = str(row.after, 'status')
  const marks = row.marks ? ` · ${marksSummary(row.marks)}` : ''

  if (row.action === 'insert') {
    return bool(row.after, 'is_extra')
      ? {
          badge: { label: 'Доп. урок', tone: 'teal' },
          link,
          parts: [`Доп. урок ${where} назначен`],
        }
      : {
          badge: { label: 'Занятие', tone: 'stone' },
          link,
          parts: [`Занятие ${where} запланировано`],
        }
  }
  if (row.action === 'delete') {
    return {
      badge:
        before === 'held'
          ? { label: 'Правка', tone: 'burned' }
          : { label: 'Удалено', tone: 'stone' },
      link,
      parts: [`${before === 'held' ? 'Проведённое занятие' : 'Занятие'} ${where} удалено`],
    }
  }
  if (before === 'planned' && after === 'held') {
    const late = bool(row.after, 'confirmed_late')
    if (late) {
      const by = lateBy(row)
      return {
        badge: { label: 'Поздно', tone: 'warn' },
        link,
        parts: [
          `Занятие ${where} подтверждено с опозданием`,
          ...(by ? [' — ', strong(by)] : []),
          marks,
        ],
      }
    }
    return {
      badge: { label: 'Проведено', tone: 'present' },
      link,
      parts: [`Занятие ${where} проведено${marks}`],
    }
  }
  if (after === 'cancelled' && before !== 'cancelled') {
    const reason = str(row.after, 'cancel_reason')
    const comment = str(row.after, 'comment')
    return {
      badge:
        before === 'held'
          ? { label: 'Правка', tone: 'burned' }
          : { label: 'Отмена', tone: 'stone' },
      link,
      parts: [
        `${before === 'held' ? 'Проведённое занятие' : 'Занятие'} ${where} отменено`,
        reason ? `: ${labelOf(CANCEL_REASON_LABEL, reason)}` : '',
      ],
      note: comment ? `Комментарий: «${comment}»` : null,
    }
  }
  if (
    changed(row, 'teacher_id') &&
    !changed(row, 'lesson_date') &&
    !changed(row, 'planned_start')
  ) {
    const day = str(s, 'lesson_date')
    return {
      badge: { label: 'Учитель', tone: 'teal' },
      link,
      parts: [
        `Занятие ${day ? dayMonth(day) : where}: учитель `,
        strong(teacherName(str(row.before, 'teacher_id'), l)),
        ' → ',
        strong(teacherName(str(row.after, 'teacher_id'), l)),
      ],
    }
  }
  if (changed(row, 'lesson_date') || changed(row, 'planned_start')) {
    const from = lessonWhere(
      { groupId, date: str(row.before, 'lesson_date'), start: str(row.before, 'planned_start') },
      l,
    )
    const to = [
      dayMonth(str(row.after, 'lesson_date') ?? ''),
      `в ${hhmm(str(row.after, 'planned_start') ?? '')}`,
    ].join(' ')
    return {
      badge: { label: 'Перенос', tone: 'stone' },
      link,
      parts: [`Занятие ${from} перенесено на ${to}`],
    }
  }
  if (changed(row, 'substitute_teacher_id')) {
    const sub = str(row.after, 'substitute_teacher_id')
    return {
      badge: { label: 'Замена', tone: 'teal' },
      link,
      parts: sub
        ? [`Занятие ${where}: замена — `, strong(l.teachers[sub] ?? 'учитель')]
        : [`Занятие ${where}: замена снята`],
    }
  }
  if (changed(row, 'is_locked') && bool(row.after, 'is_locked')) {
    return {
      badge: { label: 'Период', tone: 'stone' },
      link,
      parts: [`Занятие ${where} закрыто в периоде`],
    }
  }
  if (changed(row, 'comment')) {
    const comment = str(row.after, 'comment')
    return {
      badge: { label: 'Занятие', tone: 'stone' },
      link,
      parts: [
        comment
          ? `Занятие ${where}: комментарий «${comment}»`
          : `Занятие ${where}: комментарий удалён`,
      ],
    }
  }
  return { badge: { label: 'Занятие', tone: 'stone' }, link, parts: [`Занятие ${where} изменено`] }
}

/** « с 18.09 на 01.09» — a date moved (#60). */
function moved(row: AuditRow, key: string): Part[] {
  const was = str(row.before, key)
  const now = str(row.after, key)
  return [` с ${was ? dayMonth(was) : '—'} на `, strong(now ? dayMonth(now) : '—')]
}

/** A reason typed by a person (correct_attendance), not an RPC code. */
const isHumanReason = (r: string | null): boolean => {
  const reason = r?.trim()
  return (
    !!reason && !isServiceReason(reason) && !reason.startsWith('cancel:') && !REASON_LABEL[reason]
  )
}

/** «Учитель просит исправить отметки … / запрос … применён / отклонён» (#74). */
function describeCorrectionRequest(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const lessonId = str(s, 'lesson_id')
  const lesson = lessonId ? l.lessons[lessonId] : undefined
  const where = lesson ? ` ${lessonWhere(lesson, l)}` : ''
  const teacher = strong(teacherName(str(s, 'teacher_id'), l))
  const link = groupLink(lesson?.groupId ?? null)
  if (row.action === 'insert') {
    const marks = Array.isArray(s?.marks) ? (s.marks as unknown[]) : []
    const changes = marks.flatMap((m, i): Part[] => {
      const mark = m && typeof m === 'object' ? (m as Snapshot) : null
      const studentId = str(mark, 'student_id')
      return [
        i > 0 ? '; ' : '',
        strong((studentId && l.students[studentId]) || 'ученик'),
        ' → ',
        status(str(mark, 'status')),
      ]
    })
    const comment = str(s, 'comment')
    return {
      badge: { label: 'Запрос', tone: 'warn' },
      link,
      parts: [teacher, ' просит исправить отметки занятия', where, ': ', ...changes],
      note: comment ? `Комментарий: «${comment}»` : null,
    }
  }
  const decision = str(row.after, 'status')
  const rejected = decision === 'rejected'
  const reason = str(row.after, 'decision_comment')
  return {
    badge: rejected ? { label: 'Отклонено', tone: 'stone' } : { label: 'Запрос', tone: 'present' },
    link,
    parts: [
      'запрос ',
      teacher,
      ' на исправление отметок занятия',
      where,
      rejected
        ? ' отклонён'
        : decision === 'approved'
          ? ' применён'
          : ` — ${ACTION_TEXT[row.action]}`,
    ],
    note: rejected && reason ? `Причина: «${reason}»` : null,
  }
}

const TEACHER_REASON = 'change_group_teacher:'
/** Service reasons of the undo RPCs (0020) are not a human «Причина». */
const isServiceReason = (r: string) =>
  r === 'confirm_lesson' ||
  r === 'remove_enrollment' ||
  r === 'transfer_enrollment' ||
  r === 'delete_group' ||
  r.startsWith(TEACHER_REASON)

/** groups are audited on start_date / teacher_id update and on delete (0017, 0020): «старт группы перенесён с 18.09 на 01.09». */
function describeGroup(row: AuditRow, l: AuditLookups): Described {
  const name = l.groups[row.entityId]
    ? groupName(row.entityId, l)
    : (str(current(row), 'name') ?? 'Группа')
  const link = groupLink(row.entityId)
  if (row.action === 'update' && changed(row, 'start_date')) {
    return {
      badge: { label: 'Группа', tone: 'teal' },
      link,
      parts: [strong(name), ' — старт группы перенесён', ...moved(row, 'start_date')],
    }
  }
  if (row.action === 'update' && changed(row, 'teacher_id')) {
    // reason «change_group_teacher:YYYY-MM-DD» carries the date the lessons moved from (#73)
    const from = row.reason?.startsWith(TEACHER_REASON)
      ? row.reason.slice(TEACHER_REASON.length)
      : ''
    return {
      badge: { label: 'Учитель', tone: 'teal' },
      link,
      parts: [
        'учитель группы ',
        strong(name),
        ' сменён с ',
        strong(teacherName(str(row.before, 'teacher_id'), l)),
        ' на ',
        strong(teacherName(str(row.after, 'teacher_id'), l)),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(from) ? [` с ${dayMonth(from)}`] : []),
      ],
    }
  }
  if (row.action === 'delete') {
    return {
      badge: { label: 'Удалено', tone: 'stone' },
      link: null,
      parts: ['группа ', strong(name), ' удалена'],
    }
  }
  return {
    badge: { label: 'Группа', tone: 'stone' },
    link,
    parts: [strong(name), ` — ${ACTION_TEXT[row.action]}`],
  }
}

function enrollmentOf(s: Snapshot | null, l: AuditLookups) {
  const id = str(s, 'enrollment_id')
  return id ? l.enrollments[id] : undefined
}

/** «Камила Орозова · Математика · 8 класс А — ». */
function whoIn(studentId: string | null, groupId: string | null, l: AuditLookups): Part[] {
  const student = (studentId && l.students[studentId]) || 'Ученик'
  return [strong(student), groupId ? ` · ${groupName(groupId, l)} — ` : ' — ']
}

function describeSubscription(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const e = enrollmentOf(s, l)
  const who = whoIn(e?.studentId ?? null, e?.groupId ?? null, l)
  const link = studentLink(e?.studentId ?? null)
  const lessons = num(s, 'lessons_total') ?? 0
  const price = num(s, 'price_final') ?? 0
  const package_ = `${lessons} ${pluralRu(lessons, ['урок', 'урока', 'уроков'])}`

  if (row.action === 'insert') {
    const discount = num(row.after, 'discount_percent') ?? 0
    return {
      badge: { label: 'Оплата', tone: 'present' },
      link,
      parts: [
        ...who,
        `новый абонемент ${package_}, `,
        strong(`${formatSom(price)} сом`),
        discount > 0 ? ` (скидка ${discount} %)` : '',
      ],
    }
  }
  if (row.action === 'delete') {
    return {
      badge: { label: 'Абонемент', tone: 'stone' },
      link,
      parts: [...who, `абонемент ${package_} удалён`],
    }
  }
  if (changed(row, 'started_at') && !changed(row, 'status')) {
    return {
      badge: { label: 'Абонемент', tone: 'stone' },
      link,
      parts: [...who, `начало абонемента ${package_} перенесено`, ...moved(row, 'started_at')],
    }
  }
  const after = str(row.after, 'status')
  if (changed(row, 'status') && after === 'refunded') {
    return {
      badge: { label: 'Возврат', tone: 'burned' },
      link,
      parts: [...who, `возврат абонемента ${package_} (`, strong(`${formatSom(price)} сом`), ')'],
    }
  }
  if (changed(row, 'status') && after === 'exhausted') {
    return {
      badge: { label: 'Абонемент', tone: 'stone' },
      link,
      parts: [...who, `абонемент ${package_} израсходован`],
    }
  }
  if (changed(row, 'status') && after === 'active') {
    return {
      badge: { label: 'Абонемент', tone: 'stone' },
      link,
      parts: [...who, `абонемент ${package_} снова активен`],
    }
  }
  return {
    badge: { label: 'Абонемент', tone: 'stone' },
    link,
    parts: [...who, `абонемент ${package_} изменён`],
  }
}

const METHOD: Record<string, string> = { cash: 'наличные', mbank: 'Mbank' }

/** «Нурлан Асанов · Математика · 8 класс А — оплата 1 600 сом (Mbank), абонемент 12 уроков». */
function describePayment(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const sub = l.subscriptions[str(s, 'subscription_id') ?? '']
  const e = sub ? l.enrollments[sub.enrollmentId] : undefined
  const who = whoIn(e?.studentId ?? null, e?.groupId ?? null, l)
  const link = studentLink(e?.studentId ?? null)
  const amount = num(s, 'amount') ?? 0
  const method = METHOD[str(s, 'method') ?? ''] ?? ''
  const refund = str(s, 'kind') === 'refund'
  const package_ = sub
    ? `, абонемент ${sub.lessons} ${pluralRu(sub.lessons, ['урок', 'урока', 'уроков'])}`
    : ''
  const money = strong(`${formatSom(Math.abs(amount))} сом`)
  const comment = str(s, 'reason')

  if (row.action === 'delete') {
    return {
      badge: { label: 'Платёж', tone: 'stone' },
      link,
      parts: [...who, refund ? 'возврат ' : 'платёж ', money, ` (${method}) удалён`],
    }
  }
  if (row.action === 'update') {
    return {
      badge: { label: 'Платёж', tone: 'stone' },
      link,
      parts: [...who, refund ? 'возврат ' : 'платёж ', money, ` (${method}) изменён`],
    }
  }
  return refund
    ? {
        badge: { label: 'Возврат', tone: 'burned' },
        link,
        parts: [...who, 'возврат ', money, ` (${method})${package_}`],
        note: comment ? `Причина: «${comment}»` : null,
      }
    : {
        badge: { label: 'Оплата', tone: 'present' },
        link,
        parts: [...who, 'оплата ', money, ` (${method})${package_}`],
        note:
          [
            sub && amount < sub.price ? `частично, из ${formatSom(sub.price)} сом` : null,
            comment ? `«${comment}»` : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
      }
}

function describeEnrollment(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const studentId = str(s, 'student_id')
  const group = groupName(str(s, 'group_id'), l)
  const who: Part[] = [strong((studentId && l.students[studentId]) || 'Ученик'), ' — ']
  const link = studentLink(studentId)
  const badge = { label: 'Зачисление', tone: 'teal' as const }

  if (row.action === 'insert') {
    const from = str(row.after, 'start_date')
    return {
      badge,
      link,
      parts: [...who, `зачисление в ${group}${from ? ` с ${fullDate(from)}` : ''}`],
    }
  }
  if (row.action === 'delete') {
    return {
      badge: { label: 'Зачисление', tone: 'stone' },
      link,
      parts: [
        ...who,
        `зачисление в ${group} удалено`,
        row.reason === 'remove_enrollment' ? ' (ошибочное)' : '',
      ],
    }
  }
  if (changed(row, 'group_id')) {
    return {
      badge,
      link,
      parts: [
        ...who,
        'переведён(а) из ',
        strong(groupName(str(row.before, 'group_id'), l)),
        ' в ',
        strong(group),
      ],
    }
  }
  if (changed(row, 'start_date')) {
    return {
      badge,
      link,
      parts: [...who, `зачисление в ${group} перенесено`, ...moved(row, 'start_date')],
    }
  }
  if (changed(row, 'status') && str(row.after, 'status') === 'finished') {
    const until = str(row.after, 'end_date')
    return {
      badge: { label: 'Выбыл', tone: 'stone' },
      link,
      parts: [...who, `зачисление в ${group} закрыто${until ? ` с ${fullDate(until)}` : ''}`],
    }
  }
  return {
    badge: { label: 'Зачисление', tone: 'stone' },
    link,
    parts: [...who, `зачисление в ${group} изменено`],
  }
}

function describeRate(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const teacherId = str(s, 'teacher_id')
  const who: Part[] = [strong((teacherId && l.teachers[teacherId]) || 'Учитель'), ' — ']
  const link: AuditLink = { to: '/admin/users', label: 'Учителя' }
  const from = str(s, 'valid_from')
  const since = from ? ` с ${fullDate(from)}` : ''
  const badge =
    row.kind === 'retro'
      ? { label: 'Правка', tone: 'burned' as const }
      : { label: 'Ставка', tone: 'teal' as const }

  if (row.action === 'insert') {
    // a past valid_from re-prices lessons already held (#52)
    const retro = row.kind === 'retro' ? ' — задним числом' : ''
    return { badge, link, parts: [...who, `ставка ${num(row.after, 'percent')} %${since}${retro}`] }
  }
  if (row.action === 'delete') {
    return {
      badge,
      link,
      parts: [...who, `ставка ${num(row.before, 'percent')} %${since} удалена`],
    }
  }
  if (changed(row, 'valid_from')) {
    const was = str(row.before, 'valid_from')
    return {
      badge,
      link,
      parts: [
        ...who,
        `ставка ${num(row.after, 'percent')} %: с ${was ? fullDate(was) : '—'} → ${since.trim()}`,
      ],
    }
  }
  return {
    badge,
    link,
    parts: [
      ...who,
      `ставка${since}: ${num(row.before, 'percent')} % → ${num(row.after, 'percent')} %`,
    ],
  }
}

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

/** «Гульзат Асанова — аванс 5 000 сом от 18.09.2026 в счёт ЗП за сентябрь» (#83). */
function describeAdjustment(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const teacherId = str(s, 'teacher_id')
  const who: Part[] = [strong((teacherId && l.teachers[teacherId]) || 'Учитель'), ' — ']
  const kind = str(s, 'kind')
  const label = kind === 'bonus' ? 'премия' : kind === 'correction' ? 'исправление' : 'аванс'
  const issued = str(s, 'issued_on')
  const month = str(s, 'month')
  const forMonth = month ? ` в счёт ЗП за ${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? ''}` : ''
  const parts: Part[] = [
    ...who,
    `${label} `,
    strong(`${formatSom(num(s, 'amount') ?? 0)} сом`),
    issued ? ` от ${fullDate(issued)}` : '',
    forMonth,
    row.action === 'delete' ? ' — удалён' : row.action === 'update' ? ' — изменён' : '',
  ]
  const comment = str(s, 'comment')
  return {
    badge:
      row.action === 'delete'
        ? { label: 'Аванс', tone: 'stone' }
        : { label: 'Аванс', tone: 'warn' },
    link: null,
    parts,
    note: comment ? `«${comment}»` : null,
  }
}

function describeTariff(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const type = str(s, 'group_type')
  const label = `Тариф «${type ? labelOf(GROUP_TYPE_LABEL, type) : '—'}»`
  const from = str(s, 'valid_from') ?? ''
  const price = num(s, 'package_price') ?? 0
  const lessons = num(s, 'lessons_in_package') ?? 0
  const badge = { label: 'Тариф', tone: 'teal' as const }
  const link: AuditLink = { to: '/admin/settings', label: 'Тарифы' }
  const package_ = `${lessons} ${pluralRu(lessons, ['урок', 'урока', 'уроков'])}`

  if (row.action === 'delete') {
    return {
      badge: { label: 'Тариф', tone: 'stone' },
      link,
      parts: [`${label} с ${fullDate(from)} отменён`],
    }
  }
  if (row.action === 'update') {
    const was = num(row.before, 'package_price') ?? 0
    return {
      badge,
      link,
      parts: [
        `${label} с ${fullDate(from)}: ${formatSom(was)} → `,
        strong(`${formatSom(price)} сом`),
      ],
    }
  }
  // the version in effect before this one: «3 000 → 3 200 с 01.11.2026»
  const prev = l.tariffs
    .filter((t) => t.groupType === type && t.validFrom < from && t.id !== row.entityId)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
  if (!prev) {
    return {
      badge,
      link,
      parts: [
        `${label}: `,
        strong(`${formatSom(price)} сом`),
        ` за ${package_} с ${fullDate(from)}`,
      ],
    }
  }
  return {
    badge,
    link,
    parts: [
      `${label}: ${formatSom(prev.price)} → `,
      strong(`${formatSom(price)} сом`),
      prev.lessons !== lessons ? ` за ${package_}` : '',
      ` с ${fullDate(from)}`,
    ],
  }
}

function describeSubject(row: AuditRow): Described {
  const name = str(current(row), 'name') ?? '—'
  const badge = { label: 'Предмет', tone: 'stone' as const }
  const link: AuditLink = { to: '/admin/settings', label: 'Предметы' }
  if (row.action === 'insert') return { badge, link, parts: ['Предмет добавлен: ', strong(name)] }
  if (row.action === 'delete') return { badge, link, parts: ['Предмет удалён: ', strong(name)] }
  if (changed(row, 'name')) {
    return { badge, link, parts: [`Предмет: ${str(row.before, 'name') ?? '—'} → `, strong(name)] }
  }
  if (changed(row, 'is_active')) {
    return {
      badge,
      link,
      parts: [bool(row.after, 'is_active') ? 'Предмет показан: ' : 'Предмет скрыт: ', strong(name)],
    }
  }
  return { badge, link, parts: ['Предмет ', strong(name), ': порядок в списке изменён'] }
}

function describeTrial(row: AuditRow, l: AuditLookups): Described {
  const s = current(row)
  const lessonId = str(s, 'lesson_id')
  const lesson = lessonId ? l.lessons[lessonId] : undefined
  const groupId = str(s, 'group_id')
  const where = lessonWhere(
    { groupId, date: lesson?.date ?? null, start: lesson?.start ?? null },
    l,
  )
  const who: Part[] = [strong(str(s, 'full_name') ?? 'Пробный'), ' — ']
  const badge = { label: 'Пробное', tone: 'trial' as const }
  const link = groupLink(groupId)

  if (row.action === 'insert') {
    // #54: booked after the fact («Уже был(а)») — the mark comes with the booking
    const mark = str(row.after, 'status')
    if (mark === 'attended' || mark === 'no_show') {
      return {
        badge,
        link,
        parts: [
          ...who,
          `записан(а) задним числом: ${where} — `,
          mark === 'attended'
            ? { text: 'был(а)', tone: 'present' }
            : { text: 'не пришёл(ла)', tone: 'burned' },
        ],
      }
    }
    return { badge, link, parts: [...who, `записан(а) на пробное: ${where}`] }
  }
  if (row.action === 'delete') return { badge, link, parts: [...who, 'пробное удалено'] }
  if (changed(row, 'status')) {
    const next = str(row.after, 'status')
    if (next === 'attended') {
      return { badge, link, parts: [...who, 'на пробном: ', { text: 'был(а)', tone: 'present' }] }
    }
    if (next === 'no_show') {
      return {
        badge,
        link,
        parts: [...who, 'на пробном: ', { text: 'не пришёл(ла)', tone: 'burned' }],
      }
    }
    if (next === 'enrolled') {
      return {
        badge: { label: 'Пробное', tone: 'present' },
        link: studentLink(str(row.after, 'student_id')) ?? link,
        parts: [...who, `оплатил(а) после пробного, зачислен(а) в ${groupName(groupId, l)}`],
      }
    }
    if (next === 'closed') {
      return {
        badge: { label: 'Пробное', tone: 'stone' },
        link,
        parts: [...who, bool(row.after, 'came') ? 'отказ после пробного' : 'пробное закрыто'],
      }
    }
    if (next === 'scheduled') return { badge, link, parts: [...who, `записан(а) заново: ${where}`] }
  }
  if (changed(row, 'lesson_id'))
    return { badge, link, parts: [...who, `пробное перенесено: ${where}`] }
  return { badge, link, parts: [...who, 'пробное изменено'] }
}

const ACTION_TEXT: Record<AuditAction, string> = {
  insert: 'запись добавлена',
  update: 'запись изменена',
  delete: 'запись удалена',
}

function describeOther(row: AuditRow): Described {
  return {
    badge: { label: 'Изменение', tone: 'stone' },
    link: null,
    parts: [`${ENTITY_LABEL[row.entity] ?? row.entity}: ${ACTION_TEXT[row.action]}`],
  }
}

const DESCRIBERS: Record<string, (row: AuditRow, l: AuditLookups) => Described> = {
  attendance: describeAttendance,
  lessons: describeLesson,
  subscriptions: describeSubscription,
  payments: describePayment,
  enrollments: describeEnrollment,
  teacher_rates: describeRate,
  tariffs: describeTariff,
  subjects: describeSubject,
  trials: describeTrial,
  groups: describeGroup,
  attendance_correction_requests: describeCorrectionRequest,
  payroll_adjustments: describeAdjustment,
}

/** The author's name: «Система» — service role, migrations, imports (no auth.uid()). */
export function authorName(actorId: string | null, l: AuditLookups): string {
  if (!actorId) return 'Система'
  return l.profiles[actorId] ?? 'Пользователь'
}

export const authorShort = (author: string) =>
  author === 'Система' || author === 'Пользователь' ? author : firstName(author)

/** audit_log.reason written by an RPC (iqup.audit_reason) as words, not codes. */
const REASON_LABEL: Record<string, string> = {
  archive_group: 'группа переведена в архив',
}

/**
 * «Причина: …» under a row. confirm_lesson — none (the row says «проведено»); cancel_lesson writes the
 * admin's comment or `cancel: <code>` (0008) — the code becomes words, and on the lesson's own row
 * neither repeats what its text / «Комментарий» already says.
 */
function reasonNote(row: AuditRow, note: string | null): string | null {
  const reason = row.reason?.trim()
  if (!reason || reason === 'confirm_lesson' || isServiceReason(reason)) return null
  const cancel = /^cancel:\s*(\S+)$/.exec(reason)
  if (cancel) {
    if (row.entity === 'lessons') return null
    return `Причина: занятие отменено — ${labelOf(CANCEL_REASON_LABEL, cancel[1] ?? '')}`
  }
  const label = REASON_LABEL[reason]
  if (label) return `Причина: ${label}`
  if (note?.includes(`«${reason}»`)) return null
  return `Причина: «${reason}»`
}

export function describeAuditRow(row: AuditRow, lookups: AuditLookups): AuditEntry {
  const d = (DESCRIBERS[row.entity] ?? describeOther)(row, lookups)
  const reason = reasonNote(row, d.note ?? null)
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    author: authorName(row.actorId, lookups),
    badge: d.badge,
    parts: d.parts.filter((p) => p !== ''),
    note: [reason, d.note ?? null].filter(Boolean).join(' · ') || null,
    link: d.link,
  }
}
