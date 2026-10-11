import { createClient } from '@supabase/supabase-js'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { KANYKEI, login, submitLogin } from './support/auth'

// Needs the local stack + seed users + `supabase functions serve` (create-user).

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element is not visible')
  return b
}

async function signOutLocally(page: Page) {
  await page.evaluate(() => {
    localStorage.clear()
  })
}

// Unique 9-digit national number per test run (starts with 7: no clash with seed phones).
const freshPhone = () => `7${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const spaced = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`

// Users created here are removed afterwards, so screenshots of the seed stay clean.
const created: string[] = []
test.afterAll(async () => {
  if (created.length === 0) return
  const env = localSupabase()
  const service = createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const phone of created) {
    const { data } = await service.from('profiles').select('id').eq('phone', phone).maybeSingle()
    await service.from('teachers').delete().eq('phone', phone)
    if (data) await service.auth.admin.deleteUser(String(data.id))
  }
})

test('А8: tables, phone under the name, nowrap badges', async ({ page }, testInfo) => {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  if (isDesktop(page)) {
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('link', { name: 'Учителя и доступ' })
      .click()
  } else {
    // 390: А8 is reached through the «Ещё» bottom sheet; unbuilt sections are muted.
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('button', { name: 'Ещё' })
      .click()
    const more = page.getByRole('dialog', { name: 'Ещё' })
    await expect(more).toBeVisible()
    await expect(more.getByRole('listitem').filter({ hasText: 'Журнал изменений' })).toContainText(
      'скоро',
    )
    await expect(more.getByRole('link', { name: 'Журнал изменений' })).toHaveCount(0)
    await expect(more.getByRole('link', { name: 'Профиль' })).toBeVisible()
    // let the slide-in finish before the screenshot
    await expect(more).toHaveCSS('transform', 'none')
    await page.screenshot({ path: testInfo.outputPath('more-sheet.png') })
    await more.getByRole('link', { name: 'Учителя и доступ' }).click()
    await expect(more).toBeHidden()
  }
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: 'Учителя и доступ' })).toBeVisible()

  const teachers = page.getByRole('region', { name: 'Учителя' })
  await expect(teachers.getByText('Гульзат Асанова')).toBeVisible()
  await expect(teachers.getByText('0555 123 456')).toBeVisible()
  await expect(teachers.getByText('Математика · 4 группы')).toBeVisible()
  await expect(teachers.getByText('50 %').first()).toBeVisible()

  const staff = page.getByRole('region', { name: 'Администраторы и бухгалтер' })
  await expect(staff.getByText('это вы')).toBeVisible()
  await expect(staff.getByText('Айгерим Маматова')).toBeVisible()

  if (isDesktop(page)) {
    // phone sits under the name, badges stay on one line
    const name = teachers.getByText('Гульзат Асанова')
    const phone = teachers.getByText('0555 123 456')
    const nameBox = await box(name)
    const phoneBox = await box(phone)
    expect(phoneBox.y).toBeGreaterThan(nameBox.y)
    expect(Math.abs(phoneBox.x - nameBox.x)).toBeLessThan(2)
    for (const badge of await teachers.getByText(/^\d+ %$/).all()) {
      expect((await box(badge)).height).toBeLessThan(30)
    }
    // no horizontal scroll in the tables at 1280
    for (const region of [teachers, staff]) {
      const table = await box(region.locator('table'))
      expect(table.width).toBeLessThanOrEqual((await box(region)).width)
    }
  }
  await page.screenshot({ path: testInfo.outputPath('admin-users.png'), fullPage: true })
})

