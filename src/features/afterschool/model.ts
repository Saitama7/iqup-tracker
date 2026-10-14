// Продлёнка по часам (#82) — 05-decisions И58–И63, 01-domain-model §5.2.
// The student's plan (hours per weekday from a date), hours of a month, the invoice price. The same
// rules are SQL in 0025 (afterschool_plan_on, afterschool_month_quote, afterschool_invoice_insert) —
// the database is the authority; this is for previews («≈ 20 ч в марте · 2 000 сом») and labels.
//
// Pure: callers pass the rows they already have, nothing here reads the database.
import { priceFinal } from '@/features/subscriptions/model'

/** hours[0..6] = Mon … Sun (ISO weekday − 1); 0 — does not come that day. */
export type PlanHours = readonly number[]

export interface PlanVersion {
  valid_from: string
  hours: PlanHours
}

/** One day: 0 (does not come) or 0,5 … 4 h, step 0,5 (И59). */
export const HOUR_OPTIONS: readonly number[] = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
export const MAX_DAY_HOURS = 4

export const WEEKDAY_SHORT = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const

const MONTHS_PREP = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
]
const MONTHS_ACC = [
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

/** «в октябре» — for «≈ 21 ч в октябре». */
export const monthPrepositional = (month: string) =>
  MONTHS_PREP[Number(month.slice(5, 7)) - 1] ?? ''
/** «за ноябрь» — for «Выставить счёт за ноябрь». */
export const monthAccusative = (month: string) => MONTHS_ACC[Number(month.slice(5, 7)) - 1] ?? ''

/** ISO weekday 1 … 7 of `YYYY-MM-DD` (calendar date, no time zone). */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return day === 0 ? 7 : day
}

/** First day of the month of `date`. */
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`

/** First day of the month after `month`. */
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export function validDayHours(h: number): boolean {
  return h >= 0 && h <= MAX_DAY_HOURS && Number.isInteger(h * 2)
}

/** 7 values of 0 … 4 h, step 0,5, at least one day with hours (set_afterschool_plan). */
export function validPlan(hours: PlanHours): boolean {
  return hours.length === 7 && hours.every(validDayHours) && hours.some((h) => h > 0)
}

/** Default plan (И59): the group's weekdays × the tariff duration (3 h); no schedule — Mon–Fri. */
export function defaultPlan(weekdays: readonly number[], durationMin = 180): number[] {
  const h = Math.min(durationMin / 60, MAX_DAY_HOURS)
  const days = weekdays.length > 0 ? new Set(weekdays) : new Set([1, 2, 3, 4, 5])
  return Array.from({ length: 7 }, (_, i) => (days.has(i + 1) ? h : 0))
}

/**
 * The plan on `date`: the latest version with valid_from ≤ date; before the first version — the
 * first one (afterschool_plan_on). Null — no plan.
 */
export function planOn(plans: readonly PlanVersion[], date: string): PlanHours | null {
  let found: PlanVersion | null = null
  let first: PlanVersion | null = null
  for (const p of plans) {
    if (!first || p.valid_from < first.valid_from) first = p
    if (p.valid_from <= date && (!found || p.valid_from > found.valid_from)) found = p
  }
  return (found ?? first)?.hours ?? null
}

/** Planned hours on `date`; null — no plan (a student of the old 20-lesson model). */
export function dayHours(plans: readonly PlanVersion[], date: string): number | null {
  const plan = planOn(plans, date)
  return plan ? (plan[isoWeekday(date) - 1] ?? 0) : null
}

export interface QuoteRow {
  /** ISO weekday 1 … 7 */
  weekday: number
  hours: number
  days: number
}

export interface MonthQuote {
  rows: QuoteRow[]
  /** Σ hours × days */
  hours: number
  /** Lesson days with hours */
  days: number
}

/**
 * Hours of a month (afterschool_month_quote): every non-cancelled lesson day of the group in the
 * month on or after `from` (and ≤ `to`), × the plan hours of that weekday on that day. Holidays have
 * no lessons. Callers pass the group's lesson dates (any order, duplicates ok).
 */
export function monthQuote(
  lessonDates: readonly string[],
  plans: readonly PlanVersion[],
  month: string,
  from: string,
  to: string | null = null,
): MonthQuote {
  const first = monthStart(month)
  const end = nextMonth(first)
  const start = from > first ? from : first
  const days = [...new Set(lessonDates)].filter(
    (d) => d >= start && d < end && (to === null || d <= to),
  )
  const rows = new Map<string, QuoteRow>()
  for (const d of days) {
    const h = dayHours(plans, d) ?? 0
    if (h <= 0) continue
    const weekday = isoWeekday(d)
    const key = `${weekday}|${h}`
    const row = rows.get(key)
    if (row) row.days += 1
    else rows.set(key, { weekday, hours: h, days: 1 })
  }
  const list = [...rows.values()].sort((a, b) => a.weekday - b.weekday || a.hours - b.hours)
  return {
    rows: list,
    hours: list.reduce((n, r) => n + r.hours * r.days, 0),
    days: list.reduce((n, r) => n + r.days, 0),
  }
}

/** «2», «1,5» */
export const formatHours = (h: number) => String(Math.round(h * 10) / 10).replace('.', ',')

/** «ПН 2 ч × 4 + СР 1 ч × 5 + ПТ 2 ч × 4 = 21 ч» */
export function formatQuote(q: Pick<MonthQuote, 'rows' | 'hours'>): string {
  if (q.rows.length === 0) return '0 ч'
  const parts = q.rows.map(
    (r) => `${WEEKDAY_SHORT[r.weekday - 1] ?? ''} ${formatHours(r.hours)} ч × ${r.days}`,
  )
  return `${parts.join(' + ')} = ${formatHours(q.hours)} ч`
}

/** «ПН 2 · СР 1 · ПТ 2» — the plan in one line, days without hours skipped. */
export function formatPlan(hours: PlanHours): string {
  const parts = hours.flatMap((h, i) => (h > 0 ? [`${WEEKDAY_SHORT[i]} ${formatHours(h)}`] : []))
  return parts.length > 0 ? `${parts.join(' · ')} ч` : 'без часов'
}

export interface HourTariff {
  package_price: number
  lessons_in_package: number
  lesson_duration_min: number
  hour_price?: number | null
}

/** Price of one after-school hour (tariff_hour_price): hour_price, else package / (lessons × h). */
export function tariffHourPrice(t: HourTariff): number {
  if (t.hour_price != null) return t.hour_price
  return Math.round((t.package_price * 60) / (t.lessons_in_package * t.lesson_duration_min))
}

export interface InvoiceQuote {
  planned: number
  credit: number
  hours: number
  hourPrice: number
  priceFull: number
  priceFinal: number
}

/**
 * The invoice of a month (afterschool_invoice_insert): hours = planned − credit (unused hours of
 * earlier invoices, И61) — at least 0,5 h stays billed, the rest of the credit goes on; price =
 * round(hours × hour price), discount В5 on top.
 */
export function invoiceQuote(
  planned: number,
  credit: number,
  hourPrice: number,
  discountPct: number,
): InvoiceQuote {
  const used = planned > 0 ? Math.min(Math.max(0, credit), planned - 0.5) : 0
  const hours = planned - used
  const full = Math.round(hours * hourPrice)
  return {
    planned,
    credit: used,
    hours,
    hourPrice,
    priceFull: full,
    priceFinal: priceFinal(full, discountPct),
  }
}
