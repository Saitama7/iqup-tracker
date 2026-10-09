import { QueryClient } from '@tanstack/react-query'

// Sync defaults — docs/02-architecture.md §7.1
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 30_000,
      },
    },
  })
}

export const queryClient = createQueryClient()
