import { expect, test, type Locator, type Page } from '@playwright/test'

// #33: Кайрат and Каныкей copy the phone and password from WhatsApp/Excel — «вставил → Enter».
const NBSP = String.fromCharCode(0xa0)
const ZWSP = String.fromCharCode(0x200b)
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

/** A real clipboard paste: the page's paste handler gets the text as the browser would hand it over. */
async function paste(field: Locator, text: string) {
  await field.focus()
  await field.evaluate((el, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, text)
}

test('pasted dirty phone and password, Enter in the password field signs Каныкей in', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  const phone = page.getByLabel('Номер телефона')
  const password = page.getByLabel('Пароль', { exact: true })

  await paste(phone, `тел: +996${NBSP}(552)\t77-57-71\n`)
  await expect(phone).toHaveValue('552 775 771')
  await paste(password, ` iqup-${ZWSP}demo${NBSP}\n`)
  await expect(password).toHaveValue('iqup-demo')
  await page.screenshot({ path: testInfo.outputPath('login-pasted.png') })

  await password.press('Enter')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toHaveCount(0)
})

test('Enter in the phone field submits the form', async ({ page }) => {
  await page.goto('/login')
  const phone = page.getByLabel('Номер телефона')
  // fill() goes through onChange like typing/autofill does
  await page.getByLabel('Пароль', { exact: true }).fill('iqup- demo ')
  await phone.fill('0555 123 456')
  await expect(phone).toHaveValue('555 123 456')
  await phone.press('Enter')
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Сегодня, Гульзат' })).toBeVisible()
})

test('Enter with a wrong password shows the error and stays on /login', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Номер телефона').fill('555 123 456')
  const password = page.getByLabel('Пароль', { exact: true })
  await password.fill('wrong-password')
  await password.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Неверный телефон или пароль')
  await expect(page).toHaveURL(/\/login$/)
})

test('mobile keyboard hints: «next» on the phone, «go» on the password', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Номер телефона')).toHaveAttribute('enterkeyhint', 'next')
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute('enterkeyhint', 'go')
})

test('phone field is focused on desktop only', async ({ page }) => {
  await page.goto('/login')
  const phone = page.getByLabel('Номер телефона')
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  if (isDesktop(page)) await expect(phone).toBeFocused()
  else await expect(phone).not.toBeFocused()
})
