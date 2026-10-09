import { createClient } from '@supabase/supabase-js'
import type { Database } from './types.gen'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы — скопируй .env.example в .env.local',
  )
}

export const supabase = createClient<Database>(url, anonKey)
