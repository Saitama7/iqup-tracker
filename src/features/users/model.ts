// Pure view model for А8 «Учителя и доступ»: rows, statuses, captions. No IO here.
import { currentRate } from '@/features/profile/api'
import type { Role } from '@/lib/roles'
import { bishkekDate, bishkekDaysBetween } from '@/lib/time'

/** Default percent (05-decisions А2): other values are highlighted in the table. */
export const DEFAULT_PERCENT = 45

/** No sign-in for this many days → «Не входил(а) N дн.» instead of «Доступ открыт». */
export const IDLE_DAYS = 7

export interface ProfileRow {
  id: string
  full_name: string
  phone: string
  roles: Role[]
  is_active: boolean
}

export interface TeacherSource {
  id: string
  user_id: string | null
  full_name: string
  phone: string | null
  teacher_rates: { percent: number; valid_from: string }[]
  groups: { subject: string; status: 'forming' | 'active' | 'archived' }[]
}

export interface UsersSource {
  profiles: ProfileRow[]
  teachers: TeacherSource[]
  lastSignIn: Record<string, string | null>
}

export type UserStatus =
  | { kind: 'active' }
  | { kind: 'idle'; days: number }
  | { kind: 'never' }
  | { kind: 'inactive' }
  | { kind: 'no_login' }

export interface Rate {
  percent: number
  validFrom: string
}

export interface TeacherRow {
  teacherId: string
  userId: string | null
  fullName: string
  phone: string | null
  /** «Химия · 3 группы» */
  groupsCaption: string
  percent: number | null
  /** valid_from of the rate in effect today. */
  percentFrom: string | null
  /** Nearest rate starting after today, if any. */
  nextRate: Rate | null
  /** All rates, newest first. */
  history: Rate[]
  roles: Role[]
  status: UserStatus
}

export interface StaffRow {
  userId: string
  fullName: string
  phone: string
  roles: Role[]
  status: UserStatus
}

export interface UsersView {
  teachers: TeacherRow[]
  staff: StaffRow[]
  /** Active users per role, for the header line. */
  counts: { teachers: number; admins: number; accountants: number }
}

const byName = (a: { fullName: string }, b: { fullName: string }) =>
  a.fullName.localeCompare(b.fullName, 'ru')

export function userStatus(
  profile: Pick<ProfileRow, 'is_active'> | undefined,
  lastSignIn: string | null | undefined,
  nowMs: number,
): UserStatus {
  if (!profile) return { kind: 'no_login' }
  if (!profile.is_active) return { kind: 'inactive' }
  if (!lastSignIn) return { kind: 'never' }
  const days = bishkekDaysBetween(Date.parse(lastSignIn), nowMs)
  return days >= IDLE_DAYS ? { kind: 'idle', days } : { kind: 'active' }
}

/** Status chip text. Gender-neutral: names do not tell us how to address a person. */
export function statusText(status: UserStatus): string {
  switch (status.kind) {
    case 'active':
      return 'Доступ открыт'
    case 'idle':
      return `Не входил(а) ${status.days} дн.`
    case 'never':
      return 'Не входил(а)'
    case 'inactive':
      return 'Доступ закрыт'
    case 'no_login':
      return 'Нет входа'
  }
}

/** Russian plural: plural(5, ['группа', 'группы', 'групп']) → 'групп' */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/** «ОРТ, математика · 3 группы» — live (non-archived) groups only. */
export function groupsCaption(groups: TeacherSource['groups']): string {
  const live = groups.filter((g) => g.status !== 'archived')
  if (live.length === 0) return 'Нет групп'
  const seen = new Set<string>()
  const subjects: string[] = []
  for (const g of live) {
    const s = g.subject.trim()
    const key = s.toLowerCase()
    if (!s || seen.has(key)) continue
    seen.add(key)
    subjects.push(s)
  }
  // Keep abbreviations (ОРТ) as typed; other subjects after the first go lower case.
  const text = subjects
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((s, i) => (i === 0 || s === s.toUpperCase() ? s : s.toLowerCase()))
    .join(', ')
  const count = `${live.length} ${plural(live.length, ['группа', 'группы', 'групп'])}`
  return text ? `${text} · ${count}` : count
}

