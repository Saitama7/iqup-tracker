import { createFileRoute } from '@tanstack/react-router'
import { TodayPage } from '@/features/lessons/today-page'
import { requireRole } from '@/lib/guards'

// У2 / УД1 «Сегодня». Admin+teacher (Каныкей) gets here via «Как учитель».
export const Route = createFileRoute('/_app/today')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: TodayPage,
})
