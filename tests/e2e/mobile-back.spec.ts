import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// Walks the seed's screens by position: no fixture group in the lists meanwhile (#104).
lockSeed('read')

// #57: one «‹ Родитель» button on every phone screen off the tab bar; sheets close on the system
// back. Needs the local stack + `pnpm seed:users`. Read-only on the seed.
const GROUP_8A = '00000000-0000-4000-b000-000000000001'

test.use({ serviceWorkers: 'block' })

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

/** A held September lesson of 8 класс А (seed, #13). */
async function seedLessonId() {
  const env = localSupabase()
  const db = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', GROUP_8A)
    .eq('status', 'held')
    .order('lesson_date')
    .limit(1)
    .single()
  if (error) throw error
  return data.id
}

async function adminHome(page: Page) {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(
    page.getByRole('heading', {
      name: /^(Центр сегодня|(Доброе утро|Добрый день|Добрый вечер), Каныкей)$/,
    }),
  ).toBeVisible()
}

test('АМ2: student from the list → «‹ Ученики» returns to the filtered list', async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(page), 'phone only')
  await adminHome(page)
  // tabs are roots: no back button
  await expect(page.getByRole('link', { name: /^Назад/ })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Основное меню' })
    .getByRole('link', { name: 'Ученики' })
    .click()
  await expect(page).toHaveURL(/\/admin\/students$/)
  await page.getByRole('searchbox', { name: 'Поиск ученика' }).fill('нурлан')
  await expect(page).toHaveURL(/q=/)
  await page
    .getByRole('list', { name: 'Ученики' })
    .getByRole('listitem')
    .filter({ hasText: 'Нурлан Асанов' })
    .getByRole('link')
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Нурлан Асанов' })).toBeVisible()

  const back = page.getByRole('link', { name: 'Назад: Ученики' })
  await expect(back).toBeVisible()
  await expect(back).toHaveText('Ученики')
  const box = await back.boundingBox()
  expect(box?.height).toBe(44)
  await page.screenshot({ path: shot(testInfo, 'student-390') })

  await back.click()
  // history.back(): the list keeps its search
  await expect(page).toHaveURL(/\/admin\/students\?q=/)
  await expect(page.getByRole('heading', { name: 'Ученики', exact: true })).toBeVisible()
})

test('У3: lesson by a direct link → «‹ Сегодня» leads to /today', async ({ page }, testInfo) => {
  test.skip(isDesktop(page), 'phone only')
  const lessonId = await seedLessonId()
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  // a fresh tab: the lesson is the first page of the app in the history
  const fresh = await page.context().newPage()
  await fresh.goto(`/lessons/${lessonId}`)
  await expect(fresh.getByRole('heading', { name: 'Математика · 8 класс А' })).toBeVisible()
  const back = fresh.getByRole('link', { name: 'Назад: Сегодня' })
  await expect(back).toBeVisible()
  await fresh.screenshot({ path: shot(testInfo, 'lesson-390') })

  await back.click()
  await expect(fresh).toHaveURL(/\/today$/)
  await expect(fresh.getByRole('heading', { name: 'Сегодня, Гульзат' })).toBeVisible()
  await fresh.close()
})

test('«Ещё» screen by a direct link → «‹ Сегодня» leads to the dashboard', async ({ page }) => {
  test.skip(isDesktop(page), 'phone only')
  await adminHome(page)
  const fresh = await page.context().newPage()
  await fresh.goto('/admin/schedule')
  await fresh.getByRole('link', { name: 'Назад: Сегодня' }).click()
  await expect(fresh).toHaveURL(/\/admin$/)
  await fresh.close()
})

test('sheets and dialogs close on the system back, the page stays', async ({ page }) => {
  test.skip(isDesktop(page), 'phone only')
  await adminHome(page)

  const tabs = page.getByRole('navigation', { name: 'Основное меню' })
  await tabs.getByRole('button', { name: 'Ещё' }).click()
  const more = page.getByRole('dialog', { name: 'Ещё' })
  await expect(more).toBeVisible()
  await page.goBack()
  await expect(more).toBeHidden()
  await expect(page).toHaveURL(/\/admin$/)

  // a link in the sheet replaces the sheet's entry: back returns to the dashboard
  await tabs.getByRole('button', { name: 'Ещё' }).click()
  await more.getByRole('link', { name: 'Расписание' }).click()
  await expect(page).toHaveURL(/\/admin\/schedule$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(more).toBeHidden()

  // closed from the UI: no extra history entry left behind
  await page.goto('/admin/students?q=Нурлан')
  await page
    .getByRole('list', { name: 'Ученики' })
    .getByRole('listitem')
    .filter({ hasText: 'Нурлан Асанов' })
    .getByRole('link')
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Нурлан Асанов' })).toBeVisible()
  const studentUrl = page.url()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  const form = page.getByRole('form', { name: 'Изменить ученика' })
  await expect(form).toBeVisible()
  await page.goBack()
  await expect(form).toBeHidden()
  expect(page.url()).toBe(studentUrl)

  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await expect(form).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()
  await page.goBack()
  await expect(page).toHaveURL(/\/admin\/students\?q=/)
})
