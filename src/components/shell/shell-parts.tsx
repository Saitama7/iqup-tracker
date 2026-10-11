import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight } from 'lucide-react'
import { profileQuery } from '@/features/profile/api'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { VIEW_HOME, VIEW_LABEL, type View } from './nav'

/** Sidebar brand: yellow «IQ UP» circle + «Tracker» (УД1, А1, Б1). */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-full bg-brand font-display text-[10px] font-extrabold text-ink">
        IQ UP
      </span>
      <span className="font-display text-sm font-bold">Tracker</span>
    </span>
  )
}

export function useDisplayName(): string {
  const { userId } = useSession()
  const { data } = useQuery(profileQuery(userId))
  return data?.fullName ?? ''
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

/** Initial in a circle: brand for teacher/admin, teal for accountant (Б1). */
export function Avatar({
  name,
  view,
  className,
}: {
  name: string
  view?: View | null
  className?: string
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold',
        view === 'accountant' ? 'bg-teal text-card' : 'bg-brand text-ink',
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
            'inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold whitespace-nowrap',
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
