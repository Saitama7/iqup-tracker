import { z } from 'zod'
import type { Database } from '@/lib/supabase/types.gen'

export type Role = Database['public']['Enums']['role']

const roleSchema = z.enum(['teacher', 'admin', 'accountant'])

// Roles live in the JWT (app_metadata.roles) — docs/02-architecture.md §5. Unknown values are dropped.
export function parseRoles(appMetadata: unknown): Role[] {
  const raw: unknown =
    appMetadata && typeof appMetadata === 'object' && 'roles' in appMetadata
      ? appMetadata.roles
      : undefined
  if (!Array.isArray(raw)) return []
  const roles = raw.flatMap((r) => {
    const parsed = roleSchema.safeParse(r)
    return parsed.success ? [parsed.data] : []
  })
  return [...new Set(roles)]
}

export type HomePath = '/admin' | '/payroll' | '/today' | '/profile'

// Landing page after sign-in: admin wins over teacher (Каныкей = admin + teacher → /admin).
export function homePath(roles: readonly Role[]): HomePath {
  if (roles.includes('admin')) return '/admin'
  if (roles.includes('accountant')) return '/payroll'
  if (roles.includes('teacher')) return '/today'
  return '/profile'
}

export function hasRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role)
}
