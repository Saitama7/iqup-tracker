import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { useIsDesktop } from '@/lib/use-is-desktop'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

// Phone and tablet shells pin the tab bar / action bar to the bottom: a bottom toast would cover
// the next tap (e.g. «Зачислить в группу» right after «Ученик добавлен», #38), so toasts go on top.
const SAFE_TOP = 'max(16px, env(safe-area-inset-top))'

function RootLayout() {
  const isDesktop = useIsDesktop()
  return (
    <>
      <Outlet />
      <Toaster
        position={isDesktop ? 'bottom-right' : 'top-center'}
        offset={{ top: SAFE_TOP }}
        mobileOffset={{ top: SAFE_TOP }}
      />
    </>
  )
}
