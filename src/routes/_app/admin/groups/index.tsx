import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { GroupsPage } from '@/features/groups/groups-page'

// Search and status tab live in the URL: a filtered list survives reload.
const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  tab: z.enum(['active', 'forming', 'archived']).optional().catch(undefined),
})

// А3 Группы (docs/design/AdminGroups.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/groups/')({
  validateSearch: searchSchema,
  component: GroupsRoute,
})

function GroupsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <GroupsPage
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
