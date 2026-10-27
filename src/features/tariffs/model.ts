// А9 / А9а view model: pure functions of (rows, today) — no fetching, no clock.
import { plural } from '@/features/users/model'
import { bishkekDate, formatDayMonth } from '@/lib/time'
import { GROUP_TYPES, tariffFor, type GroupType } from './current'

export interface Tariff {
  id: string
  group_type: GroupType
  lessons_in_package: number
  package_price: number
  max_students: number
  lesson_duration_min: number
  /** null — no limit (К9). */
  freeze_limit: number | null
  /** Продлёнка: цена часа (#82); null — package / (lessons × h). */
  hour_price?: number | null
  valid_from: string
  created_at: string
  created_by: string | null
}

export interface Holiday {
  day: string
  name: string
}

export interface SubscriptionRef {
  tariff_id: string
  status: 'active' | 'exhausted' | 'refunded'
}

export interface SettingsSource {
  tariffs: Tariff[]
  holidays: Holiday[]
  subscriptions: SubscriptionRef[]
  /** profiles.id → full_name, for «кто изменил». */
  authors: Record<string, string>
}

export const GROUP_TYPE_LABEL: Record<GroupType, string> = {
  group: 'Групповая',
  mini: 'Мини-группа',
  pair: 'Парная',
  individual: 'Индивидуальная',
  afterschool: 'Продлёнка',
}

/** Compact names for the one-line summary of an archived version (А9а). */
const GROUP_TYPE_SHORT: Record<GroupType, string> = {
  group: 'Групповая',
  mini: 'Мини',
  pair: 'Парная',
  individual: 'Инд.',
  afterschool: 'Продлёнка',
}

/**
 * «Скидки и правила» — read-only constants until R2 (issue #7 «Не делать»), 05-decisions В2, В5, В7, А9.
 */
export const RULES = [
  { title: 'Бывшим ученикам', caption: 'только первый абонемент', value: '15 %' },
  { title: '«Приведи друга»', caption: 'тому, кто привёл · один абонемент', value: '5 %' },
  { title: 'Допустимый долг', caption: 'уроков сверх оплаченных', value: '3' },
  { title: 'Заморозка', caption: 'предупредил за день или минимум за 2 часа', value: '2 / абон.' },
  { title: 'День выплаты ЗП', caption: 'за календарный месяц', value: '15-е' },
] as const

