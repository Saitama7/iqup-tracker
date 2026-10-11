import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/page'
import { requireRole } from '@/lib/guards'
import { useIsDesktop } from '@/lib/use-is-desktop'

export const Route = createFileRoute('/_app/groups')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  // У4 «Мои группы» on the phone, УД3 «Группы и ученики» on desktop.
  component: function GroupsPage() {
    return <ComingSoon title={useIsDesktop() ? 'Группы и ученики' : 'Мои группы'} />
  },
})
