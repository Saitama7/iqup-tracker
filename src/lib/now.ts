import { useSyncExternalStore } from 'react'
import { queryClient } from '@/lib/query-client'

// Local clock — docs/02-architecture.md §7.1.
// now = Date.now() + serverOffset; ticks every 30 s; on wake-up (tab visible, focus, online)
// ticks immediately and asks the caller to refetch (invalidateQueries).

export interface NowStore {
  subscribe: (listener: () => void) => () => void
  getNow: () => number
  getOffset: () => number
  setOffset: (offsetMs: number) => void
  tick: () => void
}

interface Options {
  intervalMs?: number
  clock?: () => number
  onWake?: () => void
}

const WAKE_EVENTS = [
  ['document', 'visibilitychange'],
  ['window', 'focus'],
  ['window', 'online'],
] as const

// visibilitychange and focus usually fire together — refetch once.
const WAKE_DEDUP_MS = 1_000

export function createNowStore({
  intervalMs = 30_000,
  clock = Date.now,
  onWake,
}: Options = {}): NowStore {
  let offset = 0
  let now = clock()
  let lastWake = -Infinity
  let timer: ReturnType<typeof setInterval> | undefined
  const listeners = new Set<() => void>()

  const tick = () => {
    now = clock() + offset
    for (const l of listeners) l()
  }

  const handleWake = (event: Event) => {
    if (event.type === 'visibilitychange' && document.visibilityState !== 'visible') return
    tick()
    const at = clock()
    if (at - lastWake < WAKE_DEDUP_MS) return
    lastWake = at
    onWake?.()
  }

  const start = () => {
    timer = setInterval(tick, intervalMs)
    for (const [target, type] of WAKE_EVENTS) {
      ;(target === 'document' ? document : window).addEventListener(type, handleWake)
    }
    tick() // the snapshot may be stale since the last subscriber left
  }

  const stop = () => {
    clearInterval(timer)
    timer = undefined
    for (const [target, type] of WAKE_EVENTS) {
      ;(target === 'document' ? document : window).removeEventListener(type, handleWake)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
    getNow: () => now,
    getOffset: () => offset,
    setOffset(offsetMs) {
      offset = offsetMs
      tick()
    },
    tick,
  }
}

/** Offset of the server clock from ours, assuming the reply was produced mid-round-trip. */
export function computeServerOffset(serverMs: number, sentAt: number, receivedAt: number): number {
  return Math.round(serverMs - (sentAt + receivedAt) / 2)
}

export const nowStore = createNowStore({
  onWake: () => void queryClient.invalidateQueries(),
})

/** Current server-aligned time in ms; re-renders every 30 s and on wake-up. */
export function useNow(store: NowStore = nowStore): number {
  return useSyncExternalStore(store.subscribe, store.getNow)
}
