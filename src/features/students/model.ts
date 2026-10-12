// А5 / А6 view model: pure functions of (rows, today) — no fetching, no clock.
import { formatSom } from '@/features/tariffs/model'
import { formatPhone } from '@/lib/phone'
import type { StudentBalance } from '@/features/payments/api'
import { payState, totalDebt, type PayState } from '@/features/payments/balance'
import { payChipLabel, remainingLabel, worstState } from './pay-view'
import {
  discountByPct,
  type DiscountPct,
  type DiscountReason,
} from '@/features/subscriptions/model'

// ─── Source rows (as returned by api.ts) ────────────────────────────────────

export type GroupType = 'group' | 'mini' | 'pair' | 'individual' | 'afterschool'
export type GroupStatus = 'forming' | 'active' | 'archived'
export type AttendanceStatus = 'present' | 'absent_frozen' | 'absent_burned'

export interface ScheduleRule {
  weekday: number
  start_time: string
  valid_from: string
  valid_to: string | null
}

export interface GroupBrief {
  id: string
  name: string
  subject: string
  group_type: GroupType
  status: GroupStatus
  start_date: string
  end_date: string | null
  teacher: { full_name: string } | null
  schedule_rules: ScheduleRule[]
}

export interface SubscriptionRow {
  id: string
  lessons_total: number
  price_full: number
  price_final: number
  discount_percent: number
  discount_reason: DiscountReason
  started_at: string
  status: 'active' | 'exhausted' | 'refunded'
  created_at: string
}

export interface EnrollmentRow {
  id: string
  group_id: string
  start_date: string
  end_date: string | null
  status: 'active' | 'finished'
  subscriptions: SubscriptionRow[]
}

export interface StudentRow {
  id: string
  full_name: string
  grade: number | null
  parent_name: string | null
  parent_phone: string | null
  is_returning: boolean
  referred_by_student_id: string | null
  notes: string | null
  created_at: string
  enrollments: EnrollmentRow[]
}

/** One subscription's money and lessons — a row of v_student_balance (features/payments). */
export type Balance = StudentBalance

