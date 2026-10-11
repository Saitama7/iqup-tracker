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
const password = z.string().min(6, 'Пароль — минимум 6 символов').max(72)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const createSchema = z.object({
  action: z.literal('create').optional(),
  phone,
  full_name: z.string().trim().min(1).max(200),
  roles: z
    .array(z.enum(ROLES))
    .min(1)
    .transform((r) => [...new Set(r)]),
  password,
  percent: z.number().gt(0).lte(100).optional(),
  valid_from: isoDate.optional(),
})

const resetSchema = z.object({
  action: z.literal('reset_password'),
  phone,
  password,
})

const bodySchema = z.union([resetSchema, createSchema])

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
