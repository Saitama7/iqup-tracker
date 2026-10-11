import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { teacherSummaryQuery } from '@/features/profile/api'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { cn } from '@/lib/utils'
import { NAV, viewCaption } from './nav'
import { Avatar, Brand, firstName, useDisplayName, ViewSwitch } from './shell-parts'
import { useView } from './use-view'

const itemClass = 'flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm'

// Left menu as on artboards УД1–УД4, А1–А11, Б1–Б3 (≥ 900 px).
export function DesktopShell({ children }: { children: ReactNode }) {
  const { userId } = useSession()
  const { view, views } = useView()
  const name = useDisplayName()
  const now = useNow()
  const summary = useQuery({ ...teacherSummaryQuery(userId, now), enabled: view === 'teacher' })
  const items = view ? NAV[view] : []

  return (
    <div className="flex min-h-dvh bg-paper">
      <aside className="sticky top-0 flex h-dvh w-58 min-w-50 shrink-0 flex-col gap-1.5 bg-ink px-4 py-7 text-paper">
        <Link to="/" className="rounded-xl px-2 pt-1 pb-[22px]">
          <Brand />
        </Link>

        <nav aria-label="Основное меню" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) =>
            item.to ? (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  itemClass,
                  'font-bold text-sand hover:text-paper',
                  'data-[status=active]:bg-brand data-[status=active]:font-extrabold data-[status=active]:text-ink',
                )}
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.label}
                aria-disabled="true"
                title="Экран в разработке"
                className={cn(itemClass, 'cursor-default font-bold text-sand/50')}
              >
                {item.label}
              </span>
            ),
          )}
        </nav>

        <ViewSwitch view={view} views={views} className="text-brand hover:bg-paper/6" />
        <Link
          to="/profile"
          className="flex items-center gap-2.5 rounded-xl bg-paper/6 p-3 hover:bg-paper/10 data-[status=active]:ring-2 data-[status=active]:ring-brand"
        >
          <Avatar name={name} view={view} className="size-[34px] text-[13px]" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-extrabold">
              {firstName(name) || 'Профиль'}
            </span>
            {view && (
              <span className="truncate text-[11px] font-bold text-sand">
                {viewCaption(view, summary.data?.percent)}
              </span>
            )}
          </span>
        </Link>
      </aside>

      <main className="min-w-0 flex-1 px-9 py-8">{children}</main>
    </div>
  )
}
