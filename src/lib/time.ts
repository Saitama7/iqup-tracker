// Asia/Bishkek is UTC+6 with no DST (invariant 8), so a fixed offset is exact.
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1000

/** Calendar date in Bishkek as `YYYY-MM-DD`. */
export function bishkekDate(nowMs: number): string {
  return new Date(nowMs + BISHKEK_OFFSET_MS).toISOString().slice(0, 10)
}

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
// Genitive: «8 октября», «с сентября 2024»
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

function bishkekParts(ms: number): Date {
  // UTC getters of the shifted instant read Bishkek wall-clock fields.
  return new Date(ms + BISHKEK_OFFSET_MS)
}

/** «Четверг, 8 октября» — page eyebrow on У2 / УД1. */
export function formatDayLong(nowMs: number): string {
  const d = bishkekParts(nowMs)
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
}

/** «сентября 2024» — for «В IQ UP с …» on У7. */
export function formatMonthYearGen(ms: number): string {
  const d = bishkekParts(ms)
  return `${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** '2026-10-12' → '12.10.2026' */
export function formatDateRu(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

/** '12.10.2026' (also 12/10/2026, 12-10-2026) → '2026-10-12'; null if not a real date. */
export function parseDateRu(input: string): string | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(input)
  const [, d = '', mo = '', y = ''] = m ?? []
  if (!m) return null
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null
}

/** Whole Bishkek calendar days from `fromMs` to `toMs` (0 = same day). */
export function bishkekDaysBetween(fromMs: number, toMs: number): number {
  const day = (ms: number) => Date.parse(`${bishkekDate(ms)}T00:00:00Z`)
  return Math.round((day(toMs) - day(fromMs)) / 86_400_000)
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

/** «Октябрь» — month card on УД1. */
export function formatMonthNom(ms: number): string {
  return MONTHS_NOM[bishkekParts(ms).getUTCMonth()] ?? ''
}

/** «пятница» — «Завтра, пятница» on У2. */
export function formatWeekdayLower(ms: number): string {
  return (WEEKDAYS[bishkekParts(ms).getUTCDay()] ?? '').toLowerCase()
}
