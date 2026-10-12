import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TRIAL_TABS, TrialsPage } from '@/features/trials/trials-page'

// Tab and the group to book on («+ На пробное» from А4) live in the URL.
const searchSchema = z.object({
  tab: z.enum(TRIAL_TABS).optional().catch(undefined),
  group: z.uuid().optional().catch(undefined),
})

// А11 Пробные занятия (docs/design/AdminTrials.dc.html); role guard (admin) — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/trials')({
  validateSearch: searchSchema,
  component: TrialsRoute,
})

function TrialsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TrialsPage
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