test('admin creates a teacher, changes the percent; the teacher can sign in', async ({
  page,
}, testInfo) => {
  const national = freshPhone()
  const phone = `996${national}`
  const name = `Юлия Тестова ${national.slice(-4)}`
  created.push(phone)

  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/users')

  const form = page.getByRole('form', { name: 'Новый пользователь' })
  await form.getByLabel('Имя и фамилия').fill(name)
  await form.getByLabel('Телефон — это логин').fill(national)
  await expect(form.getByRole('button', { name: 'Учитель' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(form.getByLabel('Процент')).toHaveValue('45')
  const password = await form.getByLabel('Временный пароль').inputValue()
  expect(password).toMatch(/^iqup-[a-z0-9]{4}$/)
  await form.getByRole('button', { name: 'Новый' }).click()
  const newPassword = await form.getByLabel('Временный пароль').inputValue()
  expect(newPassword).toMatch(/^iqup-[a-z0-9]{4}$/)

  await form.getByRole('button', { name: 'Создать и показать пароль' }).click()
  const dialog = page.getByRole('dialog', { name: `Пароль для ${name}` })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('issued-password')).toHaveText(newPassword)
  await expect(dialog.getByText(`+996 ${spaced(national)}`)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('password-dialog.png') })
  await dialog.getByRole('button', { name: 'Готово' }).click()
  // Radix hides the page from the a11y tree until the dialog is gone
  await expect(dialog).toBeHidden()

  // New rate from a date: a new teacher_rates row from 01.11.2026, the old one stays.
  const teachers = page.getByRole('region', { name: 'Учителя' })
  const more = teachers.getByRole('button', { name: /^ещё \d+/ })
  if (await more.isVisible()) await more.click()
  await teachers.getByRole('button', { name: `Изменить: ${name}` }).click()
  const edit = page.getByRole('dialog', { name })
  await expect(
    edit.getByRole('list', { name: 'История процента' }).getByRole('listitem'),
  ).toHaveCount(1)
  await edit.getByLabel('Новый процент').fill('50')
  await edit.getByLabel('Действует с').fill('01.11.2026')
  await edit.getByRole('button', { name: 'Новая ставка с даты' }).click()
  const history = edit.getByRole('list', { name: 'История процента' })
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history.getByRole('listitem').first()).toContainText('с 01.11.2026')
  await expect(history.getByRole('listitem').first()).toContainText('50 %')
  await expect(history.getByRole('listitem').last()).toContainText('45 %')

  // same date again → explained 409, nothing overwritten
  await edit.getByLabel('Новый процент').fill('55')
  await edit.getByRole('button', { name: 'Новая ставка с даты' }).click()
  await expect(edit.getByRole('alert')).toHaveText(/С этой даты процент уже задан/)
  await expect(history.getByRole('listitem')).toHaveCount(2)

  // Fix a typo in the current rate: the same row changes, no new one.
  const fix = edit.getByRole('form', { name: 'Исправить текущий процент' })
  await fix.getByLabel(/^Текущий, с/).fill('47')
  await fix.getByRole('button', { name: 'Исправить' }).click()
  await expect(history.getByRole('listitem').last()).toContainText('47 %')
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history.getByRole('listitem').first()).toContainText('50 %')
  await page.screenshot({ path: testInfo.outputPath('rate-editor.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // The new teacher signs in with the issued password.
  await signOutLocally(page)
  await login(page, { phone: national, password: newPassword })
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: /Сегодня, Юлия/ })).toBeVisible()
})

test('deactivated user cannot sign in; admin role cannot be removed from self', async ({
  page,
}) => {
  const national = freshPhone()
  const name = `Ярослав Бухов ${national.slice(-4)}`
  created.push(`996${national}`)

  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/users')

  const form = page.getByRole('form', { name: 'Новый пользователь' })
  await form.getByLabel('Имя и фамилия').fill(name)
  await form.getByLabel('Телефон — это логин').fill(national)
  await form.getByRole('button', { name: 'Учитель' }).click()
  await form.getByRole('button', { name: 'Бухгалтер' }).click()
  await expect(form.getByLabel('Процент')).toBeHidden()
  const password = await form.getByLabel('Временный пароль').inputValue()
  await form.getByRole('button', { name: 'Создать и показать пароль' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  const staff = page.getByRole('region', { name: 'Администраторы и бухгалтер' })
  await staff.getByRole('button', { name: `Изменить: ${name}` }).click()
  const edit = page.getByRole('dialog', { name })
  await edit.getByRole('button', { name: 'Отключить доступ' }).click()
  await edit.getByRole('button', { name: 'Да, отключить' }).click()
  await expect(edit.getByText('Доступ закрыт')).toBeVisible()
  await expect(edit.getByRole('button', { name: 'Включить доступ' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // Self: Каныкей's own admin toggle is locked (from the teachers table).
  const teachers = page.getByRole('region', { name: 'Учителя' })
  const more = teachers.getByRole('button', { name: /^ещё \d+/ })
  if (await more.isVisible()) await more.click()
  await teachers.getByRole('button', { name: 'Изменить: Каныкей' }).click()
  const self = page.getByRole('dialog', { name: 'Каныкей' })
  await expect(self.getByRole('button', { name: 'Админ' })).toBeDisabled()
  await expect(self.getByRole('button', { name: 'Отключить доступ' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  await signOutLocally(page)
  await submitLogin(page, { phone: national, password })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})
