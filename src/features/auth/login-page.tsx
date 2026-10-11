import { useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { Logo } from '@/components/shell/shell-parts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InvalidCredentialsError, signIn } from '@/lib/auth'
import { maskPhoneInput } from '@/lib/phone-input'
import { homePath } from '@/lib/roles'

// У1 Вход: phone + password, no SMS (05-decisions Д1).
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
    <main className="flex min-h-dvh flex-col bg-paper pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:items-center lg:justify-center">
      <div className="flex w-full flex-1 flex-col lg:max-w-md lg:flex-none">
        <header className="rounded-b-[2rem] bg-brand px-6 pt-12 pb-10 lg:rounded-[2rem] lg:pt-10">
          <Logo className="text-4xl [&>span]:text-ink" />
          <p className="mt-3 text-lg font-semibold text-ink">Учёт занятий и зарплаты</p>
          <p className="mt-1 text-sm font-medium text-ink/70">Учебный центр IQ UP · Бишкек</p>
        </header>

        <form
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          aria-describedby={error ? errorId : undefined}
          className="flex flex-1 flex-col gap-5 px-6 pt-8 pb-6 lg:flex-none"
        >
          <h1 className="font-display text-2xl font-bold text-ink">Вход</h1>

          <div className="flex flex-col gap-2">
            <label htmlFor={phoneId} className="text-sm font-semibold text-ink">
              Телефон
            </label>
            <Input
              id={phoneId}
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="username"
              placeholder="0XXX XXX XXX"
              required
              value={phone}
              onChange={(e) => {
                setPhone(maskPhoneInput(e.target.value))
              }}
              aria-invalid={error ? true : undefined}
              className="h-12 bg-card text-base md:text-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={passwordId} className="text-sm font-semibold text-ink">
              Пароль
            </label>
            <div className="relative">
              <Input
                id={passwordId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                }}
                aria-invalid={error ? true : undefined}
                className="h-12 bg-card pr-12 text-base md:text-base"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-0.5 right-0.5 text-ink-muted"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                aria-pressed={showPassword}
                onClick={() => {
                  setShowPassword((v) => !v)
                }}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>

          {error && (
            <p id={errorId} role="alert" className="text-sm font-semibold text-burned">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={pending || !phone || !password}
            className="h-12 font-display text-base font-bold"
          >
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            Войти
          </Button>

          <p className="mt-auto text-center text-sm text-ink-muted lg:mt-2">
            Пароль выдаёт администратор. Забыли — обратитесь к администратору.
          </p>
        </form>
      </div>
    </main>
  )
}
