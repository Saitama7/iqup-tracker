// Pure request handler for the create-user Edge Function: no Deno / network here,
// everything external comes through `deps` so it runs under Vitest with mocks.
import { z } from 'zod'
import { InvalidPhoneError, normalizePhone, phoneToEmail } from '../_shared/phone.ts'

export const ROLES = ['teacher', 'admin', 'accountant'] as const
export type Role = (typeof ROLES)[number]

export interface Caller {
  id: string
  roles: string[]
}

export interface CreateUserDeps {
  /** Verifies the caller's access token; null when missing/invalid. */
  getCaller(accessToken: string): Promise<Caller | null>
  createAuthUser(input: {
    email: string
    password: string
    roles: Role[]
  }): Promise<{ id: string } | { error: 'email_exists' }>
  deleteAuthUser(id: string): Promise<void>
  /** Inserts profiles row; teachers row is linked/created by the DB trigger (0003). */
  insertProfile(input: {
    id: string
    phone: string
    full_name: string
    roles: Role[]
  }): Promise<void>
  findTeacherIdByUser(userId: string): Promise<string | null>
  insertTeacherRate(input: {
    teacher_id: string
    percent: number
    valid_from: string
  }): Promise<void>
  findUserIdByPhone(phone: string): Promise<string | null>
  updatePassword(userId: string, password: string): Promise<void>
  findProfile(userId: string): Promise<{ roles: Role[]; is_active: boolean } | null>
  teacherExists(teacherId: string): Promise<boolean>
  /** Plain insert: an existing (teacher_id, valid_from) pair is reported, never overwritten. */
  addTeacherRate(input: {
    teacher_id: string
    percent: number
    valid_from: string
  }): Promise<'ok' | 'exists'>
  /** profiles.roles; the DB trigger links/creates the teachers row when teacher is added. */
  setProfileRoles(userId: string, roles: Role[]): Promise<void>
  /** app_metadata.roles — what RLS reads from the JWT. */
  setAuthRoles(userId: string, roles: Role[]): Promise<void>
  setProfileActive(userId: string, active: boolean): Promise<void>
  /** Auth ban: a deactivated user cannot sign in or refresh the session. */
  setAuthBanned(userId: string, banned: boolean): Promise<void>
  /** Today in Asia/Bishkek, YYYY-MM-DD. */
  today(): string
}

const phone = z.string().transform((value, ctx) => {
  try {
    return normalizePhone(value)
  } catch (e) {
    ctx.addIssue({
      code: 'custom',
      message: e instanceof InvalidPhoneError ? e.message : 'invalid phone',
    })
    return z.NEVER
  }
})
// Must match auth.minimum_password_length (8) — otherwise Auth rejects with 422 after validation passed.
const password = z.string().min(8, 'Пароль — минимум 8 символов').max(72)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'invalid date')
const roles = z
  .array(z.enum(ROLES))
  .min(1)
  .transform((r) => [...new Set(r)])

const createSchema = z.object({
  action: z.literal('create').optional(),
  phone,
  full_name: z.string().trim().min(1).max(200),
  roles,
  password,
  percent: z.number().gt(0).lte(100).optional(),
  valid_from: isoDate.optional(),
})

const resetSchema = z.object({
  action: z.literal('reset_password'),
  phone,
  password,
})

const updateRateSchema = z.object({
  action: z.literal('update_rate'),
  teacher_id: z.uuid(),
  percent: z.number().gt(0).lte(100),
  valid_from: isoDate,
})

const updateRolesSchema = z.object({
  action: z.literal('update_roles'),
  user_id: z.uuid(),
  roles,
})

const setActiveSchema = z.object({
  action: z.literal('set_active'),
  user_id: z.uuid(),
  active: z.boolean(),
})

const bodySchema = z.union([
  resetSchema,
  updateRateSchema,
  updateRolesSchema,
  setActiveSchema,
  createSchema,
])

export type HandlerResult = { status: number; body: Record<string, unknown> }

const fail = (status: number, error: string, message: string): HandlerResult => ({
  status,
  body: { error, message },
})