export function buildUsersView(src: UsersSource, nowMs: number): UsersView {
  const today = bishkekDate(nowMs)
  const profileById = new Map(src.profiles.map((p) => [p.id, p]))

  const teachers: TeacherRow[] = src.teachers.map((t) => {
    const profile = t.user_id ? profileById.get(t.user_id) : undefined
    const history = t.teacher_rates
      .map((r) => ({ percent: r.percent, validFrom: r.valid_from }))
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))
    const percent = currentRate(t.teacher_rates, today)
    const percentFrom = history.find((r) => r.validFrom <= today)?.validFrom ?? null
    const future = history.filter((r) => r.validFrom > today)
    return {
      teacherId: t.id,
      userId: profile ? profile.id : null,
      fullName: t.full_name,
      phone: t.phone,
      groupsCaption: groupsCaption(t.groups),
      percent,
      percentFrom,
      nextRate: future.at(-1) ?? null,
      history,
      roles: profile?.roles ?? [],
      status: userStatus(profile, profile ? src.lastSignIn[profile.id] : null, nowMs),
    }
  })

  const staff: StaffRow[] = src.profiles
    .filter((p) => p.roles.includes('admin') || p.roles.includes('accountant'))
    .map((p) => ({
      userId: p.id,
      fullName: p.full_name,
      phone: p.phone,
      roles: p.roles,
      status: userStatus(p, src.lastSignIn[p.id], nowMs),
    }))

  // Admins first, then accountants (as on А8); by name inside.
  const rank = (r: StaffRow) => (r.roles.includes('admin') ? 0 : 1)
  staff.sort((a, b) => rank(a) - rank(b) || byName(a, b))
  teachers.sort(byName)

  const activeProfiles = src.profiles.filter((p) => p.is_active)
  return {
    teachers,
    staff,
    counts: {
      teachers: teachers.filter((t) => t.status.kind !== 'inactive').length,
      admins: activeProfiles.filter((p) => p.roles.includes('admin')).length,
      accountants: activeProfiles.filter((p) => p.roles.includes('accountant')).length,
    },
  }
}

/** «10 учителей · 2 администратора · 1 бухгалтер» */
export function countsCaption(counts: UsersView['counts']): string {
  return [
    `${counts.teachers} ${plural(counts.teachers, ['учитель', 'учителя', 'учителей'])}`,
    `${counts.admins} ${plural(counts.admins, ['администратор', 'администратора', 'администраторов'])}`,
    `${counts.accountants} ${plural(counts.accountants, ['бухгалтер', 'бухгалтера', 'бухгалтеров'])}`,
  ].join(' · ')
}

// Look-alike characters (0/o, 1/l/i) are left out: the password is read aloud or copied by hand.
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Temporary password `iqup-XXXX` (artboard А8). */
export function generatePassword(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(4)
  let tail = ''
  for (const b of bytes) tail += PASSWORD_ALPHABET.charAt(b % PASSWORD_ALPHABET.length)
  return `iqup-${tail}`
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export const ROLE_LABEL: Record<Role, string> = {
  teacher: 'Учитель',
  admin: 'Администратор',
  accountant: 'Бухгалтер',
}

/** Short labels for the role toggles in the form. */
export const ROLE_TOGGLE_LABEL: Record<Role, string> = {
  teacher: 'Учитель',
  admin: 'Админ',
  accountant: 'Бухгалтер',
}

/** «Права» column of the staff table. */
export function rightsCaption(roles: readonly Role[]): string {
  if (roles.includes('admin')) return 'всё'
  if (roles.includes('accountant')) return 'просмотр · закрытие периода · корректировки'
  return 'свои группы'
}
