import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireRole } from '@/lib/guards'

// Admin section: one role guard for /admin and its screens.
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'admin')
  },
  component: Outlet,
})
