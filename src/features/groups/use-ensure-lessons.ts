import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ensureLessons } from './api'
import { horizon } from './model'

/**
 * Lessons up to the 8-week horizon for every running group (RPC ensure_lessons, 0008) — on open of
 * А1 Дашборд and А3 Группы. New rows → the lesson lists refetch.
 */
export function useEnsureLessons(today: string) {
  const queryClient = useQueryClient()
  const until = horizon(today)
  useEffect(() => {
    let cancelled = false
    ensureLessons(until)
      .then(async (created) => {
        if (!cancelled && created > 0) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['group-lessons'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-lessons'] }),
          ])
        }
      })
      .catch(() => {
        // not fatal: the screen does not depend on it, the next open retries
      })
    return () => {
      cancelled = true
    }
  }, [queryClient, until])
}
