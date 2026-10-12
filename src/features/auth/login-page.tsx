import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ClipboardEvent, type SubmitEvent } from 'react'
import { InvalidCredentialsError, signIn } from '@/lib/auth'
import { cleanPassword } from '@/lib/password-input'
import { maskPhoneInput, pastedPhoneDigits } from '@/lib/phone-input'
import { DESKTOP_QUERY } from '@/lib/use-is-desktop'

// У1 Вход (docs/design/Login.dc.html): phone + password, no SMS (05-decisions Д1).
export function LoginPage() {
  const phoneId = useId()
  const passwordId = useId()
  const errorId = useId()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const phoneRef = useRef<HTMLInputElement>(null)

  // Desktop: type or paste right away. Phone: the keyboard would cover the form (#33).
  useEffect(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) phoneRef.current?.focus()
  }, [])

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    // The disabled «Войти» already blocks Enter while signing in; this keeps it a single request.
    if (pending) return
    const cleanedPassword = cleanPassword(password)
    if (!phone || !cleanedPassword) {
      setError('Введите телефон и пароль')
      return
    }
    setError(null)
    setPending(true)
    try {
      // No navigate() here: SIGNED_IN re-runs the guards (main.tsx) and /login's beforeLoad
      // redirects to the role's home — a second navigation would race it (#27).
      await signIn(phone, cleanedPassword)
    } catch (err) {
      setError(
        err instanceof InvalidCredentialsError
          ? err.message
          : 'Не удалось войти. Проверьте интернет и попробуйте ещё раз.',
      )
      setPending(false)
    }
  }

  // A copied number replaces whatever is in the field instead of being glued to it.
  function onPhonePaste(e: ClipboardEvent<HTMLInputElement>) {
    const digits = pastedPhoneDigits(e.clipboardData.getData('text'))
    if (digits === null) return
    e.preventDefault()
    setPhone(maskPhoneInput(digits))
  }

  function onPasswordPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const { value, selectionStart, selectionEnd } = e.currentTarget
    const text = e.clipboardData.getData('text')
    setPassword(
      cleanPassword(
        value.slice(0, selectionStart ?? value.length) +
          text +
          value.slice(selectionEnd ?? value.length),
      ),
    )
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
                ref={phoneRef}
                id={phoneId}
                name="phone"
                type="tel"
                inputMode="numeric"
                enterKeyHint="next"
                autoComplete="tel-national"
                placeholder="552 775 771"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(maskPhoneInput(e.target.value))
                }}
                onPaste={onPhonePaste}
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
                enterKeyHint="go"
                autoComplete="current-password"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => {
                  setPassword(cleanPassword(e.target.value))
                }}
                onPaste={onPasswordPaste}
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
