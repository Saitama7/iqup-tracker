import { Link, useCanGoBack, useLocation, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { backTarget, type BackSearch, type BackTarget } from './nav'
import { useView } from './use-view'

/** Where «назад» leads from the current screen; null on roots (tabs, the view's home). */
export function useBackTarget(): BackTarget | null {
  const { view } = useView()
  const pathname = useLocation({ select: (l) => l.pathname })
  const search = useLocation({ select: (l) => l.search as BackSearch })
  return backTarget(pathname, view, search)
}

type Tone = 'paper' | 'brand' | 'ink'

// Same 44 px circle as on У3 / У5 / У7 / АМ2, by the header it sits on; the parent name beside it.
const TONE: Record<Tone, string> = {
  paper: 'border border-line bg-card text-ink',
  brand: 'bg-ink/8 text-ink',
  ink: 'bg-paper/10 text-paper',
}

/**
 * The one back button (#57). Phone: «‹ Ученики» pill; desktop: muted «‹ Ученики» link.
 * Goes back in the history when the previous entry is a page of the app (the list keeps its
 * filters and scroll), else to the parent route — a direct link or the PWA icon never leads
 * into an empty history.back().
 */
export function BackButton({
  tone = 'paper',
  variant: variantProp,
  className,
}: {
  tone?: Tone
  /** Default: pill on the phone, link on the desktop. */
  variant?: 'pill' | 'link'
  className?: string
}) {
  const isDesktop = useIsDesktop()
  const variant = variantProp ?? (isDesktop ? 'link' : 'pill')
  const target = useBackTarget()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  if (!target) return null

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!canGoBack || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    router.history.back()
  }

  return (
    <Link
      to={target.to}
      search={target.search}
      onClick={onClick}
      aria-label={`Назад: ${target.label}`}
      className={cn(
        variant === 'pill'
          ? cn(
              'inline-flex h-11 w-fit shrink-0 items-center gap-1 rounded-full pr-4 pl-2.5 text-sm font-extrabold whitespace-nowrap',
              TONE[tone],
            )
          : 'inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] font-extrabold text-ink-muted min-[900px]:min-h-8',
        className,
      )}
    >
      <ChevronLeft
        className={variant === 'pill' ? 'size-[22px]' : 'size-4'}
        strokeWidth={2.5}
        aria-hidden
      />
      {target.label}
    </Link>
  )
}
