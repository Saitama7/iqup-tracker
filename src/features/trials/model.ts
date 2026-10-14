// Пробные занятия — pure functions of (trials, today). Docs: 05-decisions Ж1–Ж8, 01-domain-model §5.1.
// A trial is never a student-lesson: it does not count in group fill («8 / 10»), in «Отмечено N из M»
// or in payroll — screens show it next to those numbers as «+1 пробный».
import { addDays, isoWeekday } from '@/features/groups/model'
import type { StudentsSource } from '@/features/students/model'
import type { DiscountHistory } from '@/features/subscriptions/model'
import type { Database } from '@/lib/supabase/types.gen'
import { formatPhone } from '@/lib/phone'

export type TrialStatus = Database['public']['Enums']['trial_status']
export type TrialSource = Database['public']['Enums']['trial_source']

export const TRIAL_STATUSES = [
  'scheduled',
  'attended',
  'no_show',
  'enrolled',
  'closed',
] as const satisfies readonly TrialStatus[]
export const TRIAL_SOURCES = [
  'instagram',
  'referral',
  '2gis',
  'other',
] as const satisfies readonly TrialSource[]

export const SOURCE_LABEL: Record<TrialSource, string> = {
  instagram: 'Instagram',
  referral: 'Привёл друг',
  '2gis': '2ГИС',
  other: 'Другое',
}

export interface Trial {
  id: string
  student_id: string | null
  full_name: string
  grade: number | null
  parent_phone: string | null
  group_id: string
  lesson_id: string
  status: TrialStatus
  /** Teacher's mark kept after the decision: true «был», false «не пришёл», null not marked. */
  came: boolean | null
  source: TrialSource | null
  note: string | null
  enrollment_id: string | null
  created_at: string
  marked_at: string | null
  lessonDate: string
  /** HH:MM */
  lessonStart: string
  lessonStatus: 'planned' | 'held' | 'cancelled'
  group: {
    id: string
    name: string
    subject: string
    status: 'forming' | 'active' | 'archived'
    teacherId: string | null
    teacherName: string | null
  }
  authorName: string | null
}

// ─── Words ──────────────────────────────────────────────────────────────────

function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few
  return many
}

/** «1 пробный», «2 пробных», «5 пробных». */
export const trialsWord = (n: number) => `${n} ${plural(n, 'пробный', 'пробных', 'пробных')}`

/** «4 ученика», «5 учеников». */
export const pupilsWord = (n: number) => `${n} ${plural(n, 'ученик', 'ученика', 'учеников')}`

/** «+1 пробный» next to a count that never includes trials (У2, УД2, А1, А2, А4); '' for none. */
export const plusTrials = (n: number) => (n > 0 ? `+${trialsWord(n)}` : '')

/** «Розаина Бекова» → «Розаина Б.» (artboards: names in tables and chips). */
export function shortPerson(fullName: string): string {
  const [first = fullName.trim(), last] = fullName.trim().split(/\s+/)
  return last ? `${first} ${last[0]}.` : first
}

/** «Математика · 8 класс Б» — group caption is «предмет · название» everywhere (И31). */
export const trialGroupLabel = (g: Pick<Trial['group'], 'subject' | 'name'>) =>
  `${g.subject} · ${g.name}`

export const phoneCaption = (phone: string | null) => (phone ? formatPhone(phone) : '—')

const WEEKDAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]

