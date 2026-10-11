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

describe('Edge Function create-user: roles, rate, access (#6)', () => {
  const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const phone = `996598${String(Date.now()).slice(-6)}`
  let userId = ''

  const call = async (body: unknown) => {
    const { token } = await signIn('0552 775 771')
    return fetch(`${env.functionsUrl}/create-user`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    const res = await call({
      phone,
      full_name: 'Roles Test',
      roles: ['accountant'],
      password: 'secret-123',
    })
    expect(res.status).toBe(201)
    userId = ((await res.json()) as { user_id: string }).user_id
  })

  afterAll(async () => {
    await service.from('teachers').delete().eq('phone', phone)
    if (userId) await service.auth.admin.deleteUser(userId)
  })

  it('update_roles adds teacher: JWT roles + linked teachers row', async () => {
    const res = await call({
      action: 'update_roles',
      user_id: userId,
      roles: ['accountant', 'teacher'],
    })
    expect(res.status).toBe(200)

    const { data } = await client().auth.signInWithPassword({
      email: phoneToEmail(phone),
      password: 'secret-123',
    })
    expect(data.user?.app_metadata.roles).toEqual(['accountant', 'teacher'])
    const { data: teacher } = await service
      .from('teachers')
      .select('id, user_id')
      .eq('phone', phone)
      .single()
    expect(teacher?.user_id).toBe(userId)
  })

  it('update_rate: new appends rows, fix corrects one in place', async () => {
    const { data: teacher } = await service
      .from('teachers')
      .select('id')
      .eq('phone', phone)
      .single()
    const teacherId = teacher?.id
    expect(
      (
        await call({
          action: 'update_rate',
          mode: 'new',
          teacher_id: teacherId,
          percent: 45,
          valid_from: '2026-09-01',
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await call({
          action: 'update_rate',
          mode: 'new',
          teacher_id: teacherId,
          percent: 50,
          valid_from: '2026-11-01',
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await call({
          action: 'update_rate',
          mode: 'new',
          teacher_id: teacherId,
          percent: 99,
          valid_from: '2026-09-01',
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await call({
          action: 'update_rate',
          mode: 'fix',
          teacher_id: teacherId,
          percent: 47,
          valid_from: '2026-09-01',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call({
          action: 'update_rate',
          mode: 'fix',
          teacher_id: teacherId,
          percent: 47,
          valid_from: '2026-10-01',
        })
      ).status,
    ).toBe(404)
    const { data: rates } = await service
      .from('teacher_rates')
      .select('percent, valid_from')
      .eq('teacher_id', teacherId ?? '')
      .order('valid_from')
    expect(rates).toEqual([
      { percent: 47, valid_from: '2026-09-01' },
      { percent: 50, valid_from: '2026-11-01' },
    ])
  })

  it('set_active false blocks sign-in, true restores it', async () => {
    expect((await call({ action: 'set_active', user_id: userId, active: false })).status).toBe(200)
    const blocked = await client().auth.signInWithPassword({
      email: phoneToEmail(phone),
      password: 'secret-123',
    })
    expect(blocked.error).not.toBeNull()
    const { data: profile } = await service
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .single()
    expect(profile?.is_active).toBe(false)

    expect((await call({ action: 'set_active', user_id: userId, active: true })).status).toBe(200)
    const restored = await client().auth.signInWithPassword({
      email: phoneToEmail(phone),
      password: 'secret-123',
    })
    expect(restored.error).toBeNull()
  })
})
