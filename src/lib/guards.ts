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

export function requireRole(auth: Auth, role: Role): void {
  if (!hasRole(auth.roles, role)) throw new ForbiddenError()
}
