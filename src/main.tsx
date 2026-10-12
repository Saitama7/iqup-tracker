import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { AppCrash, AppErrorBoundary } from '@/components/app-crash'
import { RouteError } from '@/components/route-error'
import { AuthProvider, getAuth } from '@/lib/auth'
import { queryClient } from '@/lib/query-client'
import { registerAppServiceWorker } from '@/lib/sw-update'
import { routeTree } from './routeTree.gen'
import '@/styles/index.css'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultErrorComponent: RouteError,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Sign-in / sign-out re-runs route guards (redirect to /login or the role's home).
const rerunGuards = () => void router.invalidate()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')
const root = createRoot(rootElement)

void getAuth()
  .catch(() => null)
  .then((initial) => {
    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider initial={initial} onChange={rerunGuards}>
              <RouterProvider router={router} />
            </AuthProvider>
          </QueryClientProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  })
  // Anything thrown while starting up gets the «Обновить приложение» screen, not a white page (#56).
  .catch((error: unknown) => {
    console.error('App failed to start', error)
    root.render(<AppCrash />)
  })

registerAppServiceWorker()