/** '2026-10-12' → «12 окт». */
export function dayShort(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`
}

/** «Сегодня 14:00» / «Завтра 09:00» / «Вчера 15:00» / «Пн 12 окт 19:00» (А11 «Когда»). */
export function trialWhen(date: string, start: string, today: string): string {
  if (date === today) return `Сегодня ${start}`
  if (date === addDays(today, 1)) return `Завтра ${start}`
  if (date === addDays(today, -1)) return `Вчера ${start}`
  return `${WEEKDAY_SHORT[isoWeekday(date)] ?? ''} ${dayShort(date)} ${start}`
}

/** «Чт 8 окт · 14:00 · сегодня» — options of the «Занятие» select (А11 form). */
export function lessonOptionLabel(date: string, start: string, today: string): string {
  const base = `${WEEKDAY_SHORT[isoWeekday(date)] ?? ''} ${dayShort(date)} · ${start}`
  if (date === today) return `${base} · сегодня`
  if (date === addDays(today, 1)) return `${base} · завтра`
  if (date === addDays(today, -1)) return `${base} · вчера`
  return base
}

// ─── Lists of А11 ───────────────────────────────────────────────────────────

/** Booked and still ahead: scheduled on a lesson today or later that is not cancelled. */
export const isUpcoming = (t: Trial, today: string) =>
  t.status === 'scheduled' && t.lessonDate >= today && t.lessonStatus !== 'cancelled'

/**
 * «Прошли пробное — ждут решения»: the teacher marked (attended → «Оплатил → зачислить / Отказ»;
 * no_show → «Позвонить», Ж8) or the lesson passed / was cancelled without a mark («Перенести»).
 */
export const isWaiting = (t: Trial, today: string) =>
  t.status === 'attended' ||
  t.status === 'no_show' ||
  (t.status === 'scheduled' && (t.lessonDate < today || t.lessonStatus === 'cancelled'))

const byLesson = (a: Trial, b: Trial) =>
  a.lessonDate.localeCompare(b.lessonDate) ||
  a.lessonStart.localeCompare(b.lessonStart) ||
  a.full_name.localeCompare(b.full_name, 'ru')

/** One row of «Предстоящие»: a single trial or a group booking folded to «N учеников» (06-design). */
export interface UpcomingRow {
  lessonId: string
  trials: Trial[]
  /** A forming group that comes entirely on trial — «вся группа», dashed cell on А2. */
  wholeGroup: boolean
}

export function upcomingRows(trials: readonly Trial[], today: string): UpcomingRow[] {
  const rows = new Map<string, Trial[]>()
  for (const t of trials.filter((x) => isUpcoming(x, today)).sort(byLesson)) {
    rows.set(t.lesson_id, [...(rows.get(t.lesson_id) ?? []), t])
  }
  return [...rows.entries()].map(([lessonId, list]) => ({
    lessonId,
    trials: list,
    wholeGroup: list.length > 1 && list[0]?.group.status === 'forming',
  }))
}

export function waitingTrials(trials: readonly Trial[], today: string): Trial[] {
  // newest first: the admin calls the ones who just left
  return trials.filter((t) => isWaiting(t, today)).sort((a, b) => byLesson(b, a))
}

/** What the teacher marked, for «Отметка учителя» (И1: no gendered forms). */
export function markLabel(t: Pick<Trial, 'status' | 'came'>): string {
  if (t.status === 'attended' || (t.status !== 'no_show' && t.came === true)) return 'Был(а)'
  if (t.status === 'no_show' || t.came === false) return 'Не пришёл(ла)'
  return 'Не отмечен'
}

// ─── KPI and conversion ─────────────────────────────────────────────────────

/** Monday of the ISO week of `today`. */
export const weekStart = (today: string) => addDays(today, 1 - isoWeekday(today))

export interface WeekStats {
  trials: number
  groups: number
  wholeGroups: number
}

/** «На этой неделе · 7 пробных · в 5 группах · 1 группа целиком» — booked trials Mon–Sun. */
export function weekStats(trials: readonly Trial[], today: string): WeekStats {
  const from = weekStart(today)
  const to = addDays(from, 6)
  const week = trials.filter(
    (t) =>
      t.lessonDate >= from &&
      t.lessonDate <= to &&
      t.status !== 'closed' &&
      t.lessonStatus !== 'cancelled',
  )
  const perLesson = trialsByLesson(week)
  const whole = new Set(
    [...perLesson.values()]
      .filter((list) => list.length > 1 && list[0]?.group.status === 'forming')
      .map((list) => list[0]?.group_id),
  )
  return {
    trials: week.length,
    groups: new Set(week.map((t) => t.group_id)).size,
    wholeGroups: whole.size,
  }
}

export interface Conversion {
  /** Booked on a lesson of the month (not cancelled by the admin before the lesson). */
  booked: number
  /** The teacher marked «был». */
  came: number
  /** «Оплатил → зачислить». */
  paid: number
  /** paid / came, whole percent; null with nobody came. */
  percent: number | null
}

const conversionOf = (list: readonly Trial[]): Conversion => {
  const came = list.filter((t) => t.came === true).length
  const paid = list.filter((t) => t.status === 'enrolled').length
  return {
    booked: list.length,
    came,
    paid,
    percent: came > 0 ? Math.round((paid / came) * 100) : null,
  }
}

/** А11 «Конверсия за месяц»: записались → пришли → оплатили by the month of the trial lesson. */
export function monthConversion(trials: readonly Trial[], month: string): Conversion {
  return conversionOf(trials.filter((t) => t.lessonDate.slice(0, 7) === month.slice(0, 7)))
}

/** Same funnel per source («Откуда узнали», §5.1 report); sources without trials are skipped. */
export function conversionBySource(
  trials: readonly Trial[],
  month: string,
): { source: TrialSource | null; conversion: Conversion }[] {
  const inMonth = trials.filter((t) => t.lessonDate.slice(0, 7) === month.slice(0, 7))
  return ([...TRIAL_SOURCES, null] as const)
    .map((source) => ({
      source,
      conversion: conversionOf(inMonth.filter((t) => t.source === source)),
    }))
    .filter((r) => r.conversion.booked > 0)
}

// ─── Teacher and group screens ──────────────────────────────────────────────

/** Trials of one lesson the teacher sees on У3 / УД2 (scheduled or already marked). */
export function lessonTrials(trials: readonly Trial[], lessonId: string): Trial[] {
  return trials
    .filter((t) => t.lesson_id === lessonId && t.status !== 'closed')
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))
}

/** Count per lesson for «+1 пробный» on cards (У2, А1, А2). */
export function trialsByLesson(trials: readonly Trial[]): Map<string, Trial[]> {
  const map = new Map<string, Trial[]>()
  for (const t of trials) {
    if (t.status === 'closed') continue
    map.set(t.lesson_id, [...(map.get(t.lesson_id) ?? []), t])
  }
  return map
}

/** «+1 пробный · Розаина» (У2 card, А2 cell): first names after the count. */
export function trialsCaption(list: readonly Trial[]): string {
  if (list.length === 0) return ''
  const names = list.map((t) => t.full_name.trim().split(/\s+/)[0] ?? t.full_name)
  return list.length === 1 ? `${plusTrials(1)} · ${names[0] ?? ''}` : plusTrials(list.length)
}

/** Trials of a day (А1 widget «Пробные сегодня/завтра», У2 «Завтра пробные»). */
export function trialsOn(trials: readonly Trial[], day: string): Trial[] {
  return trials
    .filter((t) => t.lessonDate === day && t.status !== 'closed' && t.lessonStatus !== 'cancelled')
    .sort(byLesson)
}

/** Group fill on А4 / У4: «8 / 10» never includes trials; trials go next to it. */
export function fillCaption(enrolled: number, max: number | null, trials: number) {
  return {
    fill: max ? `${enrolled} / ${max}` : String(enrolled),
    trials: trials > 0 ? `+ ${trialsWord(trials)}` : null,
  }
}

/** «Ж5: абонемент начинается со следующего занятия» — the first group lesson after the trial, not before today. */
export function enrollStartDefault(
  trialDate: string,
  groupLessons: readonly { date: string }[],
  today: string,
): string {
  const min = trialDate >= today ? addDays(trialDate, 1) : today
  const next = groupLessons
    .map((l) => l.date)
    .filter((d) => d >= min && d > trialDate)
    .sort()[0]
  return next ?? min
}

// ─── «Оплатил → зачислить»: who the trial becomes ───────────────────────────

/**
 * Name as compared for «the same person»: any run of whitespace (NBSP and tabs too) → one space,
 * trimmed, lower case, ё → е. Mirrors person_name_key in 0018.
 */
export const nameKey = (name: string) =>
  name
    .replace(/[\s\u00a0]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е')

const sameName = (a: string, b: string) => nameKey(a) === nameKey(b)

/**
 * The student the trial is enrolled as: its own student_id, or — for a lead — the one existing student
 * with the same name and parent phone (a former pupil came back through a trial; enroll_trial in 0018
 * picks the same one). A sibling (same phone, another name) or several matches → null (a new student).
 */
export function trialStudentId(
  trial: Pick<Trial, 'student_id' | 'full_name' | 'parent_phone'>,
  students: readonly { id: string; full_name: string; parent_phone: string | null }[],
): string | null {
  if (trial.student_id) return trial.student_id
  if (!trial.parent_phone) return null
  const matches = students.filter(
    (s) => s.parent_phone === trial.parent_phone && sameName(s.full_name, trial.full_name),
  )
  return matches.length === 1 ? (matches[0]?.id ?? null) : null
}

/** Existing students with this parent phone — «Уже есть в учениках» hint on the booking form. */
export function studentsByPhone<T extends { parent_phone: string | null }>(
  students: readonly T[],
  phone: string | null,
): T[] {
  return phone ? students.filter((s) => s.parent_phone === phone) : []
}

/**
 * «Оплатил → зачислить» for a lead whose parent phone is already a student's but no name matches:
 * enroll_trial creates a new student — warn, the admin may have meant the existing one.
 */
export function enrollPhoneWarning(
  trial: Pick<Trial, 'student_id' | 'full_name' | 'parent_phone'>,
  students: readonly { id: string; full_name: string; parent_phone: string | null }[],
): string | null {
  if (trial.student_id) return null
  const taken = studentsByPhone(students, trial.parent_phone)
  if (taken.length === 0 || taken.some((s) => sameName(s.full_name, trial.full_name))) return null
  return `Телефон есть у: ${taken.map((s) => s.full_name).join(', ')} — будет создан новый ученик. Если это он(а) — впишите имя точно как в карточке ученика`
}

/** Discounts of the student a trial is enrolled as (В5: 15 % returning, 5 % for a friend); a new lead has none. */
export function trialDiscountHistory(
  source: StudentsSource | undefined,
  trial: Pick<Trial, 'student_id' | 'full_name' | 'parent_phone'>,
): DiscountHistory | undefined {
  if (!source) return undefined
  const id = trialStudentId(trial, source.students)
  const s = id ? source.students.find((x) => x.id === id) : undefined
  if (!s) return undefined
  return {
    isReturning: s.is_returning,
    subscriptions: s.enrollments.flatMap((e) => e.subscriptions),
    friendsBrought: source.students.filter((f) => f.referred_by_student_id === s.id).length,
  }
}
