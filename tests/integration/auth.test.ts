// Needs the local stack: `supabase start && supabase db reset && pnpm seed:users`
// and `supabase functions serve` for the Edge Function block. Run with `pnpm test:integration`.
import { createClient } from '@supabase/supabase-js'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import type { Database } from '../../src/lib/supabase/types.gen'
import { localSupabase } from '../../scripts/local-supabase'

const env = localSupabase()
const client = () =>
  createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

async function signIn(phone: string) {
  const supabase = client()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: phoneToEmail(phone),
    password: 'iqup-demo',
  })
  if (error) throw error
  return { supabase, token: data.session.access_token, user: data.user }
}

describe('seeded logins', () => {
  it('Гульзат signs in with 0555 123 456 / iqup-demo and sees her 4 groups', async () => {
    const { supabase, user } = await signIn('0555 123 456')
    expect(user.app_metadata.roles).toEqual(['teacher'])

    const { data: teacher } = await supabase.from('teachers').select('full_name, user_id').single()
    expect(teacher).toEqual({ full_name: 'Гульзат Асанова', user_id: user.id })

    const { data: groups } = await supabase.from('groups').select('name')
    expect(groups?.map((g) => g.name).sort()).toEqual([
      '5 класс',
      '6 класс',
      '8 класс А',
      '8 класс Б',
    ])
  })

  it('wrong password is rejected', async () => {
    const { error } = await client().auth.signInWithPassword({
      email: phoneToEmail('0555 123 456'),
      password: 'wrong-password',
    })
    expect(error).not.toBeNull()
  })
})

describe('Edge Function create-user', () => {
  const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const phone = `996599${String(Date.now()).slice(-6)}`
  const created: string[] = []

  afterAll(async () => {
    for (const id of created) await service.auth.admin.deleteUser(id)
  })

  const call = (token: string, body: unknown) =>
    fetch(`${env.functionsUrl}/create-user`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const body = {
    phone,
    full_name: 'Integration Test',
    roles: ['accountant'],
    password: 'secret-123',
  }

  it('teacher JWT gets 403', async () => {
    const { token } = await signIn('0555 123 456')
    const res = await call(token, body)
    expect(res.status).toBe(403)
  })

  it('admin JWT creates a user who can sign in', async () => {
    const { token } = await signIn('0552 775 771')
    const res = await call(token, body)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { user_id: string; phone: string }
    created.push(json.user_id)
    expect(json.phone).toBe(phone)

    const { data, error } = await client().auth.signInWithPassword({
      email: phoneToEmail(phone),
      password: 'secret-123',
    })
    expect(error).toBeNull()
    expect(data.user?.app_metadata.roles).toEqual(['accountant'])
  })

  it('same phone again → 409', async () => {
    const { token } = await signIn('0552 775 771')
    const res = await call(token, body)
    expect(res.status).toBe(409)
  })
})
