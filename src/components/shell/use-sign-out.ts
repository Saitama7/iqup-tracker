import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { signOut } from '@/lib/auth'

/** «Выйти» without confirmation: sidebar, «Ещё» sheet, У7 Профиль. */
export function useSignOut() {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function run() {
    setSigningOut(true)
    try {
      await signOut()
      await navigate({ to: '/login', replace: true })
    } catch {
      toast.error('Не удалось выйти. Попробуйте ещё раз.')
      setSigningOut(false)
    }
  }

  return {
    signingOut,
    signOut: () => {
      void run()
    },
  }
}
