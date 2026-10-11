import { createFileRoute } from '@tanstack/react-router'
import { TeacherGroupsPage } from '@/features/groups/teacher-groups-page'
import { requireRole } from '@/lib/guards'

export const Route = createFileRoute('/_app/groups/')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: function GroupsRoute() {
    return <TeacherGroupsPage />
  },
})
