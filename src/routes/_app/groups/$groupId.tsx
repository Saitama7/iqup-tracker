import { createFileRoute } from '@tanstack/react-router'
import { TeacherGroupsPage } from '@/features/groups/teacher-groups-page'
import { requireRole } from '@/lib/guards'

export const Route = createFileRoute('/_app/groups/$groupId')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: GroupRoute,
})

function GroupRoute() {
  const { groupId } = Route.useParams()
  return <TeacherGroupsPage groupId={groupId} />
}
