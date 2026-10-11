import { computeServerOffset, nowStore, type NowStore } from '@/lib/now'
import { supabase } from '@/lib/supabase/client'

// Server is the source of time (docs/02-architecture.md §7.1): one RPC at sign-in / app start.
// On failure the previous offset stays — the device clock is a usable fallback.
export async function syncServerClock(store: NowStore = nowStore): Promise<void> {
  const sentAt = Date.now()
  const { data, error } = await supabase.rpc('server_now')
  const receivedAt = Date.now()
  if (error) {
    console.warn('server_now() failed, using device clock', error)
    return
  }
  const serverMs = Date.parse(data)
  if (Number.isNaN(serverMs)) return
  store.setOffset(computeServerOffset(serverMs, sentAt, receivedAt))
}
