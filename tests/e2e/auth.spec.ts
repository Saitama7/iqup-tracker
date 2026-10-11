import { expect, test, type Page } from '@playwright/test'
import { GULZAT, KANYKEI, login, submitLogin } from './support/auth'

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

test('unauthenticated user is sent to /login', async ({ page }, testInfo) => {
  await page.goto('/today')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('login.png') })
})

test('phone field has +996 prefix and masks input as XXX XXX XXX', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('+996', { exact: true })).toBeVisible()
  const phone = page.getByLabel('Номер телефона')
  await expect(phone).toHaveAttribute('placeholder', '552 775 771')
  await phone.pressSequentially('0555123456')
  await expect(phone).toHaveValue('555 123 456')
})

test('empty form shows an error instead of submitting', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toHaveText('Введите телефон и пароль')
})

test('wrong password shows an error', async ({ page }) => {
  await submitLogin(page, { ...GULZAT, password: 'wrong-password' })
  await expect(page.getByRole('alert')).toHaveText('Неверный телефон или пароль')
  await expect(page).toHaveURL(/\/login$/)
})

test('teacher Гульзат lands on /today with role navigation', async ({ page }, testInfo) => {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Сегодня, Гульзат' })).toBeVisible()
  if (isDesktop(page)) await expect(page.getByText('учитель · 45 %')).toBeVisible()

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
  if (isDesktop(page)) await expect(page.getByText('Каныкей', { exact: true })).toBeVisible()
  else await expect(page.getByRole('link', { name: 'Профиль' })).toHaveText('К')
  await page.screenshot({ path: testInfo.outputPath('admin.png') })

  // Desktop: switch in the sidebar; phone: in У7 Профиль (no sidebar there)
  if (!isDesktop(page)) await page.getByRole('link', { name: 'Профиль' }).click()
  await page.getByRole('link', { name: 'Как учитель' }).click()
  await expect(page).toHaveURL(/\/today$/)
  if (!isDesktop(page)) await page.getByRole('link', { name: 'Профиль' }).click()
  await expect(page.getByRole('link', { name: 'Как администратор' })).toBeVisible()
})

test('profile shows teacher percent; sign out returns to /login', async ({ page }, testInfo) => {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await page.getByRole('link', { name: isDesktop(page) ? /Гульзат/ : 'Профиль' }).click()

  await expect(page).toHaveURL(/\/profile$/)
  const main = page.getByRole('main')
  await expect(main.getByText('Гульзат Асанова')).toBeVisible()
  await expect(main.getByText('+996 555 123 456')).toBeVisible()
  await expect(main.getByText('45 %', { exact: true })).toBeVisible()
  await expect(main.getByText('Мой процент')).toBeVisible()
  if (!isDesktop(page)) {
    // У7 is a pushed screen: back button, no tab bar
    await expect(page.getByRole('link', { name: 'Назад' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeHidden()
  }
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true })

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/today')
  await expect(page).toHaveURL(/\/login$/)
})
