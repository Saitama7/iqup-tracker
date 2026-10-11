import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { RouteError } from '@/components/route-error'
import { AuthProvider, getAuth } from '@/lib/auth'
import { queryClient } from '@/lib/query-client'
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
        <QueryClientProvider client={queryClient}>
          <AuthProvider initial={initial} onChange={rerunGuards}>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
  })
