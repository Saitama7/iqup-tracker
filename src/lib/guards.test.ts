import type { Session } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { Auth } from '@/lib/auth'
import type { Role } from '@/lib/roles'
import { ForbiddenError, requireRole } from './guards'

const auth = (roles: Role[]): Auth => ({ session: {} as Session, userId: 'u', roles })

describe('requireRole', () => {
  it('passes with the role', () => {
    expect(() => {
      requireRole(auth(['teacher']), 'teacher')
    }).not.toThrow()
  })

  it('throws ForbiddenError without it', () => {
    expect(() => {
      requireRole(auth(['teacher']), 'admin')
    }).toThrow(ForbiddenError)
    expect(() => {
      requireRole(auth([]), 'teacher')
    }).toThrow(ForbiddenError)
  })

  it('any of several roles (/payroll: accountant or admin, И2)', () => {
    for (const roles of [['accountant'], ['admin'], ['admin', 'teacher']] satisfies Role[][]) {
      expect(() => {
        requireRole(auth(roles), 'accountant', 'admin')
      }).not.toThrow()
    }
    expect(() => {
      requireRole(auth(['teacher']), 'accountant', 'admin')
    }).toThrow(ForbiddenError)
  })
})
