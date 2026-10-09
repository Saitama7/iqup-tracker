import { Button } from '@/components/ui/button'

// Placeholder until real screens land (R1).
export function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <h1 className="font-display text-3xl font-bold text-ink">IQ UP Tracker</h1>
      <Button className="bg-brand text-ink hover:bg-brand/90">Начать</Button>
    </main>
  )
}
