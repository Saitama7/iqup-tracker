/// <reference lib="dom" />
import { expect, test, type Page, type TestInfo } from '@playwright/test'

// Needs the local stack + `pnpm seed:users`. Seed: September 2026 is held for every group
// (Гульзат: 52 lessons, 318 student-lessons = 38 160 сом; all five teachers — 47 546 сом),
// October is not confirmed. The browser clock is pinned to Thursday 8 October (the artboards' date)
// and server_now() answers the same instant (docs/02-architecture.md §7.1).
const GULZAT = { phone: '555 123 456', password: 'iqup-demo' }
const KANYKEI = { phone: '552 775 771', password: 'iqup-demo' } // admin + teacher
const AIGERIM = { phone: '555 300 300', password: 'iqup-demo' } // accountant
const NOW = '2026-10-08T14:24:00+06:00'

test.use({ serviceWorkers: 'block' })

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

async function pinClock(page: Page, iso: string) {
  await page.clock.setSystemTime(new Date(iso))
  await page.route('**/rest/v1/rpc/server_now', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(iso) }),
  )
}

async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Номер телефона').fill(user.phone)
  await page.getByLabel('Пароль', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

/** Гульзат lands on «Сегодня»; settle the post-login redirect before page.goto (#27). */
async function loginTeacher(page: Page) {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: /^Сегодня/ })).toBeVisible()
}

const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'
const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

test('Гульзат: «Мой месяц» — октябрь не подтверждён, сентябрь 38 160 (У6 / УД4)', async ({
  page,
}, testInfo) => {
  await pinClock(page, NOW)
  await loginTeacher(page)
  await page.goto('/my-month')

  // October: nothing confirmed yet — 0 in the sum, the lessons that are over wait for «Провести».
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    isDesktop(page) ? 'Октябрь 2026' : 'Октябрь',
  )
  await expect(page.getByTestId('pay-sum')).toHaveText('0')
  if (isDesktop(page)) {
    await expect(page.getByText('Предварительно · 1–8 окт')).toBeVisible()
    // 1–7 October: 12 lessons + today 09:00 and 11:00 (8 класс Б at 14:00 is still on)
    await expect(page.getByTestId('kpi-unconfirmed')).toHaveText('14')
    await expect(
      page.getByRole('table', { name: 'Занятия в октябре' }).getByRole('link', {
        name: 'Подтвердить →',
      }),
    ).toHaveCount(7)
  } else {
    const missed = page.getByRole('region', { name: 'Не подтверждено — не в ЗП' })
    await expect(missed.getByRole('link', { name: 'Подтвердить →' })).toHaveCount(14)
  }

  // «← Сентябрь»: the month is in the URL.
  await page.getByRole('link', { name: 'Сентябрь' }).click()
  await expect(page).toHaveURL(/\/my-month\?month=2026-09$/)
  await expect(page.getByTestId('pay-sum')).toHaveText('38 160')
  await expect(page.getByText('Предварительно · период открыт')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Октябрь' })).toBeVisible()

  if (isDesktop(page)) {
    await expect(page.getByText('52 · 52 ч')).toBeVisible()
    await expect(page.getByText('318', { exact: true })).toBeVisible()
    const groups = page.getByRole('region', { name: 'По группам' })
    await expect(groups).toContainText('8 класс Б · 97 уч-ур')
    await expect(groups).toContainText('11 640')
    await expect(groups).toContainText('Итого')
    const table = page.getByRole('table', { name: 'Занятия в сентябре' })
    await expect(table.getByRole('row')).toHaveCount(1 + 7 + 1) // head, 7 lessons, «ещё 45»
    await expect(table.getByRole('row').nth(1)).toContainText('30 сен, ср · 15:00')
    await expect(page.getByText('Сумма = ученико-уроки × 266,67 сом × 45 %.')).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'my-month'), fullPage: true })
    await table.getByRole('button', { name: 'ещё 45 занятий' }).click()
    await expect(table.getByRole('row')).toHaveCount(1 + 52)
  } else {
    await expect(page.getByText('120 сом за ученико-урок')).toBeVisible()
    const groups = page.getByRole('region', { name: 'По группам' })
    await expect(groups.getByRole('link')).toHaveCount(4)
    await expect(groups.getByRole('link').first()).toContainText('Математика · 8 класс Б')
    await expect(groups.getByRole('link').first()).toContainText(
      '13 занятий · 97 ученико-уроков · 8 учеников',
    )
    await expect(page.getByText('К выплате сейчас')).toBeVisible()
    const lessons = page.getByRole('region', { name: 'Занятия в сентябре' })
    await expect(lessons.getByRole('listitem')).toHaveCount(7)
    await expect(lessons.getByRole('button', { name: 'ещё 45 занятий' })).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'my-month'), fullPage: true, style: noTabBar })
  }
})

