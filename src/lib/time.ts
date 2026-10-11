// Asia/Bishkek is UTC+6 with no DST (invariant 8), so a fixed offset is exact.
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1000

/** Calendar date in Bishkek as `YYYY-MM-DD`. */
export function bishkekDate(nowMs: number): string {
  return new Date(nowMs + BISHKEK_OFFSET_MS).toISOString().slice(0, 10)
}
