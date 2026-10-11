import {
  BookOpenCheck,
  Calculator,
  CalendarCheck,
  CalendarDays,
  CircleDollarSign,
  History,
  LayoutDashboard,
  Settings2,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/lib/roles'

// One user may hold several roles (Каныкей = admin + teacher, 05-decisions З1).
// The shell shows one role's menu at a time — the "view".
export type View = Role

export type AppPath = '/today' | '/groups' | '/my-month' | '/admin' | '/payroll' | '/profile'

export interface NavItem {
  label: string
  icon: LucideIcon
  /** `null` — screen is not built yet; shown disabled with «скоро». */
  to: AppPath | null
  /** Shown in the phone tab bar (artboards У2–У6, АМ1–АМ3, БМ1). */
  mobile?: boolean
}

export const NAV: Record<View, NavItem[]> = {
  teacher: [
    { label: 'Сегодня', icon: CalendarCheck, to: '/today', mobile: true },
    { label: 'Группы', icon: UsersRound, to: '/groups', mobile: true },
    { label: 'Мой месяц', icon: Wallet, to: '/my-month', mobile: true },
  ],
  admin: [
    { label: 'Сегодня', icon: LayoutDashboard, to: '/admin', mobile: true },
    { label: 'Расписание', icon: CalendarDays, to: null },
    { label: 'Группы', icon: UsersRound, to: null },
    { label: 'Ученики', icon: Users, to: null, mobile: true },
    { label: 'Оплаты', icon: CircleDollarSign, to: null, mobile: true },
    { label: 'Пробные', icon: Sparkles, to: null },
    { label: 'Учителя и доступ', icon: UserCog, to: null },
    { label: 'Тарифы и праздники', icon: Settings2, to: null },
    { label: 'Журнал изменений', icon: History, to: null },
  ],
  accountant: [
    { label: 'Расчёт ЗП', icon: Calculator, to: '/payroll', mobile: true },
    { label: 'Деньги за месяц', icon: BookOpenCheck, to: null },
  ],
}

export const VIEW_LABEL: Record<View, string> = {
  teacher: 'Учитель',
  admin: 'Администратор',
  accountant: 'Бухгалтер',
}

export const VIEW_HOME: Record<View, AppPath> = {
  teacher: '/today',
  admin: '/admin',
  accountant: '/payroll',
}

/** Views available to the user, primary first (same priority as homePath). */
export function viewsFor(roles: readonly Role[]): View[] {
  return (['admin', 'accountant', 'teacher'] as const).filter((r) => roles.includes(r))
}

function viewOfPath(pathname: string): View | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  if (pathname === '/payroll' || pathname.startsWith('/payroll/')) return 'accountant'
  if (/^\/(today|groups|my-month|lessons)(\/|$)/.test(pathname)) return 'teacher'
  return null
}

/**
 * Which menu to show: the section of the current URL; on shared pages (/profile)
 * the last section the user was in, else their primary view.
 */
export function resolveView(
  pathname: string,
  roles: readonly Role[],
  lastView: View | null,
): View | null {
  const views = viewsFor(roles)
  const fromPath = viewOfPath(pathname)
  if (fromPath && views.includes(fromPath)) return fromPath
  if (lastView && views.includes(lastView)) return lastView
  return views[0] ?? null
}
