import { Calendar, CreditCard, Menu, User, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/lib/roles'

// One user may hold several roles (Каныкей = admin + teacher, 05-decisions З1).
// The shell shows one role's menu at a time — the "view".
export type View = Role

export type AppPath =
  | '/today'
  | '/groups'
  | '/my-month'
  | '/admin'
  | '/admin/schedule'
  | '/admin/users'
  | '/admin/groups'
  | '/admin/students'
  | '/admin/settings'
  | '/admin/audit'
  | '/admin/trials'
  | '/admin/payments'
  | '/payroll'
  | '/profile'

export interface NavItem {
  label: string
  /** `null` — screen is not built yet; shown disabled. */
  to: AppPath | null
  /** Active only on this exact path — section roots like /admin that have child screens. */
  exact?: boolean
  /** A counter next to the label: teachers' requests to correct marks waiting for the admin (#74). */
  badge?: 'corrections'
}

export interface TabItem extends NavItem {
  icon: LucideIcon
  /** Opens the «Ещё» bottom sheet with MORE[view] instead of navigating. */
  more?: true
}

// Desktop sidebar, texts and order as on artboards УД1–УД4, А1–А11, Б1–Б3.
export const NAV: Record<View, NavItem[]> = {
  teacher: [
    { label: 'Сегодня', to: '/today' },
    { label: 'Группы и ученики', to: '/groups' },
    { label: 'Мой месяц', to: '/my-month' },
  ],
  admin: [
    { label: 'Дашборд', to: '/admin', exact: true, badge: 'corrections' },
    { label: 'Расписание', to: '/admin/schedule' },
    { label: 'Группы', to: '/admin/groups' },
    { label: 'Ученики', to: '/admin/students' },
    { label: 'Пробные занятия', to: '/admin/trials' },
    { label: 'Оплаты', to: '/admin/payments' },
    { label: 'Расчёт ЗП', to: '/payroll' },
    { label: 'Учителя и доступ', to: '/admin/users' },
    { label: 'Тарифы и праздники', to: '/admin/settings' },
    { label: 'Журнал изменений', to: '/admin/audit' },
  ],
  accountant: [
    { label: 'Расчёт ЗП', to: '/payroll' },
    { label: 'Деньги за месяц', to: null },
    { label: 'Расписание', to: null },
    { label: 'Группы', to: null },
    { label: 'Ученики', to: null },
    { label: 'Оплаты', to: '/admin/payments' },
    { label: 'Журнал изменений', to: '/admin/audit' },
  ],
}

// Phone tab bar: У2–У6 (teacher), АМ1–АМ3 (admin). БМ1–БМ2 (accountant) have no tab bar.
export const TABS: Record<View, TabItem[]> = {
  teacher: [
    { label: 'Сегодня', icon: Calendar, to: '/today' },
    { label: 'Группы', icon: Users, to: '/groups' },
    { label: 'Мой месяц', icon: CreditCard, to: '/my-month' },
  ],
  admin: [
    { label: 'Сегодня', icon: Calendar, to: '/admin', exact: true, badge: 'corrections' },
    { label: 'Ученики', icon: User, to: '/admin/students' },
    { label: 'Оплата', icon: CreditCard, to: '/admin/payments' },
    { label: 'Группы', icon: Users, to: '/admin/groups' },
    { label: 'Ещё', icon: Menu, to: null, more: true },
  ],
  accountant: [],
}

// Phone «Ещё» sheet: the sections that do not fit the tab bar.
export const MORE: Record<View, NavItem[]> = {
  teacher: [],
  admin: [
    { label: 'Расписание', to: '/admin/schedule' },
    { label: 'Группы', to: '/admin/groups' },
    { label: 'Пробные', to: '/admin/trials' },
    { label: 'Учителя и доступ', to: '/admin/users' },
    { label: 'Тарифы и праздники', to: '/admin/settings' },
    { label: 'Журнал изменений', to: '/admin/audit' },
    { label: 'Профиль', to: '/profile' },
  ],
  accountant: [],
}

export const VIEW_LABEL: Record<View, string> = {
  teacher: 'Учитель',
  admin: 'Администратор',
  accountant: 'Бухгалтер',
}

/** Caption under the name in the sidebar user card (УД1, А1, Б1). */
export function viewCaption(view: View, percent: number | null | undefined): string {
  if (view === 'teacher') return percent != null ? `учитель · ${percent} %` : 'учитель'
  if (view === 'admin') return 'администратор'
  return 'бухгалтер · просмотр'
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

/**
 * Pushed screens with their own back button and bottom actions: no tab bar
 * (У7 Профиль, У3 Посещаемость, У5 Группа, АМ2 Ученик, А4 Группа).
 */
export function isPushedScreen(pathname: string): boolean {
  return (
    pathname === '/profile' ||
    /^\/(admin\/students|admin\/groups|groups|lessons)\/[^/]+\/?$/.test(pathname)
  )
}

export type BackTarget =
  | {
      to: AppPath
      /** Parent screen name under the back chevron: «‹ Ученики». */
      label: string
      /** Search of the parent: «Мой месяц» with its month and group filter (#72). */
      search?: { month?: string; group?: string }
    }
  | {
      /** The teacher's group a lesson was opened from (#76). */
      to: '/groups/$groupId'
      label: string
      params: { groupId: string }
    }

/** Validated search params of the current screen that point back to a list (lessons, #72). */
export interface BackSearch {
  from?: 'my-month' | 'group'
  month?: string
  group?: string
}

/** Home of the view with its tab / menu label («Сегодня», «Расчёт ЗП»). */
function homeTarget(view: View): BackTarget {
  const to = VIEW_HOME[view]
  const label =
    TABS[view].find((t) => t.to === to)?.label ?? NAV[view].find((i) => i.to === to)?.label
  return { to, label: label ?? 'Назад' }
}

/**
 * Parent of a screen for the phone back button (#57); null — a root (a tab or the view's home),
 * no back button. Used when the history has no page of the app to return to (direct link,
 * PWA icon).
 */
export function backTarget(
  pathname: string,
  view: View | null,
  search: BackSearch = {},
): BackTarget | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  if (view && (path === VIEW_HOME[view] || TABS[view].some((t) => t.to === path))) return null
  if (/^\/admin\/students\/[^/]+$/.test(path)) return { to: '/admin/students', label: 'Ученики' }
  if (/^\/admin\/groups\/[^/]+$/.test(path)) return { to: '/admin/groups', label: 'Группы' }
  if (/^\/groups\/[^/]+$/.test(path)) return { to: '/groups', label: 'Группы' }
  if (/^\/lessons\/[^/]+$/.test(path)) {
    if (search.from === 'my-month' && (view === 'teacher' || !view)) {
      const { month, group } = search
      return {
        to: '/my-month',
        label: 'Мой месяц',
        search: { ...(month && { month }), ...(group && { group }) },
      }
    }
    if (search.from === 'group' && search.group && (view === 'teacher' || !view)) {
      return { to: '/groups/$groupId', label: 'Группа', params: { groupId: search.group } }
    }
    return view === 'teacher' || !view ? { to: '/today', label: 'Сегодня' } : homeTarget(view)
  }
  return view ? homeTarget(view) : null
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