export async function handleCreateUser(
  req: { authorization: string | null; body: unknown },
  deps: CreateUserDeps,
): Promise<HandlerResult> {
  const token = req.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return fail(401, 'unauthorized', 'Нет токена')

  const caller = await deps.getCaller(token)
  if (!caller) return fail(401, 'unauthorized', 'Недействительный токен')
  if (!caller.roles.includes('admin')) return fail(403, 'forbidden', 'Только администратор')

  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    return { status: 400, body: { error: 'invalid_input', issues: parsed.error.issues } }
  }
  const input = parsed.data

  if (input.action === 'reset_password') {
    const userId = await deps.findUserIdByPhone(input.phone)
    if (!userId) return fail(404, 'not_found', 'Пользователь с таким телефоном не найден')
    await deps.updatePassword(userId, input.password)
    return { status: 200, body: { user_id: userId } }
  }

  if (input.action === 'update_rate') {
    if (!(await deps.teacherExists(input.teacher_id))) {
      return fail(404, 'not_found', 'Учитель не найден')
    }
    const added = await deps.addTeacherRate({
      teacher_id: input.teacher_id,
      percent: input.percent,
      valid_from: input.valid_from,
    })
    if (added === 'exists') {
      return fail(409, 'rate_exists', 'С этой даты процент уже задан — выберите другую дату')
    }
    return { status: 201, body: { teacher_id: input.teacher_id } }
  }

  if (input.action === 'update_roles') {
    if (input.user_id === caller.id && !input.roles.includes('admin')) {
      return fail(409, 'self_lockout', 'Нельзя снять роль администратора с себя')
    }
    const profile = await deps.findProfile(input.user_id)
    if (!profile) return fail(404, 'not_found', 'Пользователь не найден')
    await deps.setProfileRoles(input.user_id, input.roles)
    try {
      await deps.setAuthRoles(input.user_id, input.roles)
    } catch (e) {
      // JWT and profiles must agree: put the old roles back (the teachers row, if created, stays).
      await deps.setProfileRoles(input.user_id, profile.roles)
      throw e
    }
    return { status: 200, body: { user_id: input.user_id, roles: input.roles } }
  }

  if (input.action === 'set_active') {
    if (input.user_id === caller.id && !input.active) {
      return fail(409, 'self_lockout', 'Нельзя отключить самого себя')
    }
    const profile = await deps.findProfile(input.user_id)
    if (!profile) return fail(404, 'not_found', 'Пользователь не найден')
    // Ban first: a failure leaves the user active everywhere rather than half-disabled.
    await deps.setAuthBanned(input.user_id, !input.active)
    try {
      await deps.setProfileActive(input.user_id, input.active)
    } catch (e) {
      await deps.setAuthBanned(input.user_id, !profile.is_active)
      throw e
    }
    return { status: 200, body: { user_id: input.user_id, active: input.active } }
  }

  if (input.percent !== undefined && !input.roles.includes('teacher')) {
    return fail(400, 'invalid_input', 'Процент задаётся только учителю')
  }

  if (await deps.findUserIdByPhone(input.phone)) {
    return fail(409, 'phone_taken', 'Телефон уже занят')
  }

  const created = await deps.createAuthUser({
    email: phoneToEmail(input.phone),
    password: input.password,
    roles: input.roles,
  })
  if ('error' in created) return fail(409, 'phone_taken', 'Телефон уже занят')

  try {
    await deps.insertProfile({
      id: created.id,
      phone: input.phone,
      full_name: input.full_name,
      roles: input.roles,
    })

    let teacherId: string | null = null
    if (input.roles.includes('teacher')) {
      teacherId = await deps.findTeacherIdByUser(created.id)
      if (teacherId && input.percent !== undefined) {
        await deps.insertTeacherRate({
          teacher_id: teacherId,
          percent: input.percent,
          valid_from: input.valid_from ?? deps.today(),
        })
      }
    }

    return { status: 201, body: { user_id: created.id, teacher_id: teacherId, phone: input.phone } }
  } catch (e) {
    // Keep auth and profiles consistent: no login without a profile.
    await deps.deleteAuthUser(created.id)
    throw e
  }
}
