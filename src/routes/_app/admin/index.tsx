import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '@/features/schedule/dashboard-page'

// А1 Дашборд on desktop, АМ1 «Центр сегодня» on the phone; role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/')({
  component: DashboardPage,
})
