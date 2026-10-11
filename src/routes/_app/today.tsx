import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { requireRole } from '@/lib/guards'

export const Route = createFileRoute('/_app/today')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: () => <ComingSoon title="Сегодня" />,
})
