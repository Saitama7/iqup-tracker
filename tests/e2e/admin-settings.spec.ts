import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { KANYKEI, login } from './support/auth'

// Needs the local stack + `pnpm seed:users`. Screenshots of the seed: run with --workers=1,
// otherwise the other project's planned tariff / holiday may show up in them.

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/** Today in Asia/Bishkek (UTC+6) and the 1st of next month — the earliest new tariff (К6). */
function planDates() {
  const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10)
  const [y = 0, m = 1] = today.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const ru = (iso: string) => iso.split('-').reverse().join('.')
  return {
    todayRu: ru(today),
    nextRu: ru(next),
    nextLong: `1 ${MONTHS_GEN[Number(next.slice(5, 7)) - 1]}`,
  }
}

// Dates per project, so the two viewports never write the same row.
const fixtures = (testInfo: TestInfo) =>
  testInfo.project.name === 'webkit-desktop'
    ? { holiday: '2030-06-04', holidayRu: '04.06.2030', plan: '2041-09-01', planRu: '01.09.2041' }
    : { holiday: '2030-06-03', holidayRu: '03.06.2030', plan: '2040-09-01', planRu: '01.09.2040' }

test.afterAll(async () => {
  const env = localSupabase()
  const service = createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const f = fixtures(test.info())
  await service.from('holidays').delete().eq('day', f.holiday)
  await service.from('tariffs').delete().eq('valid_from', f.plan)
})

test('А9: current tariffs, rules, holidays; А9а history panel', async ({ page }, testInfo) => {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  if (isDesktop(page)) {
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('link', { name: 'Тарифы и праздники' })
      .click()
  } else {
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('button', { name: 'Ещё' })
      .click()
    const more = page.getByRole('dialog', { name: 'Ещё' })
    await more.getByRole('link', { name: 'Тарифы и праздники' }).click()
    await expect(more).toBeHidden()
  }
  await expect(page).toHaveURL(/\/admin\/settings$/)
  await expect(page.getByRole('heading', { name: 'Тарифы и праздники' })).toBeVisible()

  const tariffs = page.getByRole('region', { name: 'Тарифы' })
  await expect(tariffs).toContainText('Тарифы · действуют с 1 сентября 2026')
  // round(package_price / lessons × pct): 3 200 / 12 → 266,67 → 120 / 133
  for (const text of [
    'Групповая',
    '3 200',
    '266,67',
    '120 / 133',
    '7 400',
    '370,00',
    '167 / 185',
  ]) {
    await expect(tariffs.getByText(text, { exact: false }).first()).toBeVisible()
  }

  const rules = page.getByRole('region', { name: 'Скидки и правила' })
  await expect(rules).toContainText('Бывшим ученикам')
  await expect(rules).toContainText('15-е')
  await expect(rules.getByRole('button')).toHaveCount(0)

  const holidays = page.getByRole('list', { name: 'Праздники' })
  const items = holidays.getByRole('listitem')
  await expect(items.first()).toContainText('День Победы')
  await expect(items.first()).toContainText('прошёл')
  await expect(items.first().getByRole('button')).toHaveCount(0)
  await expect(holidays.getByText('31 дек – 2 янв')).toBeVisible()
  await expect(
    holidays.getByRole('button', { name: /^Удалить: 7 ноября · .., День Октябрьской/ }),
  ).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true })

  await tariffs.getByRole('button', { name: 'История тарифов' }).click()
  const sheet = page.getByRole('dialog', { name: 'История тарифов' })
  await expect(sheet).toBeVisible()
  const versions = sheet.getByRole('list', { name: 'Версии тарифа' }).getByRole('listitem')
  await expect(versions).toHaveCount(3)
  await expect(versions.nth(0)).toContainText('с 1 сентября 2026')
  await expect(versions.nth(0)).toContainText('текущий')
  await expect(versions.nth(0)).toContainText('250 → 266,67')
  await expect(versions.nth(1)).toContainText('архив')
  await expect(versions.nth(1)).toContainText('Групповая 2 800 → 3 000')
  await expect(versions.nth(2)).toContainText('первый')
  await expect(versions.nth(2)).toContainText('импорт при запуске')
  // let the slide-in finish before the screenshot
  await expect(sheet).toHaveCSS('transform', 'none')
  await page.screenshot({ path: testInfo.outputPath('history.png') })
})

