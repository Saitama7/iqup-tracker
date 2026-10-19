import type { QueryClient } from '@tanstack/react-query'
import { AUDIT_KEY } from '@/features/audit/api'
import { GROUPS_KEY } from '@/features/groups/api'
import { TEACHER_GROUPS_KEY } from '@/features/groups/teacher-api'
import { BALANCES_KEY, PAYMENTS_KEY, UNBILLED_KEY } from '@/features/payments/api'
import { PAYROLL_KEY } from '@/features/payroll/api'
import { ADMIN_LESSONS_KEY } from '@/features/schedule/api'
import { STUDENTS_KEY } from './api'

/** Everything a deleted group / student touches: lists, balances, payroll, lessons, the journal. */
export async function refreshAfterDelete(qc: QueryClient): Promise<void> {
  const keys: readonly (readonly string[])[] = [
    GROUPS_KEY,
    STUDENTS_KEY,
    [TEACHER_GROUPS_KEY],
    [BALANCES_KEY],
    [PAYMENTS_KEY],
    [UNBILLED_KEY],
    [PAYROLL_KEY],
    [ADMIN_LESSONS_KEY],
    [AUDIT_KEY],
  ]
  await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })))
}
