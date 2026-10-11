import { createFileRoute, redirect } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth/login-page'
import { getAuth } from '@/lib/auth'
import { homePath } from '@/lib/roles'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const auth = await getAuth()
    if (auth) throw redirect({ to: homePath(auth.roles), replace: true })
  },
  component: LoginPage,
})
