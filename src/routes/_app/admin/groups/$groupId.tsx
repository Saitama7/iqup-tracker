import { createFileRoute } from '@tanstack/react-router'
import { GroupPage } from '@/features/groups/group-page'

// А4 Группа (docs/design/AdminGroup.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/groups/$groupId')({
  component: GroupRoute,
})

function GroupRoute() {
  const { groupId } = Route.useParams()
  return <GroupPage groupId={groupId} />
}
