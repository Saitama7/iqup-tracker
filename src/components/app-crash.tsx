import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resetApp } from '@/lib/app-reset'

/** «Обновить приложение»: drops the service worker and caches, then reloads (#56). */
export function ResetAppButton({ variant }: { variant?: 'default' | 'outline' }) {
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() => {
        setPending(true)
        void resetApp()
      }}
    >
      {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      Обновить приложение
    </Button>
  )
}

/** Full-page fallback for an exception outside the router — never a white screen. */
export function AppCrash() {
  return (
    <main
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 text-center"
    >
      <TriangleAlert className="size-12 text-warn" aria-hidden />
      <h1 className="font-display text-xl font-bold text-ink">Что-то пошло не так</h1>
      <p className="max-w-sm text-ink-muted">
        Приложение не смогло загрузиться. Обновите его — данные сохранены на сервере и не пропадут.
      </p>
      <ResetAppButton />
    </main>
  )
}

interface State {
  failed: boolean
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App crashed', error, info.componentStack)
  }

  render() {
    return this.state.failed ? <AppCrash /> : this.props.children
  }
}
