import { expect, type Page } from '@playwright/test'

// Seed users (`pnpm seed:users`): password iqup-demo for everyone.
export interface Credentials {
  phone: string
  password: string
}

export const GULZAT: Credentials = { phone: '555 123 456', password: 'iqup-demo' } // teacher
export const KANYKEI: Credentials = { phone: '552 775 771', password: 'iqup-demo' } // admin + teacher
export const AIGERIM: Credentials = { phone: '555 300 300', password: 'iqup-demo' } // accountant

/** Fills the login form and presses «Войти» — nothing more (for the error cases). */
export async function submitLogin(page: Page, user: Credentials) {
  await page.goto('/login')
  await page.getByLabel('Номер телефона').fill(user.phone)
  await page.getByLabel('Пароль', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

/**
 * Signs in and waits until the role's home screen is drawn inside the app shell, so the next
 * page.goto never interrupts the post-login redirect (#27).
 */
export async function login(page: Page, user: Credentials) {
  await submitLogin(page, user)
  await expect(page).not.toHaveURL(/\/login$/)
  // the login form is gone and the app shell is up (an accountant's phone has no tab bar)
  await expect(page.getByRole('heading', { name: 'Вход' })).toHaveCount(0)
  await expect(page.getByRole('main')).toBeVisible()
}
