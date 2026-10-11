import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ForbiddenError } from '@/lib/guards'

export function Forbidden() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <ShieldAlert className="size-12 text-burned" aria-hidden />
      <p className="font-display text-5xl font-extrabold text-ink">403</p>
      <h1 className="font-display text-xl font-bold text-ink">Нет доступа</h1>
      <p className="text-ink-muted">У вашей роли нет доступа к этому разделу.</p>
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    </section>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  if (error instanceof ForbiddenError) return <Forbidden />
  return (
    <section
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <TriangleAlert className="size-12 text-warn" aria-hidden />
      <h1 className="font-display text-xl font-bold text-ink">Что-то пошло не так</h1>
      <p className="text-ink-muted">Проверьте интернет и попробуйте ещё раз.</p>
      <Button onClick={reset}>Повторить</Button>
    </section>
  )
}
