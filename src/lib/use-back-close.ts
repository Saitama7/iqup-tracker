import { useEffect, useRef } from 'react'
import { useIsDesktop } from './use-is-desktop'

// Phone sheets and dialogs close on the system «назад» (Android, history.back()) instead of
// leaving the page (#57): an open overlay owns one history entry with the same URL.
// The entry is pushed straight into window.history with the router's own state (same
// __TSR_key / __TSR_index), so the router neither reloads nor resets the scroll on open.

const KEY = '__iqupOverlay'

/** Open overlays, bottom first; a popstate closes every overlay above the entry it lands on. */
const stack: number[] = []
let nextId = 1

function overlayOf(state: unknown): number | null {
  if (state && typeof state === 'object' && KEY in state) {
    const id = (state as Record<string, unknown>)[KEY]
    return typeof id === 'number' ? id : null
  }
  return null
}

export function useBackClose(open: boolean, onClose: () => void): void {
  const isDesktop = useIsDesktop()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  const active = open && !isDesktop

  useEffect(() => {
    if (!active) return
    const id = nextId++
    const base: unknown = window.history.state
    const state = { ...(base && typeof base === 'object' ? base : {}), [KEY]: id }
    // the entry of an overlay that just closed (its back() is still pending) — StrictMode's
    // remount, or a dialog opened right after another: take it over instead of stacking (#68)
    const orphan = overlayOf(base)
    if (orphan !== null && !stack.includes(orphan)) {
      window.history.replaceState(state, '', window.location.href)
    } else {
      window.history.pushState(state, '', window.location.href)
    }
    stack.push(id)
    let leftByHistory = false

    const onPopState = (e: PopStateEvent) => {
      const landed = overlayOf(e.state)
      const depth = landed === null ? -1 : stack.indexOf(landed)
      if (stack.indexOf(id) > depth) {
        leftByHistory = true
        closeRef.current()
      }
    }
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (leftByHistory) return
      // Closed by the UI: drop our entry — unless a navigation (a link in the sheet) already
      // moved on from it; the router commits its push after this tick.
      setTimeout(() => {
        if (overlayOf(window.history.state) === id) window.history.back()
      }, 0)
    }
  }, [active])
}