test('holiday: add, refuse a past date, delete with confirm', async ({ page }, testInfo) => {
  const f = fixtures(testInfo)
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/settings')

  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Новый праздник' })
  await add.getByLabel('Дата').fill('01.10.2026')
  await add.getByLabel('Название').fill('Тестовый день')
  await add.getByRole('button', { name: 'Добавить' }).click()
  await expect(add.getByRole('alert')).toHaveText('Прошедшую дату добавить нельзя')

  await add.getByLabel('Дата').fill(f.holidayRu)
  await add.getByRole('button', { name: 'Добавить' }).click()
  await expect(add).toBeHidden()
  const holidays = page.getByRole('list', { name: 'Праздники' })
  const row = holidays.getByRole('listitem').filter({ hasText: 'Тестовый день' })
  await expect(row).toHaveCount(1)
  // sorted by date: the 2030 day is last
  await expect(holidays.getByRole('listitem').last()).toContainText('Тестовый день')

  await row.getByRole('button', { name: /^Удалить:/ }).click()
  const confirm = page.getByRole('dialog', { name: 'Удалить праздник?' })
  await confirm.getByRole('button', { name: 'Отмена' }).click()
  await expect(confirm).toBeHidden()
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: /^Удалить:/ }).click()
  await confirm.getByRole('button', { name: 'Удалить' }).click()
  await expect(confirm).toBeHidden()
  await expect(row).toHaveCount(0)
})

test('plan a new tariff version from a future date, then remove it', async ({ page }, testInfo) => {
  const f = fixtures(testInfo)
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/settings')
  const tariffs = page.getByRole('region', { name: 'Тарифы' })
  await tariffs.getByRole('button', { name: 'История тарифов' }).click()
  const sheet = page.getByRole('dialog', { name: 'История тарифов' })
  await sheet.getByRole('button', { name: '+ Запланировать новый тариф с даты…' }).click()

  const form = page.getByRole('form', { name: 'Новая версия тарифов' })
  await expect(form.getByLabel('Групповая')).toHaveValue('3200')
  // К6: the seed has subscriptions → the 1st of next month, by default and at the earliest
  const d = planDates()
  const date = form.getByLabel('Действует с')
  await expect(date).toHaveValue(d.nextRu)
  await expect(form).toContainText(
    `Для действующих групп новый тариф начнёт действовать с ${d.nextLong}. Купленные абонементы остаются по старой цене`,
  )
  await expect(date).toHaveAccessibleDescription(/Купленные абонементы остаются по старой цене/)
  // let the dialog animation finish before the screenshot
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('tariff-plan.png') })
  await date.fill(d.todayRu)
  await form.getByRole('button', { name: 'Запланировать' }).click()
  await expect(form.getByRole('alert')).toHaveText(
    `Для действующих групп — не раньше ${d.nextLong}`,
  )
  // zod: prices whole and > 0
  await form.getByLabel('Действует с').fill(f.planRu)
  await form.getByLabel('Групповая').fill('0')
  await form.getByRole('button', { name: 'Запланировать' }).click()
  await expect(form.getByRole('alert')).toHaveText('Цена должна быть больше нуля')
  await form.getByLabel('Групповая').fill('3500')
  await expect(form).toContainText('урок 291,67 · учителю 131 / 146')
  await form.getByRole('button', { name: 'Запланировать' }).click()
  await expect(form).toBeHidden()

  // The planned version tops the timeline; the table still shows the tariff in effect.
  const versions = sheet.getByRole('list', { name: 'Версии тарифа' }).getByRole('listitem')
  const planned = versions.first()
  await expect(planned).toContainText('запланирован')
  await expect(planned).toContainText('3 200')
  await expect(planned).toContainText('3 500')
  await expect(versions.nth(1)).toContainText('текущий')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(tariffs).toContainText('Запланирован новый тариф с')
  await expect(tariffs.getByText('266,67')).toBeVisible()

  await tariffs.getByRole('button', { name: 'История тарифов' }).click()
  const plannedAgain = versions.filter({ hasText: 'запланирован' })
  await plannedAgain.getByRole('button', { name: 'Удалить запланированный' }).click()
  await plannedAgain.getByRole('button', { name: 'Да, удалить' }).click()
  await expect(versions.filter({ hasText: 'запланирован' })).toHaveCount(0)
})
