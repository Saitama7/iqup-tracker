/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, login } from './support/auth'
import { groupTeacher } from './support/db'
import { lockSeed } from './support/seed-lock'

// #72: September is entered backdated from «Мой месяц». Needs the local stack + `pnpm seed:users`.
// Seed: September is held for Гульзат's 8 класс А / 8 класс Б, so the test's own 19:00 extra lesson
// (a day and a group of its own per project) is the only unconfirmed one of the month. It changes
// September's sums while the test runs — hold the seed lock (#27).
const GROUP_8A = '00000000-0000-4000-b000-000000000001'
const GROUP_8B = '00000000-0000-4000-b000-000000000003'

test.use({ serviceWorkers: 'block' })
lockSeed('write')

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

type Db = ReturnType<typeof service>

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function pinClock(page: Page, iso: string) {
  await page.clock.setSystemTime(new Date(iso))
  await page.route('**/rest/v1/rpc/server_now', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(iso) }),
  )
}

async function removeLesson(db: Db, group: string, day: string) {
  const { data } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', group)
    .eq('lesson_date', day)
    .eq('planned_start', '19:00')
  for (const { id } of data ?? []) {
    await db.from('attendance').delete().eq('lesson_id', id)
    await db.from('lessons').delete().eq('id', id)
  }
}

