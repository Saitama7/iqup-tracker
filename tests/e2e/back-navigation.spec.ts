import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, KANYKEI, login } from './support/auth'

// #89: «назад» from a lesson returns where it was opened — the admin's group on «Занятия», А2 on
// the same week — through the history, and from the URL after a reload or in a fresh tab.
// Needs the local stack + `pnpm seed:users`. Read-only on the seed.
const GROUP_8A = '00000000-0000-4000-b000-000000000001'
const GROUP_URL = new RegExp(`/admin/groups/${GROUP_8A}\\?tab=lessons$`)

test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r-back-${name}-${size(testInfo)}.png` })
}

/** A held September lesson of 8 класс А (seed). */
async function heldLesson(date = '2026-09-24') {
  const env = localSupabase()
  const db = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', GROUP_8A)
    .eq('status', 'held')
    .eq('lesson_date', date)
    .limit(1)
    .single()
  if (error) throw error
  return data.id
}

async function adminLogin(page: Page) {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
}

/** А4 8 класс А → «Занятия» → «Отметки» of 24 Sep: the sheet names the group as its source. */
async function openFromGroup(page: Page, lessonId: string) {
  await page.goto(`/admin/groups/${GROUP_8A}`)
  await page.getByRole('tab', { name: 'Занятия' }).click()
  await expect(page).toHaveURL(GROUP_URL)
  await page.locator(`a[href^="/lessons/${lessonId}"]`).click()
  await expect(page).toHaveURL(
    new RegExp(`/lessons/${lessonId}\\?from=admin-group&group=${GROUP_8A}&tab=lessons$`),
  )
}

async function expectLessonsTab(page: Page) {
  await expect(page).toHaveURL(GROUP_URL)
  await expect(page.getByRole('tab', { name: 'Занятия' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('list', { name: 'Прошедшие занятия' })).toBeVisible()
}

test('А4 → «Занятия» → «Отметки» → «‹ Группа» → снова «Занятия» (#89)', async ({
  page,
}, testInfo) => {
  const lessonId = await heldLesson()
  await adminLogin(page)
  await openFromGroup(page, lessonId)

  const back = page.getByRole('link', { name: 'Назад: Группа' })
  await expect(back).toBeVisible()
  await expect(back).toHaveText('Группа')
  await shot(page, 'lesson', testInfo)

  await back.click()
  await expectLessonsTab(page)
  await shot(page, 'group-lessons', testInfo)
})

test('карточка занятия после перезагрузки и в новой вкладке — назад в группу на «Занятия» (#89)', async ({
  page,
}) => {
  const lessonId = await heldLesson()
  await adminLogin(page)
  await openFromGroup(page, lessonId)

  // reload: the source is in the URL, the history entry of the group is still there
  await page.reload()
  await page.getByRole('link', { name: 'Назад: Группа' }).click()
  await expectLessonsTab(page)

  // a fresh tab (a shared link, the PWA icon): no history — the link itself leads to the source
  const fresh = await page.context().newPage()
  await fresh.goto(`/lessons/${lessonId}?from=admin-group&group=${GROUP_8A}&tab=lessons`)
  await fresh.getByRole('link', { name: 'Назад: Группа' }).click()
  await expectLessonsTab(fresh)
  await fresh.close()
})

test('А2 → проведённое занятие → «‹ Расписание» → та же неделя (#89)', async ({
  page,
}, testInfo) => {
  const lessonId = await heldLesson()
  await adminLogin(page)
  await page.goto('/admin/schedule?date=2026-09-24')
  await page.locator(`main a[href^="/lessons/${lessonId}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=schedule&date=2026-09-24$`))
  const back = page.getByRole('link', { name: 'Назад: Расписание' })
  await expect(back).toBeVisible()
  await shot(page, 'schedule-lesson', testInfo)
  await back.click()
  await expect(page).toHaveURL(/\/admin\/schedule\?date=2026-09-24$/)

  // without history: the same week from the URL
  const fresh = await page.context().newPage()
  await fresh.goto(`/lessons/${lessonId}?from=schedule&date=2026-09-24`)
  await fresh.getByRole('link', { name: 'Назад: Расписание' }).click()
  await expect(fresh).toHaveURL(/\/admin\/schedule\?date=2026-09-24$/)
  await fresh.close()
})

test('учитель: группа → «Занятия» → занятие → «‹ Группа» → снова «Занятия» (#89)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await page.goto(`/groups/${GROUP_8A}`)
  if (desktop) await page.getByRole('button', { name: 'Занятия группы' }).click()
  else await page.getByRole('tab', { name: 'Занятия' }).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${GROUP_8A}\\?tab=lessons$`))

  const lessons = page.getByRole('list', { name: 'Занятия группы' })
  await lessons.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/lessons\/[^?]+\?from=group&group=.+&tab=lessons$/)
  await page.getByRole('link', { name: 'Назад: Группа' }).click()

  await expect(page).toHaveURL(new RegExp(`/groups/${GROUP_8A}\\?tab=lessons$`))
  await expect(lessons).toBeVisible()
  await shot(page, 'teacher-group-lessons', testInfo)
})
