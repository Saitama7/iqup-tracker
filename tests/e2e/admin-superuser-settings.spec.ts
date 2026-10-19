import { expect, test, type TestInfo } from '@playwright/test'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { service } from './support/undo-fixtures'

// #94 «админ может всё» on А9 and А8: a past holiday, a tariff version, a subject, a user's name.
// Everything is created here under per-project names / far-future dates and removed afterwards.
// The user scenario needs `supabase functions serve` (create-user), like admin-users.spec.

// Tariff versions are global (a planned version of one project is the "next" one of the other).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const desktop = (testInfo: TestInfo) => testInfo.project.name === 'webkit-desktop'
const fixtures = (testInfo: TestInfo) =>
  desktop(testInfo)
    ? {
        holiday: '2026-06-11',
        holidayName: 'e2e прошедший праздник деск',
        plan: '2044-09-01',
        planRu: '01.09.2044',
        planLong: '1 сентября 2044',
      }
    : {
        holiday: '2026-06-10',
        holidayName: 'e2e прошедший праздник моб',
        plan: '2043-09-01',
        planRu: '01.09.2043',
        planLong: '1 сентября 2043',
      }

const freshPhone = () => `7${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

async function cleanup(testInfo: TestInfo) {
  const f = fixtures(testInfo)
  const db = service()
  await db.from('holidays').delete().eq('day', f.holiday)
  await db.from('tariffs').delete().eq('valid_from', f.plan)
}

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => cleanup(testInfo))
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => cleanup(testInfo))

test('А9: админ удаляет прошедший праздник — причина обязательна', async ({ page }, testInfo) => {
  const f = fixtures(testInfo)
  const { error } = await service().from('holidays').insert({ day: f.holiday, name: f.holidayName })
  if (error) throw error

  await login(page, KANYKEI)
  await page.goto('/admin/settings')
  const holidays = page.getByRole('list', { name: 'Праздники' })
  const row = holidays.getByRole('listitem').filter({ hasText: f.holidayName })
  await expect(row).toContainText(/прошёл|10 июн|11 июн/)
  await row.getByRole('button', { name: /^Удалить:/ }).click()

  const confirm = page.getByRole('dialog', { name: 'Удалить праздник?' })
  await confirm.getByRole('button', { name: 'Удалить' }).click()
  await expect(confirm.getByRole('alert')).toHaveText('Укажите причину')
  await confirm.getByLabel('Причина').fill('e2e: внесли по ошибке')
  await confirm.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText(/^Праздник удалён/)).toBeVisible()
  await expect(row).toHaveCount(0)

  const { data } = await service().from('holidays').select('day').eq('day', f.holiday)
  expect(data).toEqual([])
})

test('А9: админ правит цены версии тарифа и удаляет версию с причиной', async ({
  page,
}, testInfo) => {
  const f = fixtures(testInfo)
  await login(page, KANYKEI)
  await page.goto('/admin/settings')
  const tariffs = page.getByRole('region', { name: 'Тарифы' })
  await tariffs.getByRole('button', { name: 'История тарифов' }).click()
  const sheet = page.getByRole('dialog', { name: 'История тарифов' })
  await sheet.getByRole('button', { name: '+ Запланировать новый тариф с даты…' }).click()
  const plan = page.getByRole('form', { name: 'Новая версия тарифов' })
  await plan.getByLabel('Действует с').fill(f.planRu)
  await plan.getByLabel('Групповая').fill('3500')
  await plan.getByRole('button', { name: 'Запланировать' }).click()
  await expect(plan).toBeHidden()

  const version = sheet.getByRole('listitem', { name: `с ${f.planLong}` })
  await version.getByRole('button', { name: 'Изменить цены' }).click()
  const edit = page.getByRole('form', { name: 'Изменить цены' })
  await edit.getByLabel('Групповая').fill('3600')
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(edit.getByRole('alert')).toHaveText('Укажите причину')
  await edit.getByLabel('Причина').fill('e2e: ошиблись в цене')
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Цены изменены')).toBeVisible()
  await expect(version).toContainText('3 600')

  const { data: priced, error: pricedError } = await service()
    .from('tariffs')
    .select('package_price')
    .eq('valid_from', f.plan)
    .eq('group_type', 'group')
    .single()
  expect(pricedError).toBeNull()
  expect(priced?.package_price).toBe(3600)

  await version.getByRole('button', { name: 'Удалить версию' }).click()
  const remove = page.getByRole('form', { name: 'Удалить версию' })
  await remove.getByRole('button', { name: 'Удалить версию' }).click()
  await expect(remove.getByRole('alert')).toHaveText('Укажите причину')
  await remove.getByLabel('Причина').fill('e2e: запланировали зря')
  await remove.getByRole('button', { name: 'Удалить версию' }).click()
  await expect(page.getByText('Версия тарифа удалена')).toBeVisible()
  await expect(version).toHaveCount(0)

  const { data: left } = await service().from('tariffs').select('id').eq('valid_from', f.plan)
  expect(left).toEqual([])
})

test('А9: админ удаляет предмет без групп с причиной', async ({ page }, testInfo) => {
  const name = `Е2е предмет ${desktop(testInfo) ? 'деск' : 'моб'} ${Date.now() % 1_000_000}`
  const db = service()
  try {
    const { error } = await db.from('subjects').insert({ name })
    if (error) throw error

    await login(page, KANYKEI)
    await page.goto('/admin/settings')
    const list = page
      .getByRole('region', { name: 'Предметы' })
      .getByRole('list', { name: 'Список предметов' })
    const row = list.getByRole('listitem').filter({ hasText: name })
    await row.getByRole('button', { name: `Удалить: ${name}` }).click()
    const form = page.getByRole('form', { name: 'Удалить предмет' })
    await form.getByRole('button', { name: 'Удалить предмет' }).click()
    await expect(form.getByRole('alert')).toHaveText('Укажите причину')
    await form.getByLabel('Причина').fill('e2e: завели по ошибке')
    await form.getByRole('button', { name: 'Удалить предмет' }).click()
    await expect(page.getByText(`Предмет «${name}» удалён`)).toBeVisible()
    await expect(row).toHaveCount(0)
    const { data } = await db.from('subjects').select('id').eq('name', name)
    expect(data).toEqual([])
  } finally {
    await db.from('subjects').delete().eq('name', name)
  }
})

test('А8: админ меняет имя пользователя', async ({ page }) => {
  const national = freshPhone()
  const phone = `996${national}`
  const name = `Ульяна Тестова ${national.slice(-4)}`
  const renamed = `Ульяна Новикова ${national.slice(-4)}`
  const db = service()
  try {
    await login(page, KANYKEI)
    await page.goto('/admin/users')
    const form = page.getByRole('form', { name: 'Новый пользователь' })
    await form.getByLabel('Имя и фамилия').fill(name)
    await form.getByLabel('Телефон — это логин').fill(national)
    await form.getByRole('button', { name: 'Создать и показать пароль' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    const teachers = page.getByRole('region', { name: 'Учителя' })
    const more = teachers.getByRole('button', { name: /^ещё \d+/ })
    if (await more.isVisible()) await more.click()
    await teachers.getByRole('button', { name: `Изменить: ${name}` }).click()
    const edit = page.getByRole('dialog', { name })
    const data = edit.getByRole('form', { name: 'Данные пользователя' })
    await data.getByLabel('Имя и фамилия').fill(renamed)
    await data.getByRole('button', { name: 'Сохранить данные' }).click()
    await expect(page.getByText('Данные сохранены')).toBeVisible()

    const { data: profile } = await db.from('profiles').select('full_name').eq('phone', phone)
    expect(profile?.[0]?.full_name).toBe(renamed)
  } finally {
    const { data } = await db.from('profiles').select('id').eq('phone', phone).maybeSingle()
    await db.from('teachers').delete().eq('phone', phone)
    if (data) await db.auth.admin.deleteUser(data.id)
  }
})
