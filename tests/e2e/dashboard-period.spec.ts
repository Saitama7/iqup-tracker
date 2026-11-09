import { expect, test, type Page } from '@playwright/test'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { asAdmin, service } from './support/undo-fixtures'

// #136: А1 card «… · ЗП» reads payroll_periods. The browser is on 8 October (И15 → September);
// the test closes September through close_payroll_period and reopens it afterwards.
const NOW = '2026-10-08T14:24:00+06:00'
const SEPTEMBER = '2026-09-01'

lockSeed('write')
test.use({ serviceWorkers: 'block' })

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

async function pinClock(page: Page) {
  await page.clock.setSystemTime(new Date(NOW))
  await page.route('**/rest/v1/rpc/server_now', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(NOW) }),
  )
}

// A September left closed by a failed run would break every seed-reading spec: errors surface.
async function reopenSeptember() {
  const { data, error } = await service()
    .from('payroll_periods')
    .select('month')
    .eq('month', SEPTEMBER)
  if (error) throw error
  if (!data.length) return
  const admin = await asAdmin()
  const reopen = await admin.rpc('reopen_payroll_period', {
    p_month: SEPTEMBER,
    p_reason: 'e2e #136',
  })
  if (reopen.error) throw reopen.error
}

test.beforeEach(reopenSeptember)
test.afterEach(reopenSeptember)

test('А1: открытый сентябрь, после закрытия — карточка на октябре; Б1 пишет «Период закрыт»', async ({
  page,
}, testInfo) => {
  await pinClock(page)
  await login(page, KANYKEI)

  if (isDesktop(page)) {
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Сентябрь · ЗП' })).toBeVisible()
    await expect(page.getByTestId('payroll-card-status')).toHaveText(
      'Период открыт. Бухгалтер закроет до 15 октября.',
    )
  }

  const admin = await asAdmin()
  const close = await admin.rpc('close_payroll_period', { p_month: SEPTEMBER })
  if (close.error) throw close.error

  if (isDesktop(page)) {
    await page.reload()
    // И15: the closed month gives way to the running one before the 15th.
    await expect(page.getByRole('heading', { name: 'Октябрь · ЗП' })).toBeVisible()
    await expect(page.getByTestId('payroll-card-status')).toHaveText(
      'Период открыт. Бухгалтер закроет до 15 ноября.',
    )
    await expect(page.getByTestId('payroll-card-link')).toHaveAttribute('href', /month=2026-10/)
    await expect(page.getByTestId('payroll-card-link')).toContainText('сом')
    await page.screenshot({ path: testInfo.outputPath('dashboard-1280.png'), fullPage: true })
  }

  // Phone has no А1 card (АМ1); the closed state is on Б1 (same payroll_periods row).
  await page.goto('/payroll?month=2026-09')
  await expect(page.getByText(/Период закрыт/).first()).toBeVisible()
  if (!isDesktop(page))
    await page.screenshot({ path: testInfo.outputPath('payroll-390.png'), fullPage: true })
})
