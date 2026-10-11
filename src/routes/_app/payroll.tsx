import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { requireRole } from '@/lib/guards'

export const Route = createFileRoute('/_app/payroll')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'accountant')
  },
  component: () => <ComingSoon title="Расчёт ЗП" />,
})
