import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { requireRole } from '@/lib/guards'

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'admin')
  },
  component: () => <ComingSoon title="Сегодня в центре" />,
})
