import { act, renderHook } from '@testing-library/react'
import { computeServerOffset, createNowStore, useNow } from './now'

const T0 = Date.parse('2026-10-11T09:00:00Z')

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setVisibility('visible')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks every 30 s', () => {
    const store = createNowStore()
    const { result } = renderHook(() => useNow(store))
    expect(result.current).toBe(T0)

    act(() => {
      vi.advanceTimersByTime(29_999)
    })
    expect(result.current).toBe(T0) // no re-render between ticks

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(T0 + 30_000)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(result.current).toBe(T0 + 60_000)
  })

  it('applies server offset', () => {
    const store = createNowStore()
    const { result } = renderHook(() => useNow(store))
    // phone clock is 1.5 min ahead
    act(() => {
      store.setOffset(-90_000)
    })
    expect(result.current).toBe(T0 - 90_000)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(result.current).toBe(T0 + 30_000 - 90_000)
  })

  it('on visibilitychange → visible ticks immediately and refetches', () => {
    const onWake = vi.fn()
    const store = createNowStore({ onWake })
    const { result } = renderHook(() => useNow(store))

    // Timers are frozen in background Safari: the clock moved, interval did not fire.
    vi.setSystemTime(T0 + 5 * 60_000)
    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(T0)
    expect(onWake).not.toHaveBeenCalled()

    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(T0 + 5 * 60_000)
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('focus and online also wake; simultaneous events refetch once', () => {
    const onWake = vi.fn()
    const store = createNowStore({ onWake })
    renderHook(() => useNow(store))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(onWake).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(onWake).toHaveBeenCalledTimes(2)
  })

  it('stops timers and listeners after the last subscriber leaves', () => {
    const onWake = vi.fn()
    const store = createNowStore({ onWake })
    const { unmount } = renderHook(() => useNow(store))
    unmount()

    window.dispatchEvent(new Event('focus'))
    expect(onWake).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('computeServerOffset', () => {
  it('uses the middle of the round trip', () => {
    // sent at 1000, received at 1200 → server stamped at ~1100 local
    expect(computeServerOffset(61_100, 1_000, 1_200)).toBe(60_000)
  })
})