test('«Мой месяц» with reduced motion: no tilt, the sum without count-up', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await pinClock(page, NOW)
  await loginTeacher(page)
  await page.goto('/my-month?month=2026-09')
  await expect(page.getByTestId('pay-sum')).toHaveText('38 160', { timeout: 1_000 })
  await expect(page.getByTestId('pay-card-tilt')).toHaveCount(0)
})

test('Б1 «Расчёт ЗП»: accountant sees every teacher, closing is R3', async ({ page }, testInfo) => {
  await pinClock(page, NOW)
  await login(page, AIGERIM)
  // Until the 15th the payroll screen opens on the month being paid — September.
  await expect(page).toHaveURL(/\/payroll$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    isDesktop(page) ? 'Сентябрь 2026' : 'Сентябрь',
  )
  await expect(page.getByTestId('payroll-total')).toContainText('47 546')

  if (isDesktop(page)) {
    // Teachers other specs create (А8) show up with zeros — the count is not pinned.
    await expect(
      page.getByText(
        /^Выплата 15 октября · \d+ учител\S+ · 109 занятий проведено · 0 не подтверждено$/,
      ),
    ).toBeVisible()
    await expect(page.getByTestId('payroll-unconfirmed')).toHaveText('0')
    await expect(page.getByText('можно закрывать')).toBeVisible()
    const table = page.getByRole('table', { name: 'Учителя' })
    const gulzat = table.getByRole('row', { name: /Гульзат Асанова/ })
    await expect(gulzat).toContainText('Математика · 4 группы')
    await expect(gulzat).toContainText('318')
    await expect(gulzat).toContainText('38 160')
    // Нургуль: after-school — 22 lessons, 66 hours
    await expect(table.getByRole('row', { name: /Нургуль Токтоева/ })).toContainText('66')
    await expect(page.getByRole('button', { name: 'Закрыть период' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Сверка со старой схемой' })).toBeDisabled()
  } else {
    const list = page.getByRole('region', { name: 'По учителям' })
    await expect(list.getByRole('listitem').first()).toContainText('52 зан · 318 уч-ур · 45 %')
    await expect(page.getByRole('button', { name: 'Закрыть сентябрь' })).toBeDisabled()
  }
  await page.screenshot({ path: shot(testInfo, 'payroll'), fullPage: true })

  // October so far: nothing held.
  await page.getByRole('link', { name: 'Октябрь' }).click()
  await expect(page).toHaveURL(/\/payroll\?month=2026-10$/)
  await expect(page.getByTestId('payroll-total')).toContainText('0')
})

test('admin: А1 card «Расчёт ЗП → 47 546 сом» opens Б1 read-only', async ({ page }) => {
  test.skip(!isDesktop(page), 'the card is on А1 (desktop)')
  await pinClock(page, NOW)
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  const card = page.getByTestId('payroll-card-link')
  await expect(card).toHaveText('Расчёт ЗП → 47 546 сом')
  await card.click()
  await expect(page).toHaveURL(/\/payroll\?month=2026-09$/)
  await expect(page.getByTestId('payroll-total')).toContainText('47 546')
  await expect(page.getByRole('button', { name: 'Закрыть период' })).toBeDisabled()
})

test('УД1: month card from v_payroll_preview', async ({ page }) => {
  test.skip(!isDesktop(page), 'the month card is on УД1 (desktop)')
  await pinClock(page, NOW)
  await loginTeacher(page)
  // October: nothing confirmed in the seed yet.
  await expect(page.getByTestId('month-card-sum')).toHaveText('0 сом')
})

test('teacher opening /payroll sees 403', async ({ page }) => {
  await pinClock(page, NOW)
  await loginTeacher(page)
  await page.goto('/payroll')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
})
