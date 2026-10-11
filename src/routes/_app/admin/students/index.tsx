import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StudentsPage } from '@/features/students/students-page'

// Search and group filter live in the URL: a filtered list can be shared and survives reload.
const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  group: z.string().optional().catch(undefined),
})

// А5 Ученики (docs/design/AdminStudents.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/students/')({
  validateSearch: searchSchema,
  component: StudentsRoute,
})

function StudentsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <StudentsPage
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