/** 1st of the month after `today` (`YYYY-MM-DD`). */
export function nextMonthStart(today: string): string {
  const [y = 0, m = 1] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

export interface PlanMinDate {
  /** Earliest valid_from of a new version — also the form's default. */
  date: string
  /** Some group type already has subscriptions → the 1st of next month (К6). */
  paid: boolean
}

/**
 * Earliest start of a new tariff version (К6, А9; tariffs_guard 0012 checks the same per type):
 * a type with subscriptions — the 1st of next month, bought subscriptions keep their price;
 * none — today. The version is one date for every type (И8), so any paid type moves it.
 */
export function planMinDate(
  source: Pick<SettingsSource, 'tariffs' | 'subscriptions'>,
  today: string,
): PlanMinDate {
  const tariffIds = new Set(source.tariffs.map((t) => t.id))
  const paid = source.subscriptions.some((s) => tariffIds.has(s.tariff_id))
  return { date: paid ? nextMonthStart(today) : today, paid }
}

/** Under the date field (А9): «Для действующих групп новый тариф начнёт действовать с 1 ноября. …». */
export function planMinDateHint(min: PlanMinDate): string | null {
  return min.paid
    ? `Для действующих групп новый тариф начнёт действовать с ${formatDayMonth(min.date)}. Купленные абонементы остаются по старой цене`
    : null
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const NBSP = ' '
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

/** 3200 → «3 200» (non-breaking space). */
export function formatSom(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** 266.666… → «266,67»; `trim` drops «,00» (600 → «600», as in А9а). */
export function formatLessonPrice(n: number, trim = false): string {
  const fixed = (Math.round(n * 100) / 100).toFixed(2)
  const [int = '', frac = ''] = fixed.split('.')
  const whole = formatSom(Number(int))
  return trim && frac === '00' ? whole : `${whole},${frac}`
}

const parts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    dow: d.getUTCDay(),
  }
}

/** '2026-09-01' → «1 сентября 2026». */
export function formatDateLong(iso: string): string {
  const p = parts(iso)
  return `${p.day} ${MONTHS_GEN[p.month]} ${p.year}`
}

/** '2026-08-25' → «25 авг 2026». */
export function formatDateShort(iso: string): string {
  const p = parts(iso)
  return `${p.day} ${MONTHS_SHORT[p.month]} ${p.year}`
}

export function seatsLabel(maxStudents: number): string {
  return maxStudents <= 2 ? String(maxStudents) : `до ${maxStudents}`
}

// ─── Tariff table (А9) ──────────────────────────────────────────────────────

/** All rows of the tariff set in effect today, in GROUP_TYPES order. */
export function currentTariffs(tariffs: readonly Tariff[], today: string): Tariff[] {
  return GROUP_TYPES.map((type) => tariffFor(type, today, tariffs)).filter(
    (t): t is Tariff => t !== null,
  )
}

// ─── History (А9а) ──────────────────────────────────────────────────────────

export type VersionStatus = 'planned' | 'current' | 'archive'

export interface VersionRow {
  type: GroupType
  /** Package price of the same type in the previous version; null for a new type. */
  before: Tariff | null
  after: Tariff
}

export interface TariffVersion {
  validFrom: string
  status: VersionStatus
  /** The oldest version — «первый». */
  first: boolean
  rows: VersionRow[]
  /** «Каныкей · 25 авг 2026», «импорт при запуске», or just the date. */
  author: string
  /** Subscriptions bought at this version's prices. */
  subscriptions: number
  /** Of them still running (status active). */
  activeSubscriptions: number
}

/** Tariff versions (rows sharing one valid_from), newest first. */
export function buildVersions(source: SettingsSource, today: string): TariffVersion[] {
  const dates = [...new Set(source.tariffs.map((t) => t.valid_from))].sort()
  const current = dates.filter((d) => d <= today).at(-1) ?? null
  const subsByTariff = new Map<string, { total: number; active: number }>()
  for (const s of source.subscriptions) {
    const c = subsByTariff.get(s.tariff_id) ?? { total: 0, active: 0 }
    c.total += 1
    if (s.status === 'active') c.active += 1
    subsByTariff.set(s.tariff_id, c)
  }

  return dates
    .map((validFrom, i): TariffVersion => {
      const own = source.tariffs.filter((t) => t.valid_from === validFrom)
      const prevDate = dates[i - 1]
      const rows = GROUP_TYPES.flatMap((type): VersionRow[] => {
        const after = own.find((t) => t.group_type === type)
        if (!after) return []
        const before = prevDate ? tariffFor(type, prevDate, source.tariffs) : null
        return [{ type, before, after }]
      })
      const subs = own.map((t) => subsByTariff.get(t.id) ?? { total: 0, active: 0 })
      const createdBy = own.find((t) => t.created_by)?.created_by ?? null
      const createdAt = own.map((t) => t.created_at).sort()[0] ?? ''
      const date = createdAt ? formatDateShort(bishkekDate(Date.parse(createdAt))) : ''
      const name = createdBy ? source.authors[createdBy] : undefined
      return {
        validFrom,
        status: validFrom > today ? 'planned' : validFrom === current ? 'current' : 'archive',
        first: i === 0,
        rows,
        author: name ? `${name} · ${date}` : i === 0 ? 'импорт при запуске' : date,
        subscriptions: subs.reduce((n, c) => n + c.total, 0),
        activeSubscriptions: subs.reduce((n, c) => n + c.active, 0),
      }
    })
    .reverse()
}

/** «Групповая 2 800 → 3 000 · Мини 3 200 → 3 500 …» — collapsed archived version. */
export function versionSummary(v: TariffVersion): string {
  return v.rows
    .map((r) => {
      const label = GROUP_TYPE_SHORT[r.type]
      const after = formatSom(r.after.package_price)
      return r.before
        ? `${label} ${formatSom(r.before.package_price)} → ${after}`
        : `${label} ${after}`
    })
    .join(' · ')
}

export function subscriptionsCaption(
  v: TariffVersion,
  next: TariffVersion | undefined,
): string | null {
  const n = (k: number) => `${k} ${plural(k, ['абонемент', 'абонемента', 'абонементов'])}`
  if (v.status === 'current') return `По этому тарифу: ${n(v.subscriptions)}`
  if (v.status === 'archive' && v.activeSubscriptions > 0 && next) {
    const k = v.activeSubscriptions
    const verb = plural(k, ['дорабатывается', 'дорабатываются', 'дорабатываются'])
    return `Ещё ${n(k)} по этому тарифу ${verb} (куплены до ${formatDateShort(next.validFrom)})`
  }
  return null
}

// ─── Holidays (А9) ──────────────────────────────────────────────────────────

export interface HolidayItem {
  /** Consecutive days with the same name, e.g. New Year 31.12–02.01. */
  days: string[]
  name: string
  label: string
  /** Started before today — history, cannot be deleted. */
  past: boolean
}

const nextDay = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function rangeLabel(first: string, last: string): string {
  const a = parts(first)
  if (first === last) return `${a.day} ${MONTHS_GEN[a.month]} · ${WEEKDAYS_SHORT[a.dow]}`
  const b = parts(last)
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${MONTHS_GEN[a.month]}`
  return `${a.day} ${MONTHS_SHORT[a.month]} – ${b.day} ${MONTHS_SHORT[b.month]}`
}

/** Holidays by date; consecutive days with one name become one row («31 дек – 2 янв»). */
export function holidayItems(holidays: readonly Holiday[], today: string): HolidayItem[] {
  const sorted = [...holidays].sort((a, b) => a.day.localeCompare(b.day))
  const groups: { days: string[]; name: string }[] = []
  for (const h of sorted) {
    const last = groups.at(-1)
    if (last && last.name === h.name && nextDay(last.days.at(-1) ?? '') === h.day) {
      last.days.push(h.day)
    } else {
      groups.push({ days: [h.day], name: h.name })
    }
  }
  return groups.map((g) => ({
    ...g,
    label: rangeLabel(g.days[0] ?? '', g.days.at(-1) ?? ''),
    past: (g.days[0] ?? '') < today,
  }))
}
