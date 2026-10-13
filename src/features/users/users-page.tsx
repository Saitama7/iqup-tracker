import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, LoaderCircle } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { maskDateInput } from '@/lib/date-input'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { formatPhone, formatPhoneIntl } from '@/lib/phone'
import { maskPhoneInput } from '@/lib/phone-input'
import type { Role } from '@/lib/roles'
import { bishkekDate, formatDateRu } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import {
  createUser,
  createUserForm,
  fixRateForm,
  rateForm,
  resetPassword,
  setActive,
  updateRate,
  updateRoles,
  usersQuery,
} from './api'
import {
  buildUsersView,
  countsCaption,
  DEFAULT_PERCENT,
  generatePassword,
  plural,
  rightsCaption,
  statusText,
  ROLE_LABEL,
  ROLE_TOGGLE_LABEL,
  type StaffRow,
  type TeacherRow,
  type UserStatus,
  type UsersView,
} from './model'

/** Teachers shown before «ещё N учителей». */
const TEACHERS_PREVIEW = 5
const ROLES: Role[] = ['teacher', 'admin', 'accountant']
const STAFF_ROLE_ORDER: Role[] = ['admin', 'accountant', 'teacher']

const cardClass = 'rounded-[20px] border border-line bg-card'
const thClass =
  'px-1.5 py-2.5 text-left text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase'
const tdClass = 'border-b border-line px-1.5 py-2.5 align-middle text-[13px]'
const labelClass = 'text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase'
const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 text-base font-bold text-ink outline-none placeholder:font-semibold placeholder:text-placeholder focus:border-ink'
const editClass =
  'inline-flex min-h-8 items-center text-xs font-extrabold whitespace-nowrap text-teal hover:text-teal-strong'

interface EditTarget {
  teacherId: string | null
  userId: string | null
}

interface IssuedPassword {
  fullName: string
  phone: string
  password: string
}

// А8 Учителя и доступ (docs/design/AdminUsers.dc.html). Phone: same page, tables → cards.
export function UsersPage() {
  const isDesktop = useIsDesktop()
  const now = useNow()
  const query = useQuery(usersQuery())
  const data = query.data
  const view = useMemo(() => (data ? buildUsersView(data, now) : undefined), [data, now])
  const [editing, setEditing] = useState<EditTarget | null>(null)
  // Kept after closing so the dialog does not go blank during its exit animation.
  const [issued, setIssued] = useState<IssuedPassword | null>(null)
  const [issuedOpen, setIssuedOpen] = useState(false)
  const showPassword = (p: IssuedPassword) => {
    setIssued(p)
    setIssuedOpen(true)
  }

  const lists = (
    <Lists
      view={view}
      pending={query.isPending}
      error={query.isError}
      onEdit={setEditing}
      cards={!isDesktop}
    />
  )
  const form = <NewUserForm onCreated={showPassword} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={view ? countsCaption(view.counts) : ' '} title="Учителя и доступ" />
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-4">{lists}</div>
          <aside className="sticky top-6 flex flex-col gap-3.5">{form}</aside>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {lists}
          {form}
        </div>
      )}

      {view && editing && (
        <EditUserDialog
          view={view}
          target={editing}
          onClose={() => {
            setEditing(null)
          }}
          onPassword={showPassword}
        />
      )}
      <PasswordDialog
        issued={issued}
        open={issuedOpen}
        onClose={() => {
          setIssuedOpen(false)
        }}
      />
    </div>
  )
}

// ─── Tables / cards ─────────────────────────────────────────────────────────

