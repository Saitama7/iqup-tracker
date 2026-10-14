import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { GroupPage } from '@/features/groups/group-page'
import { GROUP_TABS } from '@/features/lessons/return-to'

// The tab lives in the URL (?tab=lessons): «назад» from a lesson opens the same tab (#89).
const searchSchema = z.object({
  tab: z.enum(GROUP_TABS).optional().catch(undefined),
})

// А4 Группа (docs/design/AdminGroup.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/groups/$groupId')({
  validateSearch: searchSchema,
  component: GroupRoute,
})

function GroupRoute() {
  const { groupId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <GroupPage
      groupId={groupId}
      tab={tab}
      onTabChange={(next) => {
        void navigate({ search: { tab: next === 'students' ? undefined : next }, replace: true })
      }}
    />
  )
}
