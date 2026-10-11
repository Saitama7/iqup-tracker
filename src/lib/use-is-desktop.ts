import { useSyncExternalStore } from 'react'

// Phone and desktop share routes; only the shell differs (docs/06-design.md).
export const DESKTOP_QUERY = '(min-width: 900px)'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', onChange)
  return () => {
    mql.removeEventListener('change', onChange)
  }
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP_QUERY).matches)
}
