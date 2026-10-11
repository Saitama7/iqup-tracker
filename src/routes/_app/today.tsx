import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { firstName, useDisplayName } from '@/components/shell/shell-parts'
import { requireRole } from '@/lib/guards'
import { useNow } from '@/lib/now'
import { formatDayLong } from '@/lib/time'

export const Route = createFileRoute('/_app/today')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: TodayPage,
})

// Header as on У2 / УД1; the screen itself is a later issue.
function TodayPage() {
  const now = useNow()
  const name = firstName(useDisplayName())
  return <ComingSoon eyebrow={formatDayLong(now)} title={name ? `Сегодня, ${name}` : 'Сегодня'} />
}
