export interface ResetDeps {
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>
  cacheStorage?: Pick<CacheStorage, 'keys' | 'delete'>
  reload?: () => void
}

/**
 * «Обновить приложение»: drop every service worker and Cache Storage entry, then reload, so the
 * next load comes straight from the network — the way out of a stale precached bundle (#56).
 * Never throws: a failed step must not keep the user on the error screen.
 */
export async function resetApp({
  serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
  cacheStorage = typeof caches === 'undefined' ? undefined : caches,
  reload = () => {
    window.location.reload()
  },
}: ResetDeps = {}): Promise<void> {
  await Promise.allSettled([
    serviceWorker
      ?.getRegistrations()
      .then((regs) => Promise.allSettled(regs.map((r) => r.unregister()))),
    cacheStorage
      ?.keys()
      .then((keys) => Promise.allSettled(keys.map((key) => cacheStorage.delete(key)))),
  ])
  reload()
}

/** Commit the bundle was built from (`CF_PAGES_COMMIT_SHA`), short; `dev` locally. */
export const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA || 'dev').slice(0, 7)
