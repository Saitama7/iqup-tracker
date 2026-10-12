import { describe, expect, it, vi } from 'vitest'
import { resetApp } from './app-reset'

function fakes() {
  const regs = [
    { unregister: vi.fn(() => Promise.resolve(true)) },
    { unregister: vi.fn(() => Promise.resolve(true)) },
  ]
  const serviceWorker = {
    getRegistrations: vi.fn(() => Promise.resolve(regs as unknown as ServiceWorkerRegistration[])),
  }
  const cacheStorage = {
    keys: vi.fn(() => Promise.resolve(['workbox-precache-v2', 'runtime'])),
    delete: vi.fn(() => Promise.resolve(true)),
  }
  const reload = vi.fn()
  return { regs, serviceWorker, cacheStorage, reload }
}

describe('resetApp', () => {
  it('unregisters every service worker, deletes every cache, then reloads', async () => {
    const { regs, serviceWorker, cacheStorage, reload } = fakes()
    await resetApp({ serviceWorker, cacheStorage, reload })
    for (const r of regs) expect(r.unregister).toHaveBeenCalledOnce()
    expect(cacheStorage.delete).toHaveBeenCalledWith('workbox-precache-v2')
    expect(cacheStorage.delete).toHaveBeenCalledWith('runtime')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('still reloads when a step fails', async () => {
    const { serviceWorker, cacheStorage, reload } = fakes()
    serviceWorker.getRegistrations.mockRejectedValue(new Error('SecurityError'))
    cacheStorage.delete.mockRejectedValue(new Error('boom'))
    await resetApp({ serviceWorker, cacheStorage, reload })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads without service worker or Cache Storage support', async () => {
    const reload = vi.fn()
    await resetApp({ serviceWorker: undefined, cacheStorage: undefined, reload })
    expect(reload).toHaveBeenCalledOnce()
  })
})
