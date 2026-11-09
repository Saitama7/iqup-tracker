import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/supabase/types.gen'

/** The group's current teacher — lessons inserted by a spec are paid to them (lessons.teacher_id, #73). */
export async function groupTeacher(db: SupabaseClient<Database>, groupId: string): Promise<string> {
  const { data, error } = await db.from('groups').select('teacher_id').eq('id', groupId).single()
  if (error) throw error
  return data.teacher_id
}

/** Holiday days (ISO dates) — lessons are not generated on them (seed: «День Октябрьской революции» ≥ 7 days ahead, 31.12…, А9). */
export async function holidayDays(db: SupabaseClient<Database>): Promise<Set<string>> {
  const { data, error } = await db.from('holidays').select('day')
  if (error) throw error
  return new Set(data.map((h) => h.day))
}

/** Today in Asia/Bishkek (UTC+6, no DST), ISO — for fixtures that must be «now», not a seed date (#130). */
export const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10)

/** ISO date `days` after `iso`. */
export const isoPlus = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** The last day of the month of `iso`. */
export const monthEnd = (iso: string) =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10)
