// Reads local stack credentials from `supabase status` — nothing is stored in the repo.
import { execFileSync } from 'node:child_process'

export interface LocalSupabase {
  apiUrl: string
  functionsUrl: string
  anonKey: string
  serviceRoleKey: string
  /** Postgres superuser URL — only for test cleanup that has to bypass guards (immutable payments). */
  dbUrl: string
}

export function localSupabase(): LocalSupabase {
  let out: string
  try {
    out = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    throw new Error('Local Supabase is not running — run `supabase start` first')
  }
  const env = Object.fromEntries(
    out
      .split('\n')
      .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  ) as Record<string, string | undefined>

  const { API_URL, FUNCTIONS_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL } = env
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('`supabase status -o env` did not return API_URL / ANON_KEY / SERVICE_ROLE_KEY')
  }
  return {
    apiUrl: API_URL,
    functionsUrl: FUNCTIONS_URL ?? `${API_URL}/functions/v1`,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_ROLE_KEY,
    dbUrl: DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  }
}
