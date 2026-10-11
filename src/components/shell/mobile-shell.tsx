import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { NAV } from './nav'
import { Avatar, Logo, useDisplayName, ViewSwitch } from './shell-parts'
import { useView } from './use-view'

// Phone layout: bottom tabs (artboards У2–У6), 100dvh, safe-area insets.
export function MobileShell({ children }: { children: ReactNode }) {
  const { view, views } = useView()
  const name = useDisplayName()
  const tabs = view ? NAV[view].filter((i) => i.mobile) : []
  const showTabs = tabs.length > 1

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-2 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
          <Link to="/" className="mr-auto">
            <Logo />
          </Link>
          <ViewSwitch view={view} views={views} className="text-teal" />
          <Link
            to="/profile"
            aria-label="Профиль"
            className="inline-flex size-11 items-center justify-center rounded-full"
          >
            <Avatar name={name} />
          </Link>
        </div>
      </header>

      <main
        className={cn(
          'flex-1 px-4 pt-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]',
          showTabs
            ? 'pb-[calc(5rem+env(safe-area-inset-bottom))]'
            : 'pb-[calc(1rem+env(safe-area-inset-bottom))]',
        )}
      >
        {children}
      </main>

      {showTabs && (
        <nav
          aria-label="Основное меню"
          className="fixed inset-x-0 bottom-0 z-20 [overscroll-behavior:none] border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="mx-auto flex max-w-md">
            {tabs.map((tab) => (
              <li key={tab.label} className="flex-1">
                {tab.to ? (
                  <Link
                    to={tab.to}
                    className="group flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-ink-muted data-[status=active]:text-ink"
                  >
                    <span className="flex h-7 w-12 items-center justify-center rounded-full group-data-[status=active]:bg-brand">
                      <tab.icon className="size-5" aria-hidden />
                    </span>
                    {tab.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-ink-muted/50"
                  >
                    <span className="flex h-7 w-12 items-center justify-center">
                      <tab.icon className="size-5" aria-hidden />
                    </span>
                    {tab.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