function Lists({
  view,
  pending,
  error,
  onEdit,
  cards,
}: {
  view: UsersView | undefined
  pending: boolean
  error: boolean
  onEdit: (t: EditTarget) => void
  cards: boolean
}) {
  const { userId: me } = useSession()
  const [showAll, setShowAll] = useState(false)

  if (pending) {
    return <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  }
  if (error || !view) {
    return (
      <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
        Не удалось загрузить пользователей. Проверьте интернет и обновите страницу.
      </p>
    )
  }

  const teachers = showAll ? view.teachers : view.teachers.slice(0, TEACHERS_PREVIEW)
  const hidden = view.teachers.length - teachers.length
  const more = hidden > 0 && (
    <button
      type="button"
      onClick={() => {
        setShowAll(true)
      }}
      className="min-h-11 w-full px-2.5 py-2.5 text-center text-[13px] font-bold text-ink-muted hover:text-ink"
    >
      ещё {hidden} {plural(hidden, ['учитель', 'учителя', 'учителей'])}
    </button>
  )
  const editTeacher = (t: TeacherRow) => {
    onEdit({ teacherId: t.teacherId, userId: t.userId })
  }
  const editStaff = (s: StaffRow) => {
    onEdit({ teacherId: null, userId: s.userId })
  }

  if (cards) {
    return (
      <>
        <Section title="Учителя">
          <ul className="flex flex-col">
            {teachers.map((t) => (
              <li
                key={t.teacherId}
                className="flex flex-col gap-2 border-b border-line px-4 py-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <NameCell name={t.fullName} phone={t.phone} />
                  <StatusBadge status={t.status} />
                </div>
                <div className="text-[13px] text-ink-muted">{t.groupsCaption}</div>
                <div className="flex items-center justify-between gap-3">
                  <PercentCell row={t} />
                  <EditButton
                    name={t.fullName}
                    onClick={() => {
                      editTeacher(t)
                    }}
                    big
                  />
                </div>
              </li>
            ))}
          </ul>
          {more}
        </Section>
        <Section title="Администраторы и бухгалтер">
          <ul className="flex flex-col">
            {view.staff.map((s) => (
              <li
                key={s.userId}
                className="flex flex-col gap-2 border-b border-line px-4 py-3.5 last:border-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <NameCell name={s.fullName} phone={s.phone} />
                  <RoleBadges roles={s.roles} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-ink-muted">{rightsCaption(s.roles)}</span>
                  {s.userId === me ? (
                    <SelfMark />
                  ) : (
                    <EditButton
                      name={s.fullName}
                      onClick={() => {
                        editStaff(s)
                      }}
                      big
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </>
    )
  }

  return (
    <>
      <Section title="Учителя">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={thClass}>Учитель · телефон-логин</th>
              <th className={thClass}>Предметы · группы</th>
              <th className={cn(thClass, 'text-right')}>Процент</th>
              <th className={thClass}>Статус</th>
              <th className={thClass}>
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.teacherId}>
                <td className={cn(tdClass, 'whitespace-nowrap')}>
                  <NameCell name={t.fullName} phone={t.phone} />
                </td>
                <td className={tdClass}>{t.groupsCaption}</td>
                <td className={cn(tdClass, 'text-right tabular-nums')}>
                  <PercentCell row={t} align="end" />
                </td>
                <td className={tdClass}>
                  <StatusBadge status={t.status} />
                </td>
                <td className={tdClass}>
                  <EditButton
                    name={t.fullName}
                    onClick={() => {
                      editTeacher(t)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {more}
      </Section>

      <Section title="Администраторы и бухгалтер">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={thClass}>Пользователь · телефон-логин</th>
              <th className={thClass}>Роль</th>
              <th className={thClass}>Права</th>
              <th className={thClass}>
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.staff.map((s) => (
              <tr key={s.userId} className="[&:last-child>td]:border-0">
                <td className={cn(tdClass, 'whitespace-nowrap')}>
                  <NameCell name={s.fullName} phone={s.phone} />
                </td>
                <td className={tdClass}>
                  <RoleBadges roles={s.roles} />
                </td>
                <td className={cn(tdClass, 'text-ink-muted')}>{rightsCaption(s.roles)}</td>
                <td className={tdClass}>
                  {s.userId === me ? (
                    <SelfMark />
                  ) : (
                    <EditButton
                      name={s.fullName}
                      onClick={() => {
                        editStaff(s)
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={cn(cardClass, 'overflow-x-auto')} aria-label={title}>
      <h2 className="border-b border-line px-[18px] py-3.5 text-[15px] font-extrabold">{title}</h2>
      {children}
    </section>
  )
}

function NameCell({ name, phone }: { name: string; phone: string | null }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-extrabold whitespace-nowrap">{name}</span>
      <span className="text-[11px] font-bold whitespace-nowrap text-ink-muted">
        {phone ? formatPhone(phone) : 'без телефона'}
      </span>
    </div>
  )
}

const chipClass =
  'inline-block rounded-full px-2.5 py-1 text-xs leading-[1.3] font-extrabold whitespace-nowrap'

function PercentBadge({ percent }: { percent: number | null }) {
  return (
    <span
      className={cn(
        chipClass,
        percent != null && percent !== DEFAULT_PERCENT ? 'bg-brand' : 'bg-muted',
      )}
    >
      {percent != null ? `${percent} %` : '—'}
    </span>
  )
}

function PercentCell({ row, align }: { row: TeacherRow; align?: 'end' }) {
  // «с …» only when it tells something: non-default percent or a changed one.
  const from = row.percent !== DEFAULT_PERCENT || row.history.length > 1 ? row.percentFrom : null
  return (
    <div className={cn('flex flex-col gap-1', align === 'end' ? 'items-end' : 'items-start')}>
      <PercentBadge percent={row.percent} />
      {from && (
        <span className="text-[11px] font-bold whitespace-nowrap text-ink-muted">
          с {formatDateRu(from)}
        </span>
      )}
      {row.nextRate && (
        <span className="text-[11px] font-bold whitespace-nowrap text-teal">
          {row.nextRate.percent} % с {formatDateRu(row.nextRate.validFrom)}
        </span>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span
      className={cn(
        chipClass,
        status.kind === 'active' && 'bg-present-soft text-present-strong',
        status.kind === 'inactive' && 'bg-burned/10 text-burned-strong',
        (status.kind === 'idle' || status.kind === 'never' || status.kind === 'no_login') &&
          'bg-stone text-ink-muted',
      )}
    >
      {statusText(status)}
    </span>
  )
}

function RoleBadges({ roles }: { roles: readonly Role[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {STAFF_ROLE_ORDER.filter((r) => roles.includes(r)).map((r) => (
        <span
          key={r}
          className={cn(
            chipClass,
            r === 'admin' && 'bg-ink text-brand',
            r === 'accountant' && 'bg-teal-soft text-teal-strong',
            r === 'teacher' && 'bg-muted text-ink',
          )}
        >
          {ROLE_LABEL[r]}
        </span>
      ))}
    </span>
  )
}

function EditButton({ name, onClick, big }: { name: string; onClick: () => void; big?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Изменить: ${name}`}
      className={cn(editClass, big && 'min-h-11 px-1 text-[13px]')}
    >
      Изменить
    </button>
  )
}

function SelfMark() {
  return <span className="text-xs font-bold whitespace-nowrap text-sand">это вы</span>
}

// ─── New user ───────────────────────────────────────────────────────────────

function RoleToggles({
  value,
  onChange,
  locked,
}: {
  value: Role[]
  onChange: (roles: Role[]) => void
  /** Roles that cannot be switched off (admin editing themself). */
  locked?: Role[]
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label="Роль">
      {ROLES.map((r) => {
        const on = value.includes(r)
        const disabled = on && locked?.includes(r)
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => {
              onChange(
                on
                  ? value.filter((v) => v !== r)
                  : ROLES.filter((x) => x === r || value.includes(x)),
              )
            }}
            className={cn(
              'min-h-11 flex-1 rounded-[10px] px-1 text-[13px] whitespace-nowrap',
              on
                ? 'bg-ink font-extrabold text-brand'
                : 'border-[1.5px] border-line-strong font-bold text-ink-muted',
              disabled && 'cursor-not-allowed opacity-70',
            )}
          >
            {ROLE_TOGGLE_LABEL[r]}
          </button>
        )
      })}
    </div>
  )
}

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {id ? (
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
      ) : (
        <div className={labelClass}>{label}</div>
      )}
      {children}
    </div>
  )
}

function NewUserForm({ onCreated }: { onCreated: (p: IssuedPassword) => void }) {
  const now = useNow()
  const queryClient = useQueryClient()
  const ids = {
    name: useId(),
    phone: useId(),
    percent: useId(),
    from: useId(),
    password: useId(),
  }
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [roles, setRoles] = useState<Role[]>(['teacher'])
  const [percent, setPercent] = useState(String(DEFAULT_PERCENT))
  const [validFrom, setValidFrom] = useState(() => formatDateRu(bishkekDate(now)))
  const [password, setPassword] = useState(() => generatePassword())
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: (res, input) => {
      void queryClient.invalidateQueries({ queryKey: usersQuery().queryKey })
      onCreated({ fullName: input.full_name, phone: res.phone, password: input.password })
      setFullName('')
      setPhone('')
      setPassword(generatePassword())
      setError(null)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = createUserForm.safeParse({
      fullName,
      phone,
      roles,
      percent,
      validFrom,
      password,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const isTeacher = roles.includes('teacher')

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${ids.name}-title`}
      className={cn(cardClass, 'flex flex-col gap-3.5 p-[22px]')}
    >
      <h2 id={`${ids.name}-title`} className="font-display text-base font-bold">
        Новый пользователь
      </h2>
      <Field id={ids.name} label="Имя и фамилия">
        <input
          id={ids.name}
          className={inputClass}
          placeholder="Айгуль Исакова"
          autoComplete="off"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value)
          }}
        />
      </Field>
      <Field id={ids.phone} label="Телефон — это логин">
        <div className="flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink">
          <span className="font-extrabold text-ink-muted">+996</span>
          <input
            id={ids.phone}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="555 000 000"
            className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder"
            value={phone}
            onChange={(e) => {
              setPhone(maskPhoneInput(e.target.value))
            }}
          />
        </div>
      </Field>
      <Field label="Роль">
        <RoleToggles value={roles} onChange={setRoles} />
      </Field>
      {isTeacher && (
        <div className="grid grid-cols-2 gap-2.5">
          <Field id={ids.percent} label="Процент">
            <input
              id={ids.percent}
              inputMode="decimal"
              className={inputClass}
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value)
              }}
            />
          </Field>
          <Field id={ids.from} label="Действует с">
            <input
              id={ids.from}
              inputMode="numeric"
              placeholder="ДД.ММ.ГГГГ"
              className={inputClass}
              value={validFrom}
              onChange={(e) => {
                setValidFrom(maskDateInput(e.target.value))
              }}
            />
          </Field>
        </div>
      )}
      <Field id={ids.password} label="Временный пароль">
        <div className="flex gap-2">
          <input
            id={ids.password}
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
          />
          <button
            type="button"
            onClick={() => {
              setPassword(generatePassword())
            }}
            className="min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-3 text-xs font-extrabold whitespace-nowrap"
          >
            Новый
          </button>
        </div>
      </Field>
      <p className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-ink-muted">
        SMS не отправляется — передайте пароль лично. Учитель сможет сменить его в профиле.
      </p>
      {error && (
        <p role="alert" className="text-sm font-bold text-burned">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-ink text-sm font-extrabold text-brand disabled:opacity-60"
      >
        {mutation.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Создать и показать пароль
      </button>
    </form>
  )
}

// ─── Issued password ────────────────────────────────────────────────────────

function PasswordDialog({
  issued,
  open,
  onClose,
}: {
  issued: IssuedPassword | null
  open: boolean
  onClose: () => void
}) {
  async function copy() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.password)
      toast.success('Пароль скопирован')
    } catch {
      toast.error('Не удалось скопировать — перепишите вручную')
    }
  }

  return (
    <Dialog
      open={open && issued !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="gap-5 rounded-[20px] border-line bg-card p-6 sm:max-w-md">
        {issued && (
          <>
            <div className="flex flex-col gap-1.5">
              <DialogTitle className="font-display text-lg font-bold">
                Пароль для {issued.fullName}
              </DialogTitle>
              <DialogDescription className="text-sm font-bold text-ink-muted">
                Передайте лично — SMS не отправляется. Пароль больше не будет показан.
              </DialogDescription>
            </div>
            <dl className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
              <div className="flex flex-col gap-0.5">
                <dt className={labelClass}>Логин — телефон</dt>
                <dd className="font-extrabold">{formatPhoneIntl(issued.phone)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className={labelClass}>Временный пароль</dt>
                <dd
                  data-testid="issued-password"
                  className="font-display text-2xl font-extrabold tracking-wide select-all"
                >
                  {issued.password}
                </dd>
              </div>
            </dl>
            <DialogFooter className="flex-row gap-2 sm:justify-stretch">
              <button
                type="button"
                onClick={() => void copy()}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-line-strong bg-card text-sm font-extrabold"
              >
                <Copy className="size-4" aria-hidden />
                Скопировать
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 flex-1 rounded-[14px] bg-ink text-sm font-extrabold text-brand"
              >
                Готово
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit ───────────────────────────────────────────────────────────────────

function EditUserDialog({
  view,
  target,
  onClose,
  onPassword,
}: {
  view: UsersView
  target: EditTarget
  onClose: () => void
  onPassword: (p: IssuedPassword) => void
}) {
  const { userId: me } = useSession()
  const teacher =
    view.teachers.find((t) => t.teacherId === target.teacherId) ??
    (target.userId ? view.teachers.find((t) => t.userId === target.userId) : undefined)
  const staff = target.userId ? view.staff.find((s) => s.userId === target.userId) : undefined
  const userId = target.userId
  const fullName = staff?.fullName ?? teacher?.fullName ?? ''
  const phone = staff?.phone ?? teacher?.phone ?? null
  const roles = staff?.roles ?? teacher?.roles ?? []
  const status = staff?.status ?? teacher?.status ?? { kind: 'no_login' as const }
  const isSelf = userId === me

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-[20px] border-line bg-card p-6 sm:max-w-md">
        <div className="flex flex-col gap-2 pr-6">
          <DialogTitle className="font-display text-lg font-bold">{fullName}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-muted">
              <span className="whitespace-nowrap">
                {phone ? formatPhoneIntl(phone) : 'без телефона'}
              </span>
              <StatusBadge status={status} />
            </div>
          </DialogDescription>
        </div>

        {teacher && <RateEditor teacher={teacher} />}
        {userId && <RolesEditor key={roles.join()} userId={userId} roles={roles} isSelf={isSelf} />}
        {userId && phone && (
          <PasswordReset
            fullName={fullName}
            phone={phone}
            onIssued={(p) => {
              onClose()
              onPassword(p)
            }}
          />
        )}
        {userId && !isSelf && <AccessToggle userId={userId} active={status.kind !== 'inactive'} />}
        {!userId && (
          <p className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-ink-muted">
            У учителя ещё нет входа. Создайте пользователя с этим телефоном — он свяжется с учителем
            автоматически.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-line pt-4" aria-label={title}>
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </section>
  )
}

function useInvalidateUsers() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: usersQuery().queryKey })
}

function RateEditor({ teacher }: { teacher: TeacherRow }) {
  return (
    <EditorBlock title="Процент">
      {teacher.history.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px]" aria-label="История процента">
          {teacher.history.map((r) => (
            <li key={r.validFrom} className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">с {formatDateRu(r.validFrom)}</span>
              <PercentBadge percent={r.percent} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-muted">Процент ещё не задан</p>
      )}
      {teacher.percent !== null && teacher.percentFrom && (
        <FixRateForm
          key={`${teacher.percentFrom}:${teacher.percent}`}
          teacherId={teacher.teacherId}
          percent={teacher.percent}
          validFrom={teacher.percentFrom}
        />
      )}
      <NewRateForm teacher={teacher} />
    </EditorBlock>
  )
}

function useRateMutation(success: string) {
  const invalidate = useInvalidateUsers()
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: updateRate,
    onSuccess: async () => {
      await invalidate()
      setError(null)
      toast.success(success)
    },
    onError: (e) => {
      setError(e.message)
    },
  })
  return { mutation, error, setError }
}

/** Typo in the rate in effect today: the same row gets the right percent (audit_log keeps the old one). */
function FixRateForm({
  teacherId,
  percent: current,
  validFrom,
}: {
  teacherId: string
  percent: number
  validFrom: string
}) {
  const percentId = useId()
  const [percent, setPercent] = useState(String(current))
  const { mutation, error, setError } = useRateMutation('Процент исправлен')

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = fixRateForm.safeParse({ percent })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте процент')
      return
    }
    setError(null)
    mutation.mutate({ mode: 'fix', teacherId, validFrom, percent: parsed.data.percent })
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Исправить текущий процент"
      className="flex flex-col gap-2.5 rounded-xl bg-muted p-3"
    >
      <div className="flex items-end gap-2.5">
        <Field id={percentId} label={`Текущий, с ${formatDateRu(validFrom)}`}>
          <input
            id={percentId}
            inputMode="decimal"
            className={inputClass}
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value)
            }}
          />
        </Field>
        <SubmitButton
          pending={mutation.isPending}
          disabled={percent.trim() === String(current)}
          variant="outline"
          className="shrink-0"
        >
          Исправить
        </SubmitButton>
      </div>
      <p className="text-xs font-bold text-ink-muted">
        Если процент введён с ошибкой: занятия с {formatDateRu(validFrom)} пересчитаются.
      </p>
      {error && (
        <p role="alert" className="text-sm font-bold text-burned">
          {error}
        </p>
      )}
    </form>
  )
}

function NewRateForm({ teacher }: { teacher: TeacherRow }) {
  const now = useNow()
  const percentId = useId()
  const fromId = useId()
  const [percent, setPercent] = useState(String(teacher.percent ?? DEFAULT_PERCENT))
  const [validFrom, setValidFrom] = useState(() => formatDateRu(bishkekDate(now)))
  const { mutation, error, setError } = useRateMutation('Процент сохранён')

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = rateForm.safeParse({ percent, validFrom })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте процент и дату')
      return
    }
    setError(null)
    mutation.mutate({ mode: 'new', teacherId: teacher.teacherId, ...parsed.data })
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Новая ставка с даты"
      className="flex flex-col gap-2.5"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field id={percentId} label="Новый процент">
          <input
            id={percentId}
            inputMode="decimal"
            className={inputClass}
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value)
            }}
          />
        </Field>
        <Field id={fromId} label="Действует с">
          <input
            id={fromId}
            inputMode="numeric"
            placeholder="ДД.ММ.ГГГГ"
            className={inputClass}
            value={validFrom}
            onChange={(e) => {
              setValidFrom(maskDateInput(e.target.value))
            }}
          />
        </Field>
      </div>
      <p className="text-xs font-bold text-ink-muted">
        Прежний процент сохранится: новый действует с указанной даты.
      </p>
      {error && (
        <p role="alert" className="text-sm font-bold text-burned">
          {error}
        </p>
      )}
      <SubmitButton pending={mutation.isPending}>Новая ставка с даты</SubmitButton>
    </form>
  )
}

