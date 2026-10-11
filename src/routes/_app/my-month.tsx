import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { requireRole } from '@/lib/guards'

export const Route = createFileRoute('/_app/my-month')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: () => <ComingSoon title="Мой месяц" />,
})
