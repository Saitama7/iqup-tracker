// А8 data: reads go straight to Postgres (RLS: staff only), every write goes through
// the Edge Function create-user — roles live in the JWT (app_metadata), never set from the client.
import { queryOptions } from '@tanstack/react-query'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import { parseDateRu } from '@/lib/time'
import type { UsersSource } from './model'

const roleSchema = z.enum(['teacher', 'admin', 'accountant'])

const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  phone: z.string(),
  roles: z.array(roleSchema),
  is_active: z.boolean(),
})

const teacherSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  full_name: z.string(),
  phone: z.string().nullable(),
  teacher_rates: z.array(z.object({ percent: z.number(), valid_from: z.string() })),
  groups: z.array(
    z.object({ subject: subjectName, status: z.enum(['forming', 'active', 'archived']) }),
  ),
})

const signInSchema = z.object({ user_id: z.uuid(), last_sign_in_at: z.string().nullable() })

export const usersQuery = () =>
  queryOptions({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<UsersSource> => {
      const [profiles, teachers, signIns] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone, roles, is_active'),
        supabase
          .from('teachers')
          .select(
            'id, user_id, full_name, phone, teacher_rates(percent, valid_from), groups(subject:subjects(name), status)',
          ),
        supabase.rpc('user_last_sign_in'),
      ])
      if (profiles.error) throw profiles.error
      if (teachers.error) throw teachers.error
      if (signIns.error) throw signIns.error
      return {
        profiles: z.array(profileSchema).parse(profiles.data),
        teachers: z.array(teacherSchema).parse(teachers.data),
        lastSignIn: Object.fromEntries(
          z
            .array(signInSchema)
            .parse(signIns.data)
            .map((r) => [r.user_id, r.last_sign_in_at]),
        ),
      }
    },
  })

// ─── Form input ─────────────────────────────────────────────────────────────

const percentField = z
  .string()
  .trim()
  .transform((v) => Number(v.replace(',', '.')))
  .pipe(
    z
      .number({ error: 'Процент — число' })
      .gt(0, 'Процент — от 1 до 100')
      .lte(100, 'Процент — от 1 до 100'),
  )

const dateField = z.string().transform((v, ctx) => {
  const iso = parseDateRu(v)
  if (!iso) {
    ctx.addIssue({ code: 'custom', message: 'Дата в формате ДД.ММ.ГГГГ' })
    return z.NEVER
  }
  return iso
})

const phoneField = z.string().transform((v, ctx) => {
  try {
    return normalizePhone(v)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Телефон: 9 цифр после +996' })
    return z.NEVER
  }
})

const passwordField = z.string().min(8, 'Пароль — минимум 8 символов').max(72)

/** «Новый пользователь» form → create-user body. */
export const createUserForm = z
  .object({
    fullName: z.string().trim().min(1, 'Введите имя и фамилию').max(200),
    phone: phoneField,
    roles: z.array(roleSchema).min(1, 'Выберите роль'),
    percent: z.string(),
    validFrom: z.string(),
    password: passwordField,
  })
  .transform((v, ctx) => {
    const base = { full_name: v.fullName, phone: v.phone, roles: v.roles, password: v.password }
    if (!v.roles.includes('teacher')) return base
    const percent = percentField.safeParse(v.percent)
    const validFrom = dateField.safeParse(v.validFrom)
    if (!percent.success || !validFrom.success) {
      for (const issue of [...(percent.error?.issues ?? []), ...(validFrom.error?.issues ?? [])]) {
        ctx.addIssue({ code: 'custom', message: issue.message })
      }
      return z.NEVER
    }
    return { ...base, percent: percent.data, valid_from: validFrom.data }
  })

export type CreateUserInput = z.output<typeof createUserForm>

export const rateForm = z.object({ percent: percentField, validFrom: dateField })
export const fixRateForm = z.object({ percent: percentField })

// ─── Edge Function calls ────────────────────────────────────────────────────

/** Message from the Edge Function (`{ error, message }`) or a generic one. */
export class UsersApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'UsersApiError'
  }
}

const errorBodySchema = z.object({ error: z.string(), message: z.string().optional() })

/** A cold or stuck function must not spin the form forever (#66). */
export const USERS_FUNCTION_TIMEOUT_MS = 20_000

function isTimeout(e: unknown): boolean {
  if (!(e instanceof FunctionsFetchError)) return false
  const name = (e.context as { name?: unknown } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

async function callUsersFunction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await supabase.functions.invoke<T>('create-user', {
    body,
    timeout: USERS_FUNCTION_TIMEOUT_MS,
  })
  const error: unknown = res.error
  if (error) {
    if (isTimeout(error))
      throw new UsersApiError('Сервер не ответил, попробуйте ещё раз', 'timeout')
    if (error instanceof FunctionsHttpError) {
      const json: unknown = await (error.context as Response).json().catch(() => null)
      const parsed = errorBodySchema.safeParse(json)
      if (parsed.success) {
        throw new UsersApiError(parsed.data.message ?? 'Проверьте поля формы', parsed.data.error)
      }
    }
    throw new UsersApiError('Не удалось связаться с сервером. Попробуйте ещё раз.', null)
  }
  return res.data as T
}

export const createUser = (input: CreateUserInput) =>
  callUsersFunction<{ user_id: string; teacher_id: string | null; phone: string }>({
    action: 'create',
    ...input,
  })

/** fix — correct the rate starting at validFrom in place; new — add a rate from validFrom. */
export const updateRate = (input: {
  mode: 'fix' | 'new'
  teacherId: string
  percent: number
  validFrom: string
}) =>
  callUsersFunction<{ teacher_id: string }>({
    action: 'update_rate',
    mode: input.mode,
    teacher_id: input.teacherId,
    percent: input.percent,
    valid_from: input.validFrom,
  })

export const updateRoles = (input: { userId: string; roles: z.infer<typeof roleSchema>[] }) =>
  callUsersFunction<{ user_id: string }>({
    action: 'update_roles',
    user_id: input.userId,
    roles: input.roles,
  })

export const setActive = (input: { userId: string; active: boolean }) =>
  callUsersFunction<{ user_id: string }>({
    action: 'set_active',
    user_id: input.userId,
    active: input.active,
  })

export const resetPassword = (input: { phone: string; password: string }) =>
  callUsersFunction<{ user_id: string }>({ action: 'reset_password', ...input })
