import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { phoneToEmail } from '@/lib/phone'
import { queryClient } from '@/lib/query-client'
import { parseRoles, type Role } from '@/lib/roles'
import { supabase } from '@/lib/supabase/client'

export interface Auth {
  session: Session
  userId: string
  roles: Role[]
}

export function toAuth(session: Session | null): Auth | null {
  if (!session) return null
  return { session, userId: session.user.id, roles: parseRoles(session.user.app_metadata) }
}

/** Current session for route guards (reads the persisted session, refreshing it if expired). */
export async function getAuth(): Promise<Auth | null> {
  const { data } = await supabase.auth.getSession()
  return toAuth(data.session)
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Неверный телефон или пароль')
    this.name = 'InvalidCredentialsError'
  }
}

export async function signIn(phone: string, password: string): Promise<Auth> {
  let email: string
  try {
    email = phoneToEmail(phone)
  } catch {
    throw new InvalidCredentialsError()
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // 400 invalid_credentials; anything else (network, 5xx, rate limit) is surfaced as is
    if (error.status === 400) throw new InvalidCredentialsError()
    throw error
  }
  const auth = toAuth(data.session)
  if (!auth) throw new Error('Supabase вернул пустую сессию')
  return auth
}

export async function signOut(): Promise<void> {
  // scope local: sign out this device even when offline
  await supabase.auth.signOut({ scope: 'local' })
  queryClient.clear()
}

const AuthContext = createContext<Auth | null | undefined>(undefined)

/**
 * Keeps React (and the router via onChange) in sync with Supabase auth events.
 * `initial` comes from getAuth() before the first render, so there is no "loading" state.
 */
export function AuthProvider({
  initial,
  children,
  onChange,
}: {
  initial: Auth | null
  children: ReactNode
  onChange?: () => void
}) {
  const [auth, setAuth] = useState<Auth | null>(initial)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setAuth(toAuth(session))
      // Token refresh only swaps the JWT; sign-in/out and role changes re-run route guards.
      if (event !== 'TOKEN_REFRESHED' && event !== 'INITIAL_SESSION') onChange?.()
    })
    return () => {
      data.subscription.unsubscribe()
    }
  }, [onChange])

  return <AuthContext value={auth}>{children}</AuthContext>
}

/** Current session or `null` when signed out. */
export function useMaybeSession(): Auth | null {
  const auth = useContext(AuthContext)
  if (auth === undefined) throw new Error('useMaybeSession outside AuthProvider')
  return auth
}

/** Signed-in user inside the app shell (the shell renders nothing without a session). */
export function useSession(): Auth {
  const auth = useMaybeSession()
  if (!auth) throw new Error('useSession without a session — render it inside the app shell')
  return auth
}
