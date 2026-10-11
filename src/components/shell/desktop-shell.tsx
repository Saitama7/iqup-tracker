import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { NAV, VIEW_LABEL } from './nav'
import { Avatar, Logo, useDisplayName, ViewSwitch } from './shell-parts'
import { useView } from './use-view'

const itemClass =
  'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors'

// Left menu as on artboards УД1–УД4, А1…, Б1… (≥ 900 px).
export function DesktopShell({ children }: { children: ReactNode }) {
  const { view, views } = useView()
  const name = useDisplayName()
  const items = view ? NAV[view] : []

  return (
    <div className="flex min-h-dvh bg-paper">
      <aside className="sticky top-0 flex h-dvh w-72 shrink-0 flex-col bg-ink px-4 py-6 text-paper">
        <Link to="/" className="mb-8 px-3">
          <Logo className="text-2xl" />
        </Link>

        <nav aria-label="Основное меню" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) =>
            item.to ? (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  itemClass,
                  'text-paper/75 hover:bg-paper/10 hover:text-paper',
                  'data-[status=active]:bg-brand data-[status=active]:text-ink',
                )}
              >
                <item.icon className="size-5 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            ) : (
              <span
                key={item.label}
                aria-disabled="true"
                className={cn(itemClass, 'cursor-default text-paper/40')}
              >
                <item.icon className="size-5 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto text-xs font-medium whitespace-nowrap">скоро</span>
              </span>
            ),
          )}
        </nav>

        <div className="mt-4 flex flex-col gap-1 border-t border-paper/15 pt-4">
          <ViewSwitch view={view} views={views} className="text-brand hover:bg-paper/10" />
          <Link
            to="/profile"
            className={cn(itemClass, 'hover:bg-paper/10 data-[status=active]:bg-paper/10')}
          >
            <Avatar name={name} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{name || 'Профиль'}</span>
              {view && (
                <span className="text-xs font-medium text-paper/60">{VIEW_LABEL[view]}</span>
              )}
            </span>
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
    </div>
  )
}
