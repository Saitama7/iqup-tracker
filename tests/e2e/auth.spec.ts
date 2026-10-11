import { expect, test, type Page } from '@playwright/test'

// Seed users (`pnpm seed:users`): password iqup-demo for everyone.
const GULZAT = { phone: '0555 123 456', password: 'iqup-demo' } // teacher
const KANYKEI = { phone: '0552 775 771', password: 'iqup-demo' } // admin + teacher

async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Телефон').fill(user.phone)
  await page.getByLabel('Пароль', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

test('unauthenticated user is sent to /login', async ({ page }, testInfo) => {
  await page.goto('/today')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('login.png') })
})

test('phone field masks input as 0XXX XXX XXX', async ({ page }) => {
  await page.goto('/login')
  const phone = page.getByLabel('Телефон')
  await phone.pressSequentially('0555123456')
  await expect(phone).toHaveValue('0555 123 456')
})

test('wrong password shows an error', async ({ page }) => {
  await login(page, { ...GULZAT, password: 'wrong-password' })
  await expect(page.getByRole('alert')).toHaveText('Неверный телефон или пароль')
  await expect(page).toHaveURL(/\/login$/)
})

test('teacher Гульзат lands on /today with role navigation', async ({ page }, testInfo) => {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()
  if (isDesktop(page)) await expect(page.getByText('Гульзат Асанова')).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Основное меню' })
  await expect(nav.getByRole('link', { name: 'Сегодня' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Группы' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Мой месяц' })).toBeVisible()
  const box = await nav.boundingBox()
  if (isDesktop(page)) {
    // left sidebar
    expect(box?.x).toBeLessThan(40)
    expect(box?.height).toBeGreaterThan(300)
  } else {
    // bottom tab bar
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(800)
  }
  await page.screenshot({ path: testInfo.outputPath('today.png') })

  await nav.getByRole('link', { name: 'Группы' }).click()
  await expect(page).toHaveURL(/\/groups$/)
})

test('teacher opening /admin sees 403', async ({ page }) => {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  await expect(page.getByText('403')).toBeVisible()
})

test('admin+teacher Каныкей lands on /admin and can switch to teacher', async ({
  page,
}, testInfo) => {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  if (isDesktop(page)) await expect(page.getByText('Каныкей')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin.png') })

  await page.getByRole('link', { name: 'Как учитель' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('link', { name: 'Как администратор' })).toBeVisible()
})

test('profile shows teacher percent; sign out returns to /login', async ({ page }, testInfo) => {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await page.getByRole('link', { name: isDesktop(page) ? /Гульзат/ : 'Профиль' }).click()

  await expect(page).toHaveURL(/\/profile$/)
  const main = page.getByRole('main')
  await expect(main.getByText('Гульзат Асанова')).toBeVisible()
  await expect(main.getByText('0555 123 456')).toBeVisible()
  await expect(main.getByText('45 %')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true })

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/today')
  await expect(page).toHaveURL(/\/login$/)
})
