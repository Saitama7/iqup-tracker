// Creates local auth users for seeded people (`pnpm seed:users`, after `supabase db reset`).
// Teachers come from public.teachers (seed.sql); the DB trigger link_teacher_profile links them by phone.
// Local by default: the service-role key is read from `supabase status`, never from the repo. `--remote` — see target().
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { phoneToEmail } from '../supabase/functions/_shared/phone.ts'
import type { Database } from '../src/lib/supabase/types.gen.ts'
import { localSupabase } from './local-supabase.ts'

const PASSWORD = 'iqup-demo'

type Role = Database['public']['Enums']['role']
interface Person {
  phone: string
  full_name: string
  roles: Role[]
}

// Staff from artboard А8 (not in public.teachers).
const STAFF: Person[] = [
  { phone: '996552775771', full_name: 'Каныкей', roles: ['admin', 'teacher'] }, // ведёт занятия сама (05-decisions З1)
  { phone: '996555775772', full_name: 'Алишка', roles: ['admin'] },
  { phone: '996555300300', full_name: 'Айгерим Маматова', roles: ['accountant'] },
]

async function findAuthUserId(
  admin: SupabaseClient<Database>,
  email: string,
): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email === email)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
}

async function ensureUser(
  admin: SupabaseClient<Database>,
  person: Person,
): Promise<'created' | 'exists'> {
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('phone', person.phone)
    .maybeSingle()
  if (profileError) throw profileError
  if (profile) return 'exists'

  const email = phoneToEmail(person.phone)
  let userId: string | null = null
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { roles: person.roles },
  })
  if (error) {
    if (error.code !== 'email_exists') throw error
    userId = await findAuthUserId(admin, email) // half-created earlier: reuse the login
  } else {
    userId = data.user.id
  }
  if (!userId) throw new Error(`cannot resolve auth user for ${email}`)

  const { error: insertError } = await admin.from('profiles').insert({ id: userId, ...person })
  if (insertError) throw insertError
  return 'created'
}

// `--remote`: seed the linked cloud project (dev). Credentials come only from the environment:
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<sb_secret_…> pnpm seed:users --remote
// Never for prod with real people — the demo password is public in this file.
function target(): { apiUrl: string; serviceRoleKey: string } {
  if (process.argv.includes('--remote')) {
    const apiUrl = process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!apiUrl || !serviceRoleKey) {
      throw new Error(
        '--remote needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment',
      )
    }
    console.warn(`!! seeding REMOTE project ${apiUrl} with demo users (password "${PASSWORD}")`)
    return { apiUrl, serviceRoleKey }
  }
  const { apiUrl, serviceRoleKey } = localSupabase()
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(apiUrl)) {
    throw new Error(`Refusing to seed a non-local Supabase: ${apiUrl} (use --remote explicitly)`)
  }
  return { apiUrl, serviceRoleKey }
}

async function main() {
  const { apiUrl, serviceRoleKey } = target()
  const admin = createClient<Database>(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: teachers, error } = await admin
    .from('teachers')
    .select('full_name, phone')
    .not('phone', 'is', null)
  if (error) throw error

  const people: Person[] = [
    ...teachers.map((t) => ({
      phone: t.phone,
      full_name: t.full_name,
      roles: ['teacher'] as Role[],
    })),
    ...STAFF,
  ]

  for (const person of people) {
    const result = await ensureUser(admin, person)
    console.log(
      `${result === 'created' ? '+' : '='} ${person.phone}  ${person.full_name}  [${person.roles.join(', ')}]`,
    )
  }
  console.log(`\nPassword for everyone: ${PASSWORD}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
