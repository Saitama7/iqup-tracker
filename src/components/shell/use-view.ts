import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useSession } from '@/lib/auth'
import { resolveView, viewsFor, type View } from './nav'

const KEY = 'iqup.view'

function readLastView(): View | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v === 'teacher' || v === 'admin' || v === 'accountant' ? v : null
  } catch {
    return null // private mode / storage disabled
  }
}

export function useView(): { view: View | null; views: View[] } {
  const { roles } = useSession()
  const pathname = useLocation({ select: (l) => l.pathname })
  const view = resolveView(pathname, roles, readLastView())

  useEffect(() => {
    if (!view) return
    try {
      sessionStorage.setItem(KEY, view)
    } catch {
      // ignore
    }
  }, [view])

  return { view, views: viewsFor(roles) }
}
