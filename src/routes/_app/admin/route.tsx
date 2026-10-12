import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireRole } from '@/lib/guards'

// Admin section: one role guard for /admin and its screens. А10 «Журнал изменений» is the
// accountant's too, read-only (#45).
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context, location }) => {
    if (/^\/admin\/audit\/?$/.test(location.pathname)) {
      requireRole(context.auth, 'admin', 'accountant')
    } else {
      requireRole(context.auth, 'admin')
    }
  },
  component: Outlet,
})
