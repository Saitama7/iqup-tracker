// Edge Function create-user (Deno). Admin-only: create a phone login, reset its password,
// change roles / percent, deactivate (issue #6).
// Logic lives in handler.ts; this file wires Supabase clients and HTTP.
import { createClient } from '@supabase/supabase-js'
import { type CreateUserDeps, handleCreateUser } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Service role stays inside the function (secrets of Supabase Edge Functions only).
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

const deps: CreateUserDeps = {
  async getCaller(token) {
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) return null
    const roles = data.user.app_metadata?.roles
    return { id: data.user.id, roles: Array.isArray(roles) ? roles.map(String) : [] }
  },
  async createAuthUser({ email, password, roles }) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { roles },
    })
    if (error) {
      // Only a duplicate email is a 409; other 422s (weak password etc.) are real errors.
      if (error.code === 'email_exists') return { error: 'email_exists' }
      throw new Error(error.message)
    }
    return { id: data.user.id }
  },
  async deleteAuthUser(id) {
    await admin.auth.admin.deleteUser(id)
  },
  async insertProfile(row) {
    const { error } = await admin.from('profiles').insert(row)
    check(error)
  },
  async findTeacherIdByUser(userId) {
    const { data, error } = await admin
      .from('teachers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()
    check(error)
    return data?.id ?? null
  },
  async insertTeacherRate(row) {
    const { error } = await admin.from('teacher_rates').insert(row)
    check(error)
  },
  async findUserIdByPhone(phone) {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()
    check(error)
    return data?.id ?? null
  },
  async updatePassword(userId, password) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    check(error)
  },
  async findProfile(userId) {
    const { data, error } = await admin
      .from('profiles')
      .select('roles, is_active')
      .eq('id', userId)
      .maybeSingle()
    check(error)
    return data
  },
  async teacherExists(teacherId) {
    const { data, error } = await admin
      .from('teachers')
      .select('id')
      .eq('id', teacherId)
      .maybeSingle()
    check(error)
    return data !== null
  },
  async addTeacherRate(row) {
    const { error } = await admin.from('teacher_rates').insert(row)
    if (error?.code === '23505') return 'exists'
    check(error)
    return 'ok'
  },
  async fixTeacherRate(row) {
    const { data, error } = await admin
      .from('teacher_rates')
      .update({ percent: row.percent })
      .eq('teacher_id', row.teacher_id)
      .eq('valid_from', row.valid_from)
      .select('id')
    check(error)
    return (data ?? []).length > 0
  },
  async setProfileRoles(userId, roles) {
    const { error } = await admin.from('profiles').update({ roles }).eq('id', userId)
    check(error)
  },
  async setAuthRoles(userId, roles) {
    // app_metadata is merged by Auth, so `roles` is replaced and other keys survive.
    const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { roles } })
    check(error)
  },
  async setProfileActive(userId, active) {
    const { error } = await admin.from('profiles').update({ is_active: active }).eq('id', userId)
    check(error)
  },
  async setAuthBanned(userId, banned) {
    // ~100 years; 'none' lifts the ban.
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: banned ? '876000h' : 'none',
    })
    check(error)
  },
  today: () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10), // Asia/Bishkek, UTC+6, no DST
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: cors })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400, headers: cors })
  }

  try {
    const result = await handleCreateUser(
      { authorization: req.headers.get('Authorization'), body },
      deps,
    )
    return Response.json(result.body, { status: result.status, headers: cors })
  } catch (e) {
    console.error('create-user failed', e)
    return Response.json(
      { error: 'internal', message: 'Ошибка сервера' },
      { status: 500, headers: cors },
    )
  }
})