async function extraLesson(db: Db, group: string, day: string) {
  await removeLesson(db, group, day)
  const { data, error } = await db
    .from('lessons')
    .insert({
      group_id: group,
      teacher_id: await groupTeacher(db, group),
      lesson_date: day,
      planned_start: '19:00',
      duration_min: 60,
      is_extra: true,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

test('Мой месяц → Сентябрь → группа → Подтвердить → снова Сентябрь с той же группой (#72)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  // the newest lesson of the month on the desktop — the table shows the first 7
  const day = desktop ? '2026-09-30' : '2026-09-25'
  const group = desktop ? GROUP_8A : GROUP_8B
  const groupName = desktop ? '8 класс А' : '8 класс Б'
  const db = service()
  const lessonId = await extraLesson(db, group, day)
  const filter = page.getByRole('group', { name: 'Фильтр по группам' })
  const chip = filter.getByRole('button', { name: new RegExp(`^${groupName}`) })
  const month = new RegExp(`/my-month\\?month=2026-09&group=${group}(#unconfirmed)?$`)

  try {
    await pinClock(page, '2026-10-08T14:24:00+06:00')
    await login(page, GULZAT)
    await page.goto('/my-month?month=2026-09')
    await expect(filter.getByRole('button', { name: 'Все группы' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // the badge: one lesson of the group is over but not confirmed
    await expect(chip).toContainText('1')
    await chip.click()
    await expect(page).toHaveURL(new RegExp(`/my-month\\?month=2026-09&group=${group}$`))
    await expect(chip).toHaveAttribute('aria-pressed', 'true')

    // the filter lives in the URL — survives reload
    await page.reload()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(600)
    await page.screenshot({
      path: shot(testInfo, desktop ? 'r2-72-my-month-filter-1280' : 'r2-72-my-month-filter-390'),
      fullPage: true,
    })

    const confirm = page.locator(`main a[href^="/lessons/${lessonId}"]`)
    await expect(confirm).toHaveCount(1)
    await confirm.click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=my-month`))
    await expect(page.getByRole('link', { name: 'Назад: Мой месяц' })).toBeVisible()

    await page.getByRole('button', { name: 'Все были' }).click()
    await page.getByRole('button', { name: 'Подтвердить занятие' }).click()

    await expect(page).toHaveURL(month)
    await expect(page.getByText(/^Занятие подтверждено · \d\d:\d\d$/)).toBeVisible()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      desktop ? 'Сентябрь 2026' : 'Сентябрь',
    )
    await expect(confirm).toHaveCount(0)
    await page.waitForTimeout(600)
    await page.screenshot({
      path: shot(testInfo, desktop ? 'r2-72-my-month-return-1280' : 'r2-72-my-month-return-390'),
      fullPage: true,
    })

    const { data: lesson } = await db.from('lessons').select('status').eq('id', lessonId).single()
    expect(lesson?.status).toBe('held')
  } finally {
    await removeLesson(db, group, day)
  }
})

test('«Назад» с занятия, открытого из «Мой месяц», без истории — в тот же месяц и группу (#72)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const group = desktop ? GROUP_8A : GROUP_8B
  const { data, error } = await service()
    .from('lessons')
    .select('id')
    .eq('group_id', group)
    .eq('lesson_date', '2026-09-01')
    .limit(1)
    .single()
  if (error) throw error

  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  // a fresh tab (PWA, a shared link): the lesson is the first page of the app in the history
  const fresh = await page.context().newPage()
  await fresh.goto(`/lessons/${data.id}?from=my-month&month=2026-09&group=${group}`)
  await fresh.getByRole('link', { name: 'Назад: Мой месяц' }).click()
  await expect(fresh).toHaveURL(new RegExp(`/my-month\\?month=2026-09&group=${group}$`))
  await expect(
    fresh
      .getByRole('group', { name: 'Фильтр по группам' })
      .getByRole('button', { name: /^8 класс/, pressed: true }),
  ).toHaveCount(1)
  await fresh.close()
})

test('>7 проведённых новее + старые неподтверждённые: видны, после подтверждения — фокус на следующем по дате (#76)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  // a group and days of its own per project; the whole month (no filter) has far more than 7
  // held lessons newer than these two
  const group = desktop ? GROUP_8A : GROUP_8B
  const [older, newer] = desktop ? ['2026-09-02', '2026-09-03'] : ['2026-09-08', '2026-09-09']
  const db = service()
  const olderId = await extraLesson(db, group, older)
  const newerId = await extraLesson(db, group, newer)
  const confirmOf = (id: string) => page.locator(`main a[href^="/lessons/${id}"]`)

  try {
    await pinClock(page, '2026-10-08T14:24:00+06:00')
    await login(page, GULZAT)
    await page.goto('/my-month?month=2026-09')
    // not behind «ещё N занятий»
    await expect(confirmOf(olderId)).toBeVisible()
    await expect(confirmOf(newerId)).toBeVisible()
    if (desktop) await expect(page.getByTestId('kpi-unconfirmed')).toHaveText('2')

    await confirmOf(olderId).click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${olderId}\\?from=my-month`))
    await page.getByRole('button', { name: 'Все были' }).click()
    await page.getByRole('button', { name: 'Подтвердить занятие' }).click()

    await expect(page).toHaveURL(/\/my-month\?month=2026-09#unconfirmed$/)
    await expect(confirmOf(olderId)).toHaveCount(0)
    await expect(confirmOf(newerId)).toBeInViewport()
    await expect(confirmOf(newerId)).toBeFocused()
    await page.waitForTimeout(600)
    await page.screenshot({
      path: shot(testInfo, desktop ? 'r2-76-my-month-next-1280' : 'r2-76-my-month-next-390'),
    })

    // replace: system «назад» does not reopen the confirmed lesson
    await page.goBack()
    await expect(page).not.toHaveURL(new RegExp(`/lessons/${olderId}`))
  } finally {
    await removeLesson(db, group, older)
    await removeLesson(db, group, newer)
  }
})

test('Занятие, открытое со страницы группы, после подтверждения возвращает в группу (#76)', async ({
  page,
}, testInfo) => {
  // «Занятия» tab of the group — the phone (У5); the desktop detail has no lesson list
  test.skip(testInfo.project.name === 'webkit-desktop', 'вкладка «Занятия» — телефон')
  const db = service()
  const lessonId = await extraLesson(db, GROUP_8A, '2026-10-07')
  try {
    await pinClock(page, '2026-10-08T14:24:00+06:00')
    await login(page, GULZAT)
    await page.goto(`/groups/${GROUP_8A}`)
    await page.getByRole('tab', { name: 'Занятия' }).click()
    await page.locator(`main a[href^="/lessons/${lessonId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=group&group=${GROUP_8A}`))
    await expect(page.getByRole('link', { name: 'Назад: Группа' })).toBeVisible()

    await page.getByRole('button', { name: 'Все были' }).click()
    await page.getByRole('button', { name: 'Подтвердить занятие' }).click()
    // #89: the same «Занятия» tab
    await expect(page).toHaveURL(new RegExp(`/groups/${GROUP_8A}\\?tab=lessons$`))

    await page.goBack()
    await expect(page).not.toHaveURL(new RegExp(`/lessons/${lessonId}`))
  } finally {
    await removeLesson(db, GROUP_8A, '2026-10-07')
  }
})

test('учитель: «Мой месяц» → занятие → «‹ Мой месяц» → тот же месяц и группа (#89)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = desktop ? '2026-09-30' : '2026-09-25'
  const group = desktop ? GROUP_8A : GROUP_8B
  const db = service()
  const lessonId = await extraLesson(db, group, day)
  try {
    await pinClock(page, '2026-10-08T14:24:00+06:00')
    await login(page, GULZAT)
    await page.goto(`/my-month?month=2026-09&group=${group}`)
    await page.locator(`main a[href^="/lessons/${lessonId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=my-month`))
    await page.getByRole('link', { name: 'Назад: Мой месяц' }).click()
    // history.back(): the same month and group, nothing confirmed
    await expect(page).toHaveURL(new RegExp(`/my-month\\?month=2026-09&group=${group}$`))
    await expect(
      page
        .getByRole('group', { name: 'Фильтр по группам' })
        .getByRole('button', { name: /^8 класс/, pressed: true }),
    ).toHaveCount(1)
  } finally {
    await removeLesson(db, group, day)
  }
})
