import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/supabase/types.gen'

/** The group's current teacher — lessons inserted by a spec are paid to them (lessons.teacher_id, #73). */
export async function groupTeacher(db: SupabaseClient<Database>, groupId: string): Promise<string> {
  const { data, error } = await db.from('groups').select('teacher_id').eq('id', groupId).single()
  if (error) throw error
  return data.teacher_id
}
