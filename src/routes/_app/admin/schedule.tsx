import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SchedulePage, type ScheduleSearch } from '@/features/schedule/schedule-page'

// Week (any day of it; on the phone — the day shown), teacher and «не подтверждено» live in the URL:
// the dashboard links here with ?filter=unconfirmed and a filtered week survives reload.
const searchSchema = z.object({
  date: z.iso.date().optional().catch(undefined),
  teacher: z.uuid().optional().catch(undefined),
  filter: z.enum(['unconfirmed']).optional().catch(undefined),
})

// А2 Расписание (docs/design/AdminSchedule.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/schedule')({
  validateSearch: searchSchema,
  component: ScheduleRoute,
})

function ScheduleRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <SchedulePage
      search={search}
      onSearchChange={(next: ScheduleSearch) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
