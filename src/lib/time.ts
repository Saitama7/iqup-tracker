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
