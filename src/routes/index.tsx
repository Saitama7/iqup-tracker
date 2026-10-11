import { createFileRoute, redirect } from '@tanstack/react-router'
import { getAuth } from '@/lib/auth'
import { homePath } from '@/lib/roles'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const auth = await getAuth()
    throw redirect({ to: auth ? homePath(auth.roles) : '/login', replace: true })
  },
})
