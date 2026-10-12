import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PAYMENT_TABS, PaymentsPage } from '@/features/payments/payments-page'

// Month, tab, filters and the student to record a payment for (from А5 / А6) live in the URL.
const searchSchema = z.object({
  tab: z.enum(PAYMENT_TABS).optional().catch(undefined),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .catch(undefined),
  method: z.enum(['cash', 'mbank']).optional().catch(undefined),
  group: z.uuid().optional().catch(undefined),
  student: z.uuid().optional().catch(undefined),
})

// А7 Оплаты (docs/design/AdminPayments.dc.html, АМ3 AdminMobilePayment.dc.html); role guard (admin;
// accountant read-only, И43) — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/payments')({
  validateSearch: searchSchema,
  component: PaymentsRoute,
})

function PaymentsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PaymentsPage
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true })
      }}
    />
  )
}
