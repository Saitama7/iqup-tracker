import { expect, test, type Page } from '@playwright/test'
import { AIGERIM, GULZAT, KANYKEI, login, type Credentials } from './support/auth'

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

/** No Supabase session left in storage, and the app shell sends us back to /login. */
async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/login$/)
  const tokens = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('sb-')),
  )
  expect(tokens).toEqual([])
  await page.goto('/today')
  await expect(page).toHaveURL(/\/login$/)
}

const ROLES: [string, Credentials, string][] = [
  ['teacher', GULZAT, 'Гульзат'],
  ['admin', KANYKEI, 'Каныкей'],
  ['accountant', AIGERIM, 'Айгерим'],
]

for (const [role, user, name] of ROLES) {
  test(`desktop: ${role} signs out from the sidebar`, async ({ page }, testInfo) => {
    test.skip(!isDesktop(page), 'sidebar is desktop-only')
    await login(page, user)
    const sidebar = page.getByRole('complementary')
    await expect(sidebar.getByText(name, { exact: true })).toBeVisible()
    const signOut = sidebar.getByRole('button', { name: 'Выйти' })
    await expect(signOut).toBeVisible()
    expect((await signOut.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    if (role === 'teacher') await page.screenshot({ path: testInfo.outputPath('sidebar.png') })

    await signOut.click()
    await expectSignedOut(page)
  })
}

test('phone: admin signs out from the «Ещё» sheet', async ({ page }, testInfo) => {
  test.skip(isDesktop(page), '«Ещё» is the phone tab bar')
  await login(page, KANYKEI)
  await page
    .getByRole('navigation', { name: 'Основное меню' })
    .getByRole('button', { name: 'Ещё' })
    .click()
  const more = page.getByRole('dialog', { name: 'Ещё' })
  await expect(more).toHaveCSS('transform', 'none')
  await page.screenshot({ path: testInfo.outputPath('more-sheet.png') })

  await more.getByRole('button', { name: 'Выйти' }).click()
  await expectSignedOut(page)
})
