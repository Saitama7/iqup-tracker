import { createFileRoute } from '@tanstack/react-router'
import { UsersPage } from '@/features/users/users-page'

// А8 Учителя и доступ (docs/design/AdminUsers.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
})
