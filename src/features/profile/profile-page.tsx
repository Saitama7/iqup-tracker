import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useId, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page'
import { VIEW_HOME, VIEW_LABEL, viewsFor } from '@/components/shell/nav'
import { Avatar, ViewSwitch } from '@/components/shell/shell-parts'
import { useView } from '@/components/shell/use-view'
import { signOut, useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { formatPhoneIntl } from '@/lib/phone'
import { hasRole } from '@/lib/roles'
import { formatMonthYearGen } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import {
  changePassword,
  passwordSchema,
  profileQuery,
  teacherSummaryQuery,
  type Profile,
  type TeacherSummary,
} from './api'

const cardClass = 'flex flex-col rounded-[18px] border border-line bg-card'
const rowClass = 'flex items-center justify-between gap-3 px-[18px] py-4 text-sm font-bold'

// У7 Профиль (docs/design/Profile.dc.html); desktop — same blocks in DesktopShell.
export function ProfilePage() {
  const { userId, roles } = useSession()
  const isTeacher = hasRole(roles, 'teacher')
  const isDesktop = useIsDesktop()
  const { view, views } = useView()
  const now = useNow()
  const profile = useQuery(profileQuery(userId))
  const summary = useQuery({ ...teacherSummaryQuery(userId, now), enabled: isTeacher })
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function onSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      await navigate({ to: '/login', replace: true })
    } catch {
      toast.error('Не удалось выйти. Попробуйте ещё раз.')
      setSigningOut(false)
    }
  }

  const subtitle = [
    viewsFor(roles)
      .map((v, i) => (i === 0 ? VIEW_LABEL[v] : VIEW_LABEL[v].toLowerCase()))
      .join(' · '),
    ...(summary.data?.subjects ?? []),
    profile.data ? formatPhoneIntl(profile.data.phone) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const identity = (
    <Identity profile={profile.data} pending={profile.isPending} error={profile.isError}>
      {subtitle}
    </Identity>
  )
  const teacherBlocks = isTeacher && (
    <>
      <PercentCard percent={summary.isPending ? undefined : (summary.data?.percent ?? null)} />
      <StatsCard summary={summary.data} />
    </>
  )
  const settings = (
    <>
      <div className={cardClass}>
        {/* Phone has no sidebar: the role switch for Каныкей lives here */}
        {!isDesktop && (
          <ViewSwitch
            view={view}
            views={views}
            className="min-h-[52px] rounded-none border-b border-line px-[18px] text-teal"
          />
        )}
        <PasswordRow />
      </div>
      <p className="py-1.5 text-center text-xs font-bold text-ink-muted">
        Изменить имя, телефон или процент может только администратор
      </p>
    </>
  )
  const signOutButton = (
    <button
      type="button"
      disabled={signingOut}
      onClick={() => void onSignOut()}
      className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-line-strong bg-card px-6 text-sm font-extrabold text-burned-strong disabled:opacity-60"
    >
      {signingOut && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      Выйти
    </button>
  )

  if (isDesktop) {
    return (
      <div className="flex max-w-[960px] flex-col gap-6">
        <PageHeader title="Профиль" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-6">
          <div className="flex flex-col gap-2.5">
            <div className="rounded-[20px] border border-line bg-card p-6">{identity}</div>
            {teacherBlocks}
          </div>
          <div className="flex flex-col gap-2.5">
            {settings}
            {signOutButton}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between">
        <Link
          to={view ? VIEW_HOME[view] : '/'}
          aria-label="Назад"
          className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink"
        >
          <ChevronLeft className="size-[22px]" strokeWidth={2.5} aria-hidden />
        </Link>
        <h1 className="text-sm font-extrabold">Профиль</h1>
        <div className="w-11" />
      </div>

      <div className="pt-6">{identity}</div>

      <div className="flex flex-1 flex-col gap-2.5 pt-6">
        {teacherBlocks}
        {settings}
      </div>

      <div className="flex flex-col pt-3">{signOutButton}</div>
    </div>
  )
}

function Identity({
  profile,
  pending,
  error,
  children,
}: {
  profile: Profile | undefined
  pending: boolean
  error: boolean
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  const name = profile?.fullName ?? ''
  return (
    <div
      className={cn(
        'flex gap-2.5',
        isDesktop ? 'items-center gap-5' : 'flex-col items-center text-center',
      )}
    >
      <Avatar name={name} className="size-[88px] text-[30px] shadow-brand" />
      <div className={cn('flex min-w-0 flex-col gap-2.5', !isDesktop && 'items-center')}>
        {pending ? (
          <span className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
        ) : error ? (
          <span className="font-bold text-burned">Не удалось загрузить профиль</span>
        ) : (
          <span className="font-display text-[22px] font-bold">{name}</span>
        )}
        <span className="text-[13px] font-bold text-ink-muted">{children}</span>
      </div>
    </div>
  )
}

/** `undefined` — loading, `null` — no rate yet. */
function PercentCard({ percent }: { percent: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[18px] bg-ink px-[18px] py-4 text-paper">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-extrabold tracking-[0.06em] text-brand uppercase">
          Мой процент
        </span>
        <span className="text-[13px] font-bold opacity-70">
          от полной цены урока каждого ученика
        </span>
      </div>
      <span className="font-display text-[28px] font-extrabold whitespace-nowrap text-brand">
        {percent === undefined ? '…' : percent != null ? `${percent} %` : '—'}
      </span>
    </div>
  )
}

function StatsCard({ summary }: { summary: TeacherSummary | null | undefined }) {
  const value = (v: ReactNode) => (summary === undefined ? '…' : summary ? v : '—')
  return (
    <dl className={cardClass}>
      <div className={cn(rowClass, 'border-b border-line')}>
        <dt>Групп</dt>
        <dd className="font-display">{value(summary?.groups)}</dd>
      </div>
      <div className={cn(rowClass, 'border-b border-line')}>
        <dt>Учеников</dt>
        <dd className="font-display">{value(summary?.students)}</dd>
      </div>
      <div className={rowClass}>
        <dt>В IQ UP с</dt>
        <dd className="font-extrabold">
          {value(summary && formatMonthYearGen(Date.parse(summary.since)))}
        </dd>
      </div>
    </dl>
  )
}

// «Сменить пароль ›» row; opens the form in place.
function PasswordRow() {
  const formId = useId()
  const passwordId = useId()
  const repeatId = useId()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setPassword('')
      setRepeat('')
      setOpen(false)
      toast.success('Пароль изменён')
    },
    onError: () => {
      setError('Не удалось сменить пароль. Попробуйте ещё раз.')
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = passwordSchema.safeParse({ password, repeat })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте пароль')
      return
    }
    setError(null)
    mutation.mutate(parsed.data.password)
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          setOpen((v) => !v)
        }}
        className={cn(rowClass, 'min-h-[52px] text-left', open && 'border-b border-line')}
      >
        Сменить пароль
        <ChevronRight
          className={cn('size-[18px] text-ink-muted transition-transform', open && 'rotate-90')}
          strokeWidth={2.5}
          aria-hidden
        />
      </button>
      {open && (
        <form
          id={formId}
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-3 px-[18px] pt-3 pb-[18px]"
        >
          <PasswordField
            id={passwordId}
            label="Новый пароль"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            id={repeatId}
            label="Повторите пароль"
            value={repeat}
            onChange={setRepeat}
          />
          {error && (
            <p role="alert" className="text-sm font-bold text-burned">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={mutation.isPending || !password}
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-extrabold text-brand disabled:opacity-60"
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            Сохранить пароль
          </button>
        </form>
      )}
    </>
  )
}

function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-extrabold tracking-[0.04em] text-ink-muted uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        className="h-12 rounded-2xl border-[1.5px] border-line-strong bg-card px-4 text-base font-bold outline-none focus:border-ink"
      />
    </div>
  )
}