function RolesEditor({
  userId,
  roles,
  isSelf,
}: {
  userId: string
  roles: Role[]
  isSelf: boolean
}) {
  const invalidate = useInvalidateUsers()
  const [value, setValue] = useState<Role[]>(roles)
  const [error, setError] = useState<string | null>(null)
  const changed = value.length !== roles.length || value.some((r) => !roles.includes(r))

  const mutation = useMutation({
    mutationFn: updateRoles,
    onSuccess: async () => {
      await invalidate()
      setError(null)
      toast.success('Роли сохранены — вступят в силу при следующем входе')
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  return (
    <EditorBlock title="Роли">
      <RoleToggles value={value} onChange={setValue} locked={isSelf ? ['admin'] : undefined} />
      {error && (
        <p role="alert" className="text-sm font-bold text-burned">
          {error}
        </p>
      )}
      <SubmitButton
        pending={mutation.isPending}
        disabled={!changed || value.length === 0}
        onClick={() => {
          mutation.mutate({ userId, roles: value })
        }}
      >
        Сохранить роли
      </SubmitButton>
    </EditorBlock>
  )
}

function PasswordReset({
  fullName,
  phone,
  onIssued,
}: {
  fullName: string
  phone: string
  onIssued: (p: IssuedPassword) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: (_res, input) => {
      onIssued({ fullName, phone, password: input.password })
    },
    onError: (e) => {
      setError(e.message)
    },
  })
  return (
    <EditorBlock title="Пароль">
      {error && (
        <p role="alert" className="text-sm font-bold text-burned">
          {error}
        </p>
      )}
      <SubmitButton
        variant="outline"
        pending={mutation.isPending}
        onClick={() => {
          mutation.mutate({ phone, password: generatePassword() })
        }}
      >
        Выдать новый временный пароль
      </SubmitButton>
    </EditorBlock>
  )
}

function AccessToggle({ userId, active }: { userId: string; active: boolean }) {
  const invalidate = useInvalidateUsers()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: setActive,
    onSuccess: async (_res, input) => {
      await invalidate()
      setConfirming(false)
      setError(null)
      toast.success(input.active ? 'Доступ включён' : 'Доступ отключён')
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  return (
    <EditorBlock title="Доступ">
      <p className="text-xs font-bold text-ink-muted">
        {active
          ? 'После отключения войти будет нельзя. История занятий и выплат сохранится.'
          : 'Включите доступ, чтобы снова можно было войти. История занятий и выплат сохранена.'}
      </p>
      {error && (
        <p role="alert" className="text-sm font-bold text-burned">
          {error}
        </p>
      )}
      {active && !confirming ? (
        <SubmitButton
          variant="danger"
          onClick={() => {
            setConfirming(true)
          }}
        >
          Отключить доступ
        </SubmitButton>
      ) : active ? (
        <div className="flex gap-2">
          <SubmitButton
            variant="outline"
            className="flex-1"
            onClick={() => {
              setConfirming(false)
            }}
          >
            Отмена
          </SubmitButton>
          <SubmitButton
            variant="danger"
            className="flex-1"
            pending={mutation.isPending}
            onClick={() => {
              mutation.mutate({ userId, active: false })
            }}
          >
            Да, отключить
          </SubmitButton>
        </div>
      ) : (
        <SubmitButton
          pending={mutation.isPending}
          onClick={() => {
            mutation.mutate({ userId, active: true })
          }}
        >
          Включить доступ
        </SubmitButton>
      )}
    </EditorBlock>
  )
}

function SubmitButton({
  children,
  pending,
  disabled,
  onClick,
  variant = 'primary',
  className,
}: {
  children: ReactNode
  pending?: boolean
  disabled?: boolean
  onClick?: () => void
  variant?: 'primary' | 'outline' | 'danger'
  className?: string
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={pending || disabled}
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-extrabold disabled:opacity-50',
        variant === 'primary' && 'bg-ink text-brand',
        variant === 'outline' && 'border-[1.5px] border-line-strong bg-card text-ink',
        variant === 'danger' && 'border-[1.5px] border-line-strong bg-card text-burned-strong',
        className,
      )}
    >
      {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}
