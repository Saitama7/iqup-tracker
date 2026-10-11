import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/features/tariffs/settings-page'

// А9 Тарифы и праздники (docs/design/AdminSettings.dc.html); role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/settings')({
  component: SettingsPage,
})
