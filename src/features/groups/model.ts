// А3 / А4 view model: pure functions of (rows, today) — no fetching, no clock.
// Lesson dates mirror generate_lessons (0008): the database is the authority, this is the preview.
import { firstName, formatLessonWhen, groupLabel } from '@/features/students/model'
import { rateOn } from '@/features/payroll/calc'
import { tariffFor, type GroupType } from '@/features/tariffs/current'
import { formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import type { Database } from '@/lib/supabase/types.gen'

export type GroupStatus = Database['public']['Enums']['group_status']
export type LessonStatus = Database['public']['Enums']['lesson_status']
export type CancelReason = Database['public']['Enums']['cancel_reason']
export type AttendanceStatus = Database['public']['Enums']['attendance_status']

// ─── Source rows (as returned by api.ts) ────────────────────────────────────

export interface ScheduleRule {
  weekday: number
  start_time: string
  valid_from: string
  valid_to: string | null
}

export interface GroupRow {
  id: string
  name: string
  subject_id: string
  subject: string
  grade: number | null
  group_type: GroupType
  status: GroupStatus
  start_date: string
  end_date: string | null
  room: string | null
  teacher_id: string
  teacher: { full_name: string } | null
  schedule_rules: ScheduleRule[]
  /** Active enrollments (students in the group now). */
  students: number
}

export interface TariffRow {
  group_type: GroupType
  valid_from: string
  lessons_in_package: number
  package_price: number
  max_students: number
  lesson_duration_min: number
}

export interface TeacherRow {
  id: string
  full_name: string
  rates: { percent: number; valid_from: string }[]
}

export interface LessonRow {
  id: string
  lesson_date: string
  planned_start: string
  duration_min: number
  status: LessonStatus
  cancel_reason: CancelReason | null
  is_extra: boolean
  makes_up_for_lesson_id: string | null
  substitute_teacher_id: string | null
  confirmed_at: string | null
  confirmed_late: boolean
  comment: string | null
  attendance: { status: AttendanceStatus }[]
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const addDays = (iso: string, days: number) => isoOf(utc(iso) + days * DAY_MS)

/** ISO weekday 1 (Monday) … 7. */
export const isoWeekday = (iso: string) => ((new Date(utc(iso)).getUTCDay() + 6) % 7) + 1

/** Lessons are generated 8 weeks ahead (issue #9, ensure_lessons from the dashboard). */
export const HORIZON_DAYS = 56
export const horizon = (today: string) => addDays(today, HORIZON_DAYS)

// ─── Auto name (А3, #42) ────────────────────────────────────────────────────

/** Letters for parallel groups of one class: «8 класс А», «8 класс Б»… (Ё, Й, Ъ, Ы, Ь skipped). */
export const NAME_LETTERS: readonly string[] = [
  'А',
  'Б',
  'В',
  'Г',
  'Д',
  'Е',
  'Ж',
  'З',
  'И',
  'К',
  'Л',
  'М',
  'Н',
  'О',
  'П',
  'Р',
  'С',
  'Т',
  'У',
  'Ф',
  'Х',
  'Ц',
  'Ч',
  'Ш',
  'Щ',
  'Э',
  'Ю',
  'Я',
]

const TYPE_NAME_SUFFIX: Partial<Record<GroupType, string>> = { pair: 'пара', individual: 'инд.' }

/** Name part of «Математика · 7 класс»: class, letter if any, «пара»/«инд.» for those types. */
export function groupNameTemplate(grade: number, type: GroupType, letter = ''): string {
  return [`${grade} класс${letter ? ` ${letter}` : ''}`, TYPE_NAME_SUFFIX[type]]
    .filter(Boolean)
    .join(' · ')
}

const nameKey = (name: string) => name.trim().toLowerCase()

/**
 * First free name for a new group of the subject: the template while neither it nor a lettered
 * variant runs, otherwise the first free letter from А. Archived groups free their names — same
 * rule as the unique index groups_active_name_key (0013).
 */
export function autoGroupName(
  input: { subjectId: string; grade: number; groupType: GroupType },
  groups: readonly Pick<GroupRow, 'name' | 'subject_id' | 'status'>[],
): string {
  const taken = new Set(
    groups
      .filter((g) => g.subject_id === input.subjectId && g.status !== 'archived')
      .map((g) => nameKey(g.name)),
  )
  const name = (letter = '') => groupNameTemplate(input.grade, input.groupType, letter)
  if (!taken.has(nameKey(name())) && NAME_LETTERS.every((l) => !taken.has(nameKey(name(l))))) {
    return name()
  }
  const free = NAME_LETTERS.find((l) => !taken.has(nameKey(name(l))))
  return free ? name(free) : name()
}

/** A running group of the subject already has this name (checked again by the database). */
export function groupNameTaken(
  name: string,
  subjectId: string,
  groups: readonly Pick<GroupRow, 'name' | 'subject_id' | 'status'>[],
): boolean {
  return groups.some(
    (g) =>
      g.subject_id === subjectId && g.status !== 'archived' && nameKey(g.name) === nameKey(name),
  )
}

/** ISO weekday → «ПН» … «ВС». */
export const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const
export const weekdayLabel = (d: number) => WEEKDAYS[d - 1] ?? ''

/**
 * Lesson dates of a weekly schedule from `from` to `until` inclusive, holidays skipped —
 * the same rule as generate_lessons for one rule set.
 */
export function planLessonDates({
  weekdays,
  from,
  until,
  holidays,
}: {
  weekdays: readonly number[]
  from: string
  until: string
  holidays: ReadonlySet<string>
}): string[] {
  const days = new Set(weekdays)
  const out: string[] = []
  if (days.size === 0) return out
  for (let ms = utc(from); ms <= utc(until); ms += DAY_MS) {
    const iso = isoOf(ms)
    if (days.has(isoWeekday(iso)) && !holidays.has(iso)) out.push(iso)
  }
  return out
}

// ─── Schedule captions ──────────────────────────────────────────────────────

export function rulesOn(rules: readonly ScheduleRule[], day: string): ScheduleRule[] {
  return rules.filter((r) => r.valid_from <= day && (r.valid_to === null || r.valid_to >= day))
}

/**
 * Rules shown for a group on `today`: those in effect, else (group not started yet / change
 * planned) the next ones to start.
 */
export function currentRules(rules: readonly ScheduleRule[], today: string): ScheduleRule[] {
  const now = rulesOn(rules, today)
  if (now.length > 0) return now
  const next = rules
    .filter((r) => r.valid_from > today)
    .map((r) => r.valid_from)
    .sort()[0]
  return next ? rulesOn(rules, next) : []
}

/** [1,2,3,4,5] → «ПН–ПТ», [2,4,6] → «ВТ ЧТ СБ» (А3). */
export function weekdaysCaption(days: readonly number[], sep = ' '): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  const consecutive = sorted.every((d, i) => i === 0 || d === (sorted[i - 1] ?? 0) + 1)
  if (sorted.length >= 3 && consecutive) {
    return `${weekdayLabel(sorted[0] ?? 1)}–${weekdayLabel(sorted[sorted.length - 1] ?? 1)}`
  }
  return sorted.map(weekdayLabel).join(sep)
}

function byTime(rules: readonly ScheduleRule[]): [string, number[]][] {
  const map = new Map<string, number[]>()
  for (const r of rules) {
    const t = r.start_time.slice(0, 5)
    map.set(t, [...(map.get(t) ?? []), r.weekday])
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** «ВТ ЧТ СБ · 09:00» — А3 table. */
export function scheduleShort(rules: readonly ScheduleRule[]): string {
  return byTime(rules)
    .map(([t, days]) => `${weekdaysCaption(days)} · ${t}`)
    .join(', ')
}

const endTime = (start: string, minutes: number) => {
  const [h = 0, m = 0] = start.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** «ВТ, ЧТ, СБ 09:00–10:00» — А4 header. */
export function scheduleLong(rules: readonly ScheduleRule[], durationMin: number | null): string {
  return byTime(rules)
    .map(
      ([t, days]) =>
        `${weekdaysCaption(days, ', ')} ${t}${durationMin ? `–${endTime(t, durationMin)}` : ''}`,
    )
    .join('; ')
}

// ─── Teachers ───────────────────────────────────────────────────────────────

/** Teacher's percent on `day` (latest valid_from ≤ day) — payroll/calc.ts rateOn. */
export function percentOn(t: Pick<TeacherRow, 'rates'>, day: string): number | null {
  return rateOn(t.rates, day)
}

/** «Гульзат · 45 %» — teacher select in «Новая группа». */
export function teacherOption(t: TeacherRow, today: string): string {
  const p = percentOn(t, today)
  return p === null ? firstName(t.full_name) : `${firstName(t.full_name)} · ${p} %`
}

// ─── Conflicts («Пересечений у Гульзат нет») ────────────────────────────────

export interface Slot {
  weekdays: readonly number[]
  start: string
  durationMin: number
}

export interface Conflict {
  group: GroupRow
  weekday: number
  start: string
}

const minutes = (t: string) => {
  const [h = 0, m = 0] = t.split(':').map(Number)
  return h * 60 + m
}

/**
 * The teacher's other running groups whose current or planned rules overlap the new slot
 * on the same weekday (from `from` on).
 */
export function teacherConflicts(
  slot: Slot,
  teacherId: string,
  from: string,
  groups: readonly GroupRow[],
  tariffs: readonly TariffRow[],
  exceptGroupId?: string,
): Conflict[] {
  const start = minutes(slot.start)
  const end = start + slot.durationMin
  const out: Conflict[] = []
  for (const g of groups) {
    if (g.teacher_id !== teacherId || g.status === 'archived' || g.id === exceptGroupId) continue
    const duration = tariffFor(g.group_type, from, tariffs)?.lesson_duration_min ?? 60
    for (const r of g.schedule_rules) {
      if (r.valid_to !== null && r.valid_to < from) continue
      if (!slot.weekdays.includes(r.weekday)) continue
      const s = minutes(r.start_time)
      if (s < end && start < s + duration) {
        out.push({ group: g, weekday: r.weekday, start: r.start_time.slice(0, 5) })
      }
    }
  }
  return out
}

// ─── А3 list ────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<GroupStatus, string> = {
  active: 'Активна',
  forming: 'Набор',
  archived: 'В архиве',
}

export type GroupTab = 'active' | 'forming' | 'archived'

export interface GroupListRow {
  id: string
  label: string
  /** «групповая · 3 200 / 12», «продлёнка · 7 400 / 20 · 3 ч». */
  tariffCaption: string
  teacher: string
  schedule: string
  students: number
  maxStudents: number | null
  status: GroupStatus
}

export function tariffCaption(
  groupType: GroupType,
  tariff: Pick<TariffRow, 'package_price' | 'lessons_in_package' | 'lesson_duration_min'> | null,
): string {
  const type = GROUP_TYPE_LABEL[groupType].toLocaleLowerCase('ru')
  if (!tariff) return type
  const hours = tariff.lesson_duration_min >= 120 ? ` · ${tariff.lesson_duration_min / 60} ч` : ''
  return `${type} · ${formatSom(tariff.package_price)} / ${tariff.lessons_in_package}${hours}`
}

export function groupListRows(
  groups: readonly GroupRow[],
  tariffs: readonly TariffRow[],
  today: string,
): GroupListRow[] {
  return groups
    .map((g): GroupListRow => {
      const tariff = tariffFor(g.group_type, today, tariffs)
      return {
        id: g.id,
        label: groupLabel(g),
        tariffCaption: tariffCaption(g.group_type, tariff),
        teacher: g.teacher ? firstName(g.teacher.full_name) : '—',
        schedule: scheduleShort(currentRules(g.schedule_rules, today)),
        students: g.students,
        maxStudents: tariff?.max_students ?? null,
        status: g.status,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «12 активных · 2 набираются · 3 в архиве» — eyebrow of А3. */
export function listCaption(rows: readonly Pick<GroupListRow, 'status'>[]): string {
  const count = (s: GroupStatus) => rows.filter((r) => r.status === s).length
  const active = count('active')
  const forming = count('forming')
  const archived = count('archived')
  return [
    `${active} ${plural(active, 'активная', 'активных', 'активных')}`,
    `${forming} ${plural(forming, 'набирается', 'набираются', 'набираются')}`,
    `${archived} в архиве`,
  ].join(' · ')
}

const fold = (s: string) => s.toLocaleLowerCase('ru').replaceAll('ё', 'е')

/** Search by group name or teacher (А3 «Поиск по названию, учителю»). */
export function filterGroups(
  rows: readonly GroupListRow[],
  tab: GroupTab,
  q: string,
): GroupListRow[] {
  const query = fold(q.trim())
  return rows.filter(
    (r) =>
      r.status === tab &&
      (!query || fold(r.label).includes(query) || fold(r.teacher).includes(query)),
  )
}

// ─── А4 lessons ─────────────────────────────────────────────────────────────

export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  center: 'отменил центр',
  teacher: 'отменил учитель',
  holiday: 'праздник',
  all_frozen: 'вся группа заморозила',
}

/** Reasons an admin may pick (05-decisions А5.1, А6); `holiday` comes from the holidays list. */
export const MANUAL_CANCEL_REASONS = ['center', 'teacher', 'all_frozen'] as const

export type LessonTone = 'planned' | 'today' | 'unconfirmed' | 'held' | 'late' | 'cancelled'

export interface LessonView {
  id: string
  date: string
  when: string
  /** «запланировано», «7 + 1 замор. · 10:02», «отменено · отменил центр». */
  status: string
  tone: LessonTone
  isExtra: boolean
  /** Planned lessons can be cancelled and get a substitute. */
  canCancel: boolean
  /** Cancelled and not made up yet → «Доп. урок» offers it. */
  needsMakeUp: boolean
  /** «восполнено 28 окт» / «восполняет 12 окт». */
  link: string | null
  substitute: string | null
}

const MONTHS_SHORT = [
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
/** «5 окт». */
export const dayShort = (iso: string) => {
  const d = new Date(utc(iso))
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

/** «7 + 1 замор.», «7 + 1 сгорел», «8» — present (+ absences) of a held lesson (А4). */
export function attendanceSummary(marks: readonly { status: AttendanceStatus }[]): string {
  const present = marks.filter((m) => m.status === 'present').length
  const frozen = marks.filter((m) => m.status === 'absent_frozen').length
  const burned = marks.filter((m) => m.status === 'absent_burned').length
  return [
    String(present),
    frozen > 0 ? `${frozen} замор.` : null,
    burned > 0 ? `${burned} ${plural(burned, 'сгорел', 'сгорели', 'сгорели')}` : null,
  ]
    .filter(Boolean)
    .join(' + ')
}

/** Bishkek wall clock of a timestamptz: «10:02» or, on another day, «поздно, 7 окт». */
function confirmedCaption(confirmedAt: string, lessonDate: string, late: boolean): string {
  const local = new Date(Date.parse(confirmedAt) + 6 * 60 * 60 * 1000).toISOString()
  const day = local.slice(0, 10)
  return late || day !== lessonDate ? `поздно, ${dayShort(day)}` : local.slice(11, 16)
}

export function lessonViews(
  lessons: readonly LessonRow[],
  today: string,
  teacherNames: ReadonlyMap<string, string>,
): LessonView[] {
  const byId = new Map(lessons.map((l) => [l.id, l]))
  const madeUpBy = new Map(
    lessons.flatMap((l) => (l.makes_up_for_lesson_id ? [[l.makes_up_for_lesson_id, l]] : [])),
  )
  return [...lessons]
    .sort((a, b) =>
      `${a.lesson_date} ${a.planned_start}`.localeCompare(`${b.lesson_date} ${b.planned_start}`),
    )
    .map((l): LessonView => {
      let status: string
      let tone: LessonTone
      if (l.status === 'cancelled') {
        status = `отменено · ${l.cancel_reason ? CANCEL_REASON_LABEL[l.cancel_reason] : ''}`
        tone = 'cancelled'
      } else if (l.status === 'held') {
        const at = l.confirmed_at
          ? confirmedCaption(l.confirmed_at, l.lesson_date, l.confirmed_late)
          : ''
        status = [attendanceSummary(l.attendance), at].filter(Boolean).join(' · ')
        tone = l.confirmed_late ? 'late' : 'held'
      } else if (l.lesson_date < today) {
        status = 'не подтверждено'
        tone = 'unconfirmed'
      } else if (l.lesson_date === today) {
        status = 'сегодня'
        tone = 'today'
      } else {
        status = 'запланировано'
        tone = 'planned'
      }
      const madeUp = madeUpBy.get(l.id)
      const original = l.makes_up_for_lesson_id ? byId.get(l.makes_up_for_lesson_id) : undefined
      return {
        id: l.id,
        date: l.lesson_date,
        when: formatLessonWhen(l.lesson_date, l.planned_start),
        status,
        tone,
        isExtra: l.is_extra,
        canCancel: l.status === 'planned',
        needsMakeUp: l.status === 'cancelled' && !madeUp,
        link: madeUp
          ? `восполнено ${dayShort(madeUp.lesson_date)}`
          : original
            ? `восполняет ${dayShort(original.lesson_date)}`
            : null,
        substitute: l.substitute_teacher_id
          ? (teacherNames.get(l.substitute_teacher_id) ?? null)
          : null,
      }
    })
}

/** «4 из 13» — held / all lessons of the month of `today` (А4 «Октябрь · занятий»). */
export function monthProgress(
  lessons: readonly Pick<LessonRow, 'lesson_date' | 'status'>[],
  today: string,
) {
  const month = today.slice(0, 7)
  const inMonth = lessons.filter((l) => l.lesson_date.startsWith(month) && l.status !== 'cancelled')
  return { held: inMonth.filter((l) => l.status === 'held').length, total: inMonth.length }
}

const MONTHS_NOM = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]
export const monthName = (iso: string) => MONTHS_NOM[Number(iso.slice(5, 7)) - 1] ?? ''

/**
 * A teacher adds an extra lesson only for today or later (И16) — the same rule the RPC checks,
 * shown before the round trip. `date` is ISO or null while the input is incomplete.
 */
export function extraLessonDateError(date: string | null, minDate: string | undefined) {
  if (!date || !minDate || date >= minDate) return null
  return 'Доп. урок можно добавить только на сегодня или позже'
}