export interface StudentsSource {
  students: StudentRow[]
  groups: GroupBrief[]
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
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
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
/** ISO weekday 1–7 → «ПН» … «ВС» (А6 «ВТ ЧТ СБ 09:00»). */
const ISO_WEEKDAYS = ['', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** '2026-10-01' → «1 октября» (А6 «зачислен 1 октября»). */
export function formatDayMonth(iso: string): string {
  const d = utc(iso)
  return `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
}

/** '2026-10-08', '09:00:00' → «8 окт, чт 09:00» (А6 attendance). */
export function formatLessonWhen(iso: string, time: string): string {
  const d = utc(iso)
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}, ${WEEKDAYS_SHORT[d.getUTCDay()]} ${time.slice(0, 5)}`
}

/** '2026-10-01' → «1 окт» (А6 «Платежи»). */
export function formatShortDate(iso: string): string {
  const d = utc(iso)
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

/** «Асан Асанов» → «АА»; one word → its first letter. */
export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** «Тимур Мамбетов» → «Тимур М.» (А4 «привёл Тимур М.»). */
export function shortName(fullName: string): string {
  const [first = '', last] = fullName.trim().split(/\s+/)
  return last ? `${first} ${last[0]}.` : first
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName

/** «Математика · 8 класс А». */
export const groupLabel = (g: Pick<GroupBrief, 'subject' | 'name'>) => `${g.subject} · ${g.name}`

/** Rules in effect on `today` → «ВТ ЧТ СБ 09:00» (one part per start time). */
export function scheduleCaption(rules: readonly ScheduleRule[], today: string): string {
  const current = rules.filter(
    (r) => r.valid_from <= today && (r.valid_to === null || r.valid_to >= today),
  )
  const byTime = new Map<string, number[]>()
  for (const r of current) {
    const t = r.start_time.slice(0, 5)
    byTime.set(t, [...(byTime.get(t) ?? []), r.weekday])
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([t, days]) =>
        `${[...new Set(days)]
          .sort()
          .map((d) => ISO_WEEKDAYS[d])
          .join(' ')} ${t}`,
    )
    .join(', ')
}

/** «3 200 сом · без скидки» / «2 720 сом · скидка 15 %». */
export function priceCaption(s: Pick<SubscriptionRow, 'price_final' | 'discount_percent'>): string {
  const price = `${formatSom(s.price_final)} сом`
  return s.discount_percent > 0
    ? `${price} · скидка ${s.discount_percent} %`
    : `${price} · без скидки`
}

/** «скидка 15 % · бывший ученик» (А4 under the name). */
export function discountCaption(s: Pick<SubscriptionRow, 'discount_percent'>): string | null {
  if (s.discount_percent === 0) return null
  const d = discountByPct(s.discount_percent as DiscountPct)
  return `скидка ${d.label}`
}

// ─── Enrollments ────────────────────────────────────────────────────────────

/** The subscription lessons are counted from now: the newest by start date. */
export function currentSubscription(
  e: Pick<EnrollmentRow, 'subscriptions'>,
): SubscriptionRow | null {
  let found: SubscriptionRow | null = null
  for (const s of e.subscriptions) {
    if (s.status === 'refunded') continue
    if (
      !found ||
      s.started_at > found.started_at ||
      (s.started_at === found.started_at && s.created_at > found.created_at)
    ) {
      found = s
    }
  }
  return found
}

function newestRefunded(
  e: Pick<EnrollmentRow, 'subscriptions'>,
  balances: ReadonlyMap<string, Balance>,
): EnrollmentView['refunded'] {
  const found = e.subscriptions
    .filter((s) => s.status === 'refunded')
    .sort(
      (a, b) =>
        b.started_at.localeCompare(a.started_at) || b.created_at.localeCompare(a.created_at),
    )[0]
  return found ? { subscription: found, balance: balances.get(found.id) ?? null } : null
}

export interface EnrollmentView {
  enrollmentId: string
  group: GroupBrief | null
  groupLabel: string
  startDate: string
  active: boolean
  subscription: SubscriptionRow | null
  balance: Balance | null
  /** The newest returned subscription — shown as «Возврат» when there is no live one. */
  refunded: { subscription: SubscriptionRow; balance: Balance | null } | null
}

export function enrollmentViews(
  student: Pick<StudentRow, 'enrollments'>,
  groups: ReadonlyMap<string, GroupBrief>,
  balances: ReadonlyMap<string, Balance>,
): EnrollmentView[] {
  return student.enrollments
    .map((e): EnrollmentView => {
      const group = groups.get(e.group_id) ?? null
      const subscription = currentSubscription(e)
      return {
        enrollmentId: e.id,
        group,
        groupLabel: group ? groupLabel(group) : 'Группа',
        startDate: e.start_date,
        active: e.status === 'active',
        subscription,
        balance: subscription ? (balances.get(subscription.id) ?? null) : null,
        refunded: newestRefunded(e, balances),
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.groupLabel.localeCompare(b.groupLabel))
}

// ─── А5 list ────────────────────────────────────────────────────────────────

export type StudentStatus = 'active' | 'not_enrolled'

export interface StudentListRow {
  id: string
  fullName: string
  grade: number | null
  parentPhone: string | null
  /** «Математика · 8 класс А · Химия · 9 класс» — active enrollments. */
  groups: string
  groupIds: string[]
  /** «12 / 12 · −2» — lessons left / total, or the debt, per active enrollment (А5 «Осталось уроков»). */
  remaining: string
  status: StudentStatus
  /** The worst pay state among the current subscriptions of active enrollments; debt of any subscription counts. */
  payState: PayState | null
  /** «Оплачено» / «Частично · 6 ур» / «Пора оплачивать» / «Долг». */
  payLabel: string | null
  /** Lessons «в долг» and what they cost over all subscriptions of the student. */
  debtLessons: number
  debtSom: number
}

export function studentListRow(
  s: StudentRow,
  groups: ReadonlyMap<string, GroupBrief>,
  balances: ReadonlyMap<string, Balance>,
): StudentListRow {
  const active = enrollmentViews(s, groups, balances).filter((e) => e.active)
  const remaining = active
    .map((e) => {
      if (!e.subscription) return '—'
      if (!e.balance) return `${e.subscription.lessons_total} / ${e.subscription.lessons_total}`
      return remainingLabel(e.balance)
    })
    .join(' · ')
  const debt = totalDebt(
    s.enrollments.flatMap((e) => e.subscriptions.flatMap((x) => balances.get(x.id) ?? [])),
  )
  const current = active.flatMap((e) => (e.balance ? [e.balance] : []))
  const states = current.map((b) => ({ b, state: payState(b) }))
  const state: PayState | null = debt.lessons > 0 ? 'debt' : worstState(states.map((x) => x.state))
  const detail = states.find((x) => x.state === state)?.b
  return {
    id: s.id,
    fullName: s.full_name,
    grade: s.grade,
    parentPhone: s.parent_phone,
    groups: active.map((e) => e.groupLabel).join(' · '),
    groupIds: active.flatMap((e) => (e.group ? [e.group.id] : [])),
    remaining,
    status: active.length === 0 ? 'not_enrolled' : 'active',
    payState: state,
    payLabel: state ? payChipLabel(state, detail?.paidLessons ?? 0) : null,
    debtLessons: debt.lessons,
    debtSom: debt.som,
  }
}

export function studentListRows(
  source: StudentsSource,
  balanceRows: readonly Balance[],
): StudentListRow[] {
  const groups = new Map(source.groups.map((g) => [g.id, g]))
  const balances = new Map(balanceRows.map((b) => [b.subscriptionId, b]))
  return source.students
    .map((s) => studentListRow(s, groups, balances))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
}

/** Rows that need the admin to take money: debt, a reminder or a partial payment. */
export const needsPayment = (r: Pick<StudentListRow, 'payState'>) =>
  r.payState !== null && r.payState !== 'paid'

const fold = (s: string) => s.toLocaleLowerCase('ru').replaceAll('ё', 'е')

/** Digits of a phone query, without the country code / trunk zero: «0555 999» → «555999». */
function phoneDigits(q: string): string {
  let d = q.replace(/\D/g, '')
  if (d.startsWith('996')) d = d.slice(3)
  else if (d.startsWith('0')) d = d.slice(1)
  return d
}

/** Search by student name or parent phone (А5 «Имя ученика или телефон родителя»). */
export function matchesQuery(row: Pick<StudentListRow, 'fullName' | 'parentPhone'>, q: string) {
  const query = q.trim()
  if (!query) return true
  if (/^[\d\s+()-]+$/.test(query)) {
    const d = phoneDigits(query)
    return d.length > 0 && (row.parentPhone ?? '').slice(3).includes(d)
  }
  return fold(row.fullName).includes(fold(query))
}

export type PayFilter = 'debt' | 'soon' | 'partial'
export const PAY_FILTERS: readonly PayFilter[] = ['debt', 'soon', 'partial']

export interface StudentFilter {
  q?: string
  group?: string
  pay?: PayFilter
}

export function filterRows(rows: readonly StudentListRow[], f: StudentFilter): StudentListRow[] {
  return rows.filter(
    (r) =>
      (!f.group || r.groupIds.includes(f.group)) &&
      (!f.pay || r.payState === f.pay) &&
      matchesQuery(r, f.q ?? ''),
  )
}

/** Counters of the filter chips (the group and the search are not applied). */
export function payCounts(rows: readonly StudentListRow[]): Record<PayFilter, number> {
  return {
    debt: rows.filter((r) => r.payState === 'debt').length,
    soon: rows.filter((r) => r.payState === 'soon').length,
    partial: rows.filter((r) => r.payState === 'partial').length,
  }
}

/** «31 активный · 5 с долгом · 2 без группы» — eyebrow of А5. */
export function listCaption(rows: readonly StudentListRow[]): string {
  const active = rows.filter((r) => r.status !== 'not_enrolled').length
  const idle = rows.length - active
  const debtors = rows.filter((r) => r.payState === 'debt').length
  const word = active % 10 === 1 && active % 100 !== 11 ? 'активный' : 'активных'
  return [
    `${active} ${word}`,
    debtors > 0 ? `${debtors} с долгом` : null,
    idle > 0 ? `${idle} без группы` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Groups a student can be enrolled into, by label. */
export function enrollableGroups(groups: readonly GroupBrief[]): GroupBrief[] {
  return groups
    .filter((g) => g.status !== 'archived')
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), 'ru'))
}

export const displayPhone = (phone: string | null) => (phone ? formatPhone(phone) : null)

// ─── А6 attendance ──────────────────────────────────────────────────────────

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'Был',
  absent_frozen: 'Заморозка',
  absent_burned: 'Не был',
}

/** «10:02» if marked on the lesson day, else «7 окт 08:40» (Asia/Bishkek). */
export function formatMarkedAt(markedAt: string, lessonDate: string): string {
  const local = new Date(Date.parse(markedAt) + 6 * 60 * 60 * 1000).toISOString()
  const day = local.slice(0, 10)
  const time = local.slice(11, 16)
  if (day === lessonDate) return time
  const d = utc(day)
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${time}`
}
