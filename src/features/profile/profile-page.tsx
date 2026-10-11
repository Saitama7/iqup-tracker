import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { LoaderCircle, LogOut } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { PageTitle } from '@/components/page'
import { VIEW_LABEL, viewsFor } from '@/components/shell/nav'
import { Avatar } from '@/components/shell/shell-parts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signOut, useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { formatPhone } from '@/lib/phone'
import { hasRole } from '@/lib/roles'
import { changePassword, passwordSchema, profileQuery, teacherPercentQuery } from './api'

// У7 Профиль: name, phone, percent (teachers), password change, sign out.
export function ProfilePage() {
  const { userId, roles } = useSession()
  const isTeacher = hasRole(roles, 'teacher')
  const now = useNow()
  const profile = useQuery(profileQuery(userId))
  const percent = useQuery({ ...teacherPercentQuery(userId, now), enabled: isTeacher })
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

  const name = profile.data?.fullName ?? ''

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageTitle>Профиль</PageTitle>

      <section className="flex items-center gap-4 rounded-2xl border border-line bg-card p-5">
        <Avatar name={name} className="size-14 text-xl" />
        <div className="flex min-w-0 flex-col gap-1">
          {profile.isPending ? (
            <span className="h-6 w-40 animate-pulse rounded bg-muted" />
          ) : profile.isError ? (
            <span className="text-burned">Не удалось загрузить профиль</span>
          ) : (
            <>
              <span className="truncate font-display text-lg font-bold text-ink">{name}</span>
              <span className="whitespace-nowrap text-ink-muted">
                {formatPhone(profile.data.phone)}
              </span>
            </>
          )}
          <span className="flex flex-wrap gap-1.5">
            {viewsFor(roles).map((v) => (
              <span
                key={v}
                className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-ink"
              >
                {VIEW_LABEL[v]}
              </span>
            ))}
          </span>
        </div>
      </section>

      {isTeacher && (
        <section className="flex items-center justify-between gap-4 rounded-2xl bg-ink p-5 text-paper">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-paper/70">Ваш процент</span>
            <span className="text-xs text-paper/60">от цены урока за каждого ученика</span>
          </div>
          <span className="font-display text-3xl font-extrabold text-brand">
            {percent.isPending ? '…' : percent.data != null ? `${percent.data} %` : '—'}
          </span>
        </section>
      )}

      <PasswordForm />

      <Button
        variant="outline"
        className="text-burned hover:text-burned"
        disabled={signingOut}
        onClick={() => void onSignOut()}
      >
        {signingOut ? <LoaderCircle className="animate-spin" aria-hidden /> : <LogOut />}
        Выйти
      </Button>
    </div>
  )
}

function PasswordForm() {
  const passwordId = useId()
  const repeatId = useId()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setPassword('')
      setRepeat('')
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
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5"
    >
      <h2 className="font-display text-lg font-bold text-ink">Смена пароля</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor={passwordId} className="text-sm font-semibold text-ink">
          Новый пароль
        </label>
        <Input
          id={passwordId}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
          className="h-12 text-base md:text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={repeatId} className="text-sm font-semibold text-ink">
          Повторите пароль
        </label>
        <Input
          id={repeatId}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => {
            setRepeat(e.target.value)
          }}
          className="h-12 text-base md:text-base"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-burned">
          {error}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending || !password}>
        {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        Сменить пароль
      </Button>
    </form>
  )
}
