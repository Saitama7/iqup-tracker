import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TeacherGroupsPage } from '@/features/groups/teacher-groups-page'
import { GROUP_TABS } from '@/features/lessons/return-to'
import { requireRole } from '@/lib/guards'

// Tab of the open group and the day filter live in the URL: «назад» from a lesson restores them (#89).
const searchSchema = z.object({
  tab: z.enum(GROUP_TABS).optional().catch(undefined),
  days: z.string().max(40).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/groups/')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: GroupsRoute,
})

function GroupsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TeacherGroupsPage
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
