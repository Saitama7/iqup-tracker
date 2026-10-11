import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { DesktopShell } from '@/components/shell/desktop-shell'
import { MobileShell } from '@/components/shell/mobile-shell'
import { getAuth, useMaybeSession } from '@/lib/auth'
import { syncServerClock } from '@/lib/server-clock'
import { useIsDesktop } from '@/lib/use-is-desktop'

// Everything behind sign-in. Children guard their role with requireRole() → 403.
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const auth = await getAuth()
    if (!auth) throw redirect({ to: '/login', replace: true })
    return { auth }
  },
  component: AppLayout,
})

function AppLayout() {
  const auth = useMaybeSession()
  const isDesktop = useIsDesktop()

  // Align the local clock with the server once per sign-in (docs/02-architecture.md §7.1).
  const userId = auth?.userId
  useEffect(() => {
    if (userId) void syncServerClock()
  }, [userId])

  // Signed out mid-session: guards are re-running, the redirect to /login follows.
  if (!auth) return null

  const Shell = isDesktop ? DesktopShell : MobileShell
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}
