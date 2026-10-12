import type { Auth } from '@/lib/auth'
import { hasRole, type Role } from '@/lib/roles'

// Thrown from route beforeLoad; the router's error component renders the 403 page in place.
// UI-only check — the real boundary is RLS (invariant 7).
export class ForbiddenError extends Error {
  constructor() {
    super('Нет доступа')
    this.name = 'ForbiddenError'
  }
}

/** Passes when the user has any of the roles: `requireRole(auth, 'accountant', 'admin')`. */
export function requireRole(auth: Auth, ...roles: [Role, ...Role[]]): void {
  if (!roles.some((role) => hasRole(auth.roles, role))) throw new ForbiddenError()
}
