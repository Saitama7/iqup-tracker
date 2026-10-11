import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { useNow } from '@/lib/now'
import { formatDayLong } from '@/lib/time'

export const Route = createFileRoute('/_app/admin/')({
  component: AdminHome,
})

// Header as on АМ1; dashboard А1 is a later issue.
function AdminHome() {
  const now = useNow()
  return <ComingSoon eyebrow={formatDayLong(now)} title="Центр сегодня" />
}
