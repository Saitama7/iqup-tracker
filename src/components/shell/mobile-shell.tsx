import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { isPushedScreen, MORE, TABS, type NavItem, type TabItem } from './nav'
import { useView } from './use-view'

// Phone layout: no app bar — each screen draws its own header (У2, У4, У7);
// bottom tabs as on У2–У6 / АМ1. 100dvh, safe-area insets.
export function MobileShell({ children }: { children: ReactNode }) {
  const { view } = useView()
  const pathname = useLocation({ select: (l) => l.pathname })
  // У7 Профиль, АМ2 Ученик are pushed screens with a back button, no tab bar.
  const tabs = view && !isPushedScreen(pathname) ? TABS[view] : []
  const showTabs = tabs.length > 1
  // АМ1 packs five tabs: narrower items, 10 px labels, 44×30 pill.
  const dense = tabs.length > 3

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <main
        className={cn(
          'flex flex-1 flex-col pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))]',
          showTabs
            ? 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]'
            : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        {children}
      </main>

      {showTabs && (
        <nav
          aria-label="Основное меню"
          className="fixed inset-x-0 bottom-0 z-20 [overscroll-behavior:none] border-t border-line bg-card px-2 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <ul className="mx-auto flex max-w-md justify-around">
            {tabs.map((tab) => {
              const icon = (
                <tab.icon
                  className={dense ? 'size-[18px]' : 'size-5'}
                  strokeWidth={2.4}
                  aria-hidden
                />
              )
              return (
                <li key={tab.label}>
                  {tab.more ? (
                    <MoreSheet
                      tab={tab}
                      items={view ? MORE[view] : []}
                      pathname={pathname}
                      dense={dense}
                    />
                  ) : tab.to ? (
                    <Link
                      to={tab.to}
                      activeOptions={{ exact: tab.exact ?? false }}
                      className={cn(
                        itemClass(dense),
                        'group text-ink-muted data-[status=active]:font-extrabold data-[status=active]:text-ink',
                      )}
                    >
                      <span
                        className={cn(
                          pillClass(dense),
                          'rounded-full group-data-[status=active]:bg-brand',
                        )}
                      >
                        {icon}
                      </span>
                      {tab.label}
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      title="Экран в разработке"
                      className={cn(itemClass(dense), 'text-ink-muted/50')}
                    >
                      <span className={pillClass(dense)}>{icon}</span>
                      {tab.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}

// «Ещё»: bottom sheet with the remaining sections; not built yet — muted with «скоро».
function MoreSheet({
  tab,
  items,
  pathname,
  dense,
}: {
  tab: TabItem
  items: NavItem[]
  pathname: string
  dense: boolean
}) {
  const [open, setOpen] = useState(false)
  const active = items.some((i) => i.to === pathname)
  const close = () => {
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(
          itemClass(dense),
          'group text-ink-muted',
          active && 'font-extrabold text-ink',
        )}
      >
        <span className={cn(pillClass(dense), 'rounded-full', active && 'bg-brand')}>
          <tab.icon className={dense ? 'size-[18px]' : 'size-5'} strokeWidth={2.4} aria-hidden />
        </span>
        {tab.label}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[24px] border-line bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        <SheetTitle className="px-2 pb-1 font-display text-lg font-bold">Ещё</SheetTitle>
        <SheetDescription className="sr-only">Остальные разделы</SheetDescription>
        <nav aria-label="Ещё">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.label} className="border-b border-line last:border-b-0">
                {item.to ? (
                  <Link
                    to={item.to}
                    onClick={close}
                    className="flex min-h-12 items-center justify-between gap-3 px-2 text-[15px] font-bold text-ink data-[status=active]:font-extrabold"
                  >
                    {item.label}
                    <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="flex min-h-12 items-center justify-between gap-3 px-2 text-[15px] font-bold text-ink-muted/50"
                  >
                    {item.label}
                    <span className="text-xs font-extrabold whitespace-nowrap">скоро</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  )
}

const itemClass = (dense: boolean) =>
  cn(
    'flex flex-col items-center gap-1 py-1.5 font-bold',
    dense ? 'min-w-16 text-[10px]' : 'min-w-[72px] text-[11px]',
  )

const pillClass = (dense: boolean) =>
  cn('flex items-center justify-center', dense ? 'h-[30px] w-11' : 'h-8 w-12')
