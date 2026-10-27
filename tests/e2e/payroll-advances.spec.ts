/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { Database } from '../../src/lib/supabase/types.gen'
import { localSupabase } from '../../scripts/local-supabase'
import { AIGERIM, GULZAT, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// #83 · advances: the accountant issues one on Б1 → «К выплате» goes down, the accrual stays →
// the teacher sees it in «Мой месяц» → the accountant deletes it with a reason. Needs the local
// stack + `pnpm seed:users`. Seed: Гульзат, September 2026 — 38 160 сом, everyone — 53 171 («Байхан», К11).
const NOW = '2026-10-08T14:24:00+06:00'
const GULZAT_ID = '00000000-0000-4000-a000-000000000001'

// An advance in September changes the sums payroll.spec pins (И20, #27).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(1200) // dialogs fade in, the pay card counts up (0.9 s)
  await page.screenshot({
    path: `docs/screenshots/r83-${name}-${size(testInfo)}.png`,
    style: noTabBar,
  })
}

async function pinClock(page: Page, iso: string) {
  await page.clock.setSystemTime(new Date(iso))
  await page.route('**/rest/v1/rpc/server_now', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(iso) }),
  )
}

const env = localSupabase()
const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const COMMENT = 'e2e аванс'

// A failed run must not leave the advance behind — the seed sums would be off for everyone.
test.afterEach(async () => {
  await service.from('payroll_adjustments').delete().eq('comment', COMMENT)
})

test('бухгалтер выдаёт аванс → «К выплате» меньше → учитель видит его в «Мой месяц»', async ({
  page,
  browser,
}, testInfo) => {
  await pinClock(page, NOW)
  await login(page, AIGERIM)
  await expect(page).toHaveURL(/\/payroll$/)
  await expect(page.getByTestId('payroll-total')).toContainText('53 171')

  const row = page.getByTestId(`payroll-row-${GULZAT_ID}`)
  if (isDesktop(page)) {
    await row.getByRole('button', { name: 'Выдать аванс' }).click()
  } else {
    await row.click()
    await page.getByRole('button', { name: 'Выдать аванс' }).click()
  }

  const form = page.getByRole('form', { name: 'Выдать аванс' })
  await expect(page.getByRole('dialog', { name: 'Аванс · Гульзат Асанова' })).toBeVisible()
  // А8: the month of the issue date (8 October) by default; the advance is for September's pay.
  await expect(form.getByLabel('В счёт ЗП за')).toHaveValue('2026-10')
  await form.getByLabel('Сумма, сом').fill('5000')
  await form.getByLabel('В счёт ЗП за').selectOption('2026-09')
  await form.getByLabel('Комментарий').fill(COMMENT)
  await expect(form.getByTestId('advance-preview-to-pay')).toHaveText('33 160 сом')
  await shot(page, 'issue', testInfo)
  await form.getByRole('button', { name: 'Выдать аванс − 5 000' }).click()
  await expect(page.getByText('Аванс 5 000 сом · Гульзат · в счёт ЗП за сентябрь')).toBeVisible()

  // «К выплате» = 38 160 − 5 000; the accrual is untouched.
  await expect(row.getByTestId('payroll-to-pay')).toHaveText('33 160')
  await expect(page.getByTestId('payroll-total')).toContainText('46 146')
  await expect(page.getByTestId('payroll-advances')).toContainText('5 000')
  if (isDesktop(page)) {
    await expect(row).toContainText('38 160')
    await row.getByRole('button', { name: /История авансов/ }).click()
  } else {
    await expect(row).toContainText('аванс − 5 000')
  }
  const history = page.getByRole('list', { name: 'Авансы' })
  await expect(history).toContainText('8 окт · аванс · Айгерим')
  await expect(history).toContainText(COMMENT)
  await shot(page, 'payroll', testInfo)

  // The teacher sees it in «Мой месяц».
  const teacher = await browser.newPage({ viewport: page.viewportSize() })
  await pinClock(teacher, NOW)
  await login(teacher, GULZAT)
  await teacher.goto('/my-month?month=2026-09')
  await expect(teacher.getByTestId('my-advance')).toContainText('− 5 000')
  await expect(teacher.getByTestId('my-advance')).toContainText(COMMENT)
  await expect(teacher.getByTestId('my-to-pay').last()).toHaveText('33 160 сом')
  if (isDesktop(teacher)) {
    await expect(teacher.getByTestId('my-month-accrued')).toHaveText(
      'начислено 38 160 · аванс − 5 000',
    )
  } else {
    await expect(teacher.getByTestId('pay-sum')).toHaveText('38 160') // начислено
  }
  await expect(teacher.getByText('бухгалтер внесёт авансы')).toHaveCount(0)
  await shot(teacher, 'my-month', testInfo)
  await teacher.close()

  // A mistaken advance: deleted with a reason — the sums are back.
  await history.getByRole('button', { name: 'Действия: аванс 5 000 сом' }).click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  const remove = page.getByRole('form', { name: 'Удалить аванс' })
  await remove.getByRole('button', { name: 'Удалить' }).click()
  await expect(remove.getByRole('alert')).toHaveText('Укажите причину')
  await remove.getByLabel('Причина').fill('ошиблись месяцем')
  await remove.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Аванс 5 000 сом удалён')).toBeVisible()
  await expect(page.getByTestId('payroll-total')).toContainText('53 171')
  await expect(row.getByTestId('payroll-to-pay')).toHaveText('38 160')
})
