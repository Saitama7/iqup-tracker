import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AuditPage } from '@/features/audit/audit-page'
import { ENTITY_LABEL } from '@/features/audit/describe'
import { KINDS, PERIODS, SYSTEM_ACTOR } from '@/features/audit/model'

// Filters live in the URL: a filtered journal can be shared and survives reload.
const searchSchema = z.object({
  kind: z.enum(KINDS).optional().catch(undefined),
  entity: z
    .string()
    .refine((v) => v in ENTITY_LABEL)
    .optional()
    .catch(undefined),
  actor: z
    .union([z.uuid(), z.literal(SYSTEM_ACTOR)])
    .optional()
    .catch(undefined),
  period: z.enum(PERIODS).optional().catch(undefined),
})

// А10 Журнал изменений (docs/design/AuditLog.dc.html); role guard (admin, accountant) — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/audit')({
  validateSearch: searchSchema,
  component: AuditRoute,
})

function AuditRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AuditPage
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
