import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={cn('font-display text-2xl font-bold text-ink lg:text-3xl', className)}>
      {children}
    </h1>
  )
}

/** Placeholder for screens built in later issues. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-4">
      <PageTitle>{title}</PageTitle>
      <div className="rounded-xl border border-dashed border-line bg-card p-6 text-ink-muted">
        Скоро здесь появится этот экран.
      </div>
    </section>
  )
}
