import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { useBackClose } from './use-back-close'

// jsdom: history.back() is async and fires popstate, as in a browser.
function setViewport(desktop: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: desktop,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList
}

const popped = () =>
  new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true })
  })

function useOverlay(initial: boolean) {
  const [open, setOpen] = useState(initial)
  useBackClose(open, () => {
    setOpen(false)
  })
  return { open, setOpen }
}

describe('useBackClose (#57)', () => {
  beforeEach(() => {
    setViewport(false)
    window.history.replaceState({ page: 1 }, '', '/admin/students')
  })

  it('the system back closes an open sheet and stays on the page', async () => {
    const before = window.history.length
    const { result } = renderHook(() => useOverlay(true))
    expect(window.history.length).toBe(before + 1)
    expect(window.history.state).toMatchObject({ page: 1 })

    const pop = popped()
    window.history.back()
    await act(() => pop)
    expect(result.current.open).toBe(false)
    expect(window.location.pathname).toBe('/admin/students')
    expect(window.history.state).toEqual({ page: 1 })
  })

  it('closing from the UI drops the pushed entry', async () => {
    const { result } = renderHook(() => useOverlay(true))
    const pop = popped()
    act(() => {
      result.current.setOpen(false)
    })
    await act(() => pop)
    expect(window.history.state).toEqual({ page: 1 })
  })

  it('a back from a nested dialog closes only the top one', async () => {
    const outer = renderHook(() => useOverlay(true))
    const inner = renderHook(() => useOverlay(true))
    const pop = popped()
    window.history.back()
    await act(() => pop)
    expect(inner.result.current.open).toBe(false)
    expect(outer.result.current.open).toBe(true)
    outer.unmount()
  })

  it('desktop: no history entry', () => {
    setViewport(true)
    const before = window.history.length
    renderHook(() => useOverlay(true))
    expect(window.history.length).toBe(before)
  })
})
