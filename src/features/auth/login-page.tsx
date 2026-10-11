import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { InvalidCredentialsError, signIn } from '@/lib/auth'
import { maskPhoneInput } from '@/lib/phone-input'
import { homePath } from '@/lib/roles'

// У1 Вход (docs/design/Login.dc.html): phone + password, no SMS (05-decisions Д1).
export function LoginPage() {
  const navigate = useNavigate()
  const phoneId = useId()
  const passwordId = useId()
  const errorId = useId()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!phone || !password) {
      setError('Введите телефон и пароль')
      return
    }
    setError(null)
    setPending(true)
    try {
      const auth = await signIn(phone, password)
      await navigate({ to: homePath(auth.roles), replace: true })
    } catch (err) {
      setError(
        err instanceof InvalidCredentialsError
          ? err.message
          : 'Не удалось войти. Проверьте интернет и попробуйте ещё раз.',
      )
      setPending(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-brand text-ink min-[900px]:items-center min-[900px]:justify-center">
      <div
        aria-hidden
        className="absolute -top-[60px] -left-20 size-[300px] rounded-full bg-brand-soft"
      />
      <div
        aria-hidden
        className="absolute top-[120px] -right-[110px] size-[260px] rounded-full bg-brand-deep"
      />

      <div className="relative flex w-full flex-1 flex-col min-[900px]:max-w-[420px] min-[900px]:flex-none">
        <header className="flex flex-col items-start gap-[22px] px-7 pt-[max(6rem,calc(env(safe-area-inset-top)+3.5rem))] min-[900px]:pt-0">
          <div className="flex size-24 items-center justify-center rounded-full bg-paper shadow-float">
            <span className="font-display text-[22px] font-extrabold tracking-[-0.02em]">
              IQ UP
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="font-display text-[30px] leading-[1.1] font-extrabold">Tracker</p>
            <p className="text-[15px] leading-[1.4] font-bold opacity-75">
              Занятия, посещаемость
              <br />и зарплата — без споров
            </p>
          </div>
        </header>

        <form
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          aria-describedby={error ? errorId : undefined}
          className="mt-auto flex flex-col gap-4 rounded-t-[32px] bg-paper px-6 pt-7 pb-[max(2.5rem,env(safe-area-inset-bottom))] shadow-sheet min-[900px]:mt-10 min-[900px]:rounded-[32px] min-[900px]:pb-8"
        >
          <h1 className="font-display text-lg font-bold">Вход</h1>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={phoneId} className={labelClass}>
              Номер телефона
            </label>
            <div className={fieldClass}>
              <span className="text-base font-extrabold text-ink-muted">+996</span>
              <input
                id={phoneId}
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="552 775 771"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(maskPhoneInput(e.target.value))
                }}
                aria-invalid={error ? true : undefined}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={passwordId} className={labelClass}>
              Пароль
            </label>
            <div className={fieldClass}>
              <input
                id={passwordId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                }}
                aria-invalid={error ? true : undefined}
                className={inputClass}
              />
              <button
                type="button"
                className="-mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                aria-pressed={showPassword}
                onClick={() => {
                  setShowPassword((v) => !v)
                }}
              >
                {showPassword ? (
                  <EyeOff className="size-5" strokeWidth={2.2} aria-hidden />
                ) : (
                  <Eye className="size-5" strokeWidth={2.2} aria-hidden />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p id={errorId} role="alert" className="text-sm font-bold text-burned">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 flex min-h-14 items-center justify-center gap-2.5 rounded-[18px] bg-ink text-base font-extrabold text-brand shadow-cta transition-opacity disabled:opacity-60"
          >
            Войти
            {pending ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden />
            ) : (
              <ArrowRight className="size-5" strokeWidth={2.5} aria-hidden />
            )}
          </button>

          <p className="text-center text-[13px] font-bold text-ink-muted">
            Забыли пароль? Обратитесь к администратору
          </p>
        </form>
      </div>
    </main>
  )
}

const labelClass = 'text-xs font-extrabold tracking-[0.04em] text-ink-muted uppercase'
const fieldClass =
  'flex min-h-14 items-center gap-2.5 rounded-2xl border-[1.5px] border-line-strong bg-card px-4 focus-within:border-ink'
const inputClass =
  'h-[52px] min-w-0 flex-1 bg-transparent p-0 text-[17px] font-bold text-ink outline-none placeholder:text-placeholder'
