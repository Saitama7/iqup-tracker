import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight } from 'lucide-react'
import { profileQuery } from '@/features/profile/api'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { VIEW_HOME, VIEW_LABEL, type View } from './nav'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('font-display text-lg font-extrabold tracking-tight', className)}>
      IQ<span className="text-brand"> UP</span>
    </span>
  )
}

export function useDisplayName(): string {
  const { userId } = useSession()
  const { data } = useQuery(profileQuery(userId))
  return data?.fullName ?? ''
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand font-display text-sm font-bold text-ink',
        className,
      )}
    >
      {initial}
    </span>
  )
}

/** «Как учитель» / «Как администратор» — for users with several roles (Каныкей). */
export function ViewSwitch({
  view,
  views,
  className,
}: {
  view: View | null
  views: View[]
  className?: string
}) {
  const others = views.filter((v) => v !== view)
  if (others.length === 0) return null
  return (
    <>
      {others.map((v) => (
        <Link
          key={v}
          to={VIEW_HOME[v]}
          className={cn(
            'inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold',
            className,
          )}
        >
          <ArrowLeftRight className="size-4" aria-hidden />
          Как {VIEW_LABEL[v].toLowerCase()}
        </Link>
      ))}
    </>
  )
}
