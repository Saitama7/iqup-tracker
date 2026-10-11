import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Avatar, useDisplayName } from '@/components/shell/shell-parts'
import { useView } from '@/components/shell/use-view'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/lib/use-is-desktop'

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1
      className={cn(
        'font-display text-[26px] leading-[1.1] font-bold text-ink min-[900px]:text-[30px]',
        className,
      )}
    >
      {children}
    </h1>
  )
}

/**
 * Screen header: uppercase eyebrow + title (У2/У4 on the phone, УД1/А1 on desktop).
 * On the phone the avatar on the right opens У7 Профиль (role switch lives there).
 */
export function PageHeader({ eyebrow, title }: { eyebrow?: ReactNode; title: ReactNode }) {
  const isDesktop = useIsDesktop()
  const { view } = useView()
  const name = useDisplayName()

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1 min-[900px]:gap-1.5">
        {eyebrow && (
          <p className="text-[13px] font-bold tracking-[0.04em] text-ink-muted uppercase min-[900px]:text-xs min-[900px]:font-extrabold min-[900px]:tracking-[0.06em]">
            {eyebrow}
          </p>
        )}
        <PageTitle>{title}</PageTitle>
      </div>
      {!isDesktop && (
        <Link to="/profile" aria-label="Профиль" className="shrink-0 rounded-full">
          <Avatar name={name} view={view} />
        </Link>
      )}
    </header>
  )
}

/** Placeholder for screens built in later issues. */
export function ComingSoon({ title, eyebrow }: { title: ReactNode; eyebrow?: ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <PageHeader eyebrow={eyebrow} title={title} />
      <div className="rounded-[18px] border border-dashed border-line-strong bg-card p-6 font-bold text-ink-muted">
        Скоро здесь появится этот экран.
      </div>
    </section>
  )
}
