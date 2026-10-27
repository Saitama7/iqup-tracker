/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, KANYKEI, login, switchUser } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { groupTeacher } from './support/db'

// Needs the local stack + `pnpm seed:users`. Seed: Гульзат teaches 8 класс А and 8 класс Б (8 students
// each, ВТ/ЧТ/СБ, from 1 Sep). Each test works on its own extra lesson at 19:00 on a September day and
// a group of its own per project (projects run in parallel), so nothing touches the October days
// other specs count. September is in the past for the database clock, so the lesson may be held
// (lessons_guard: not before the start, Б1). The seed's September is held (#13): tests never change
// its marks; the extra lessons change September's sums while a test runs, so the tests hold the seed
// lock and payroll.spec waits for them (#27).
const GROUP_8A = '00000000-0000-4000-b000-000000000001'
const GROUP_8B = '00000000-0000-4000-b000-000000000003'

test.use({ serviceWorkers: 'block' })
lockSeed('write')

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)
const noTabBar = 'nav { visibility: hidden !important; }'

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

/** A fresh 19:00 extra lesson of `group` on `day`; removed with its marks afterwards. */
async function extraLesson(db: Db, group: string, day: string) {
  // leftovers of an aborted run in either group would show up in the day list too
  await removeLesson(db, GROUP_8A, day)
  await removeLesson(db, GROUP_8B, day)
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

async function studentId(db: Db, name: string) {
  const { data, error } = await db.from('students').select('id').eq('full_name', name).single()
  if (error) throw error
  return data.id
}

/**
 * The subscription the student's next mark is charged to — the oldest active one with lessons left
 * (attendance_subscription, 0010): after the seed's September that is often the renewal.
 */
async function balance(db: Db, group: string, student: string) {
  const { data, error } = await db
    .from('v_subscription_balances')
    .select('subscription_id, lessons_used, lessons_left, status')
    .eq('student_id', student)
    .eq('group_id', group)
  if (error) throw error
  const { data: subs, error: subsError } = await db
    .from('subscriptions')
    .select('id, started_at, created_at')
    .in(
      'id',
      data.map((b) => b.subscription_id ?? ''),
    )
    .order('started_at')
    .order('created_at')
  if (subsError) throw subsError
  const rows = subs.flatMap((s) => data.filter((b) => b.subscription_id === s.id))
  const current =
    rows.find((b) => b.status === 'active' && (b.lessons_left ?? 0) > 0) ?? rows.at(-1)
  if (!current?.subscription_id) throw new Error(`no subscription of ${student}`)
  return { subscription_id: current.subscription_id, lessons_used: current.lessons_used }
}

async function balanceOf(db: Db, subscriptionId: string) {
  const { data, error } = await db
    .from('v_subscription_balances')
    .select('subscription_id, lessons_used')
    .eq('subscription_id', subscriptionId)
    .single()
  if (error) throw error
  return data
}

test('Гульзат проводит занятие: 8 отметок → «Проведено», у ученика +1 (У3 / УД2)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = desktop ? '2026-09-15' : '2026-09-17'
  const group = desktop ? GROUP_8A : GROUP_8B
  // 8 класс Б: 8 students; 8 класс А in September: 7 (Нурлан is enrolled from 1 October)
  const total = desktop ? 7 : 8
  const db = service()
  const lessonId = await extraLesson(db, group, day)

  try {
    await pinClock(page, `${day}T19:10:00+06:00`)
    await login(page, GULZAT)
    const row = page
      .getByRole('list', { name: 'Расписание на сегодня' })
      .getByRole('listitem')
      .filter({ hasText: '19:00' })
    await row.getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=today$`))

    await expect(page.getByText('Сейчас · 19:00–20:00')).toBeVisible()
    const students = page.getByRole('list', { name: 'Ученики' }).getByRole('listitem')
    await expect(students).toHaveCount(total)
    await expect(page.getByText('Отметьте всех, чтобы провести')).toBeVisible()
    const first = (await students.nth(0).getAttribute('aria-label')) ?? ''
    const before = await balance(db, group, await studentId(db, first))

    // Three states: present, frozen, burned — then «Все были» for the rest.
    await students.nth(0).getByRole('button', { name: 'Был', exact: true }).click()
    // 3 and 4: not the students the three-freezes test freezes (Улан, Бегимай)
    await students.nth(3).getByRole('button', { name: 'Заморозка' }).click()
    await students.nth(4).getByRole('button', { name: 'Не был' }).click()
    await expect(students.nth(3).getByRole('button', { name: 'Заморозка' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByText(new RegExp(`^(Отмечено )?3 из ${total}$`))).toBeVisible()
    if (desktop) {
      await expect(page.getByText('120 сом за ученико-урок', { exact: false })).toBeVisible()
      await expect(page.getByText('240 сом')).toBeVisible() // 2 paid × 120
    }
    await page.waitForTimeout(600) // the avatar flip settles
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
    // Phone: the viewport, as on the artboard (a full-page shot leaves the sticky bar mid-page).
    await page.screenshot({
      path: shot(testInfo, desktop ? 'attendance-1280' : 'attendance-390'),
      fullPage: desktop,
    })

    await page.getByRole('button', { name: 'Все были' }).click()
    await expect(page.getByText(new RegExp(`^(Отмечено )?${total} из ${total}$`))).toBeVisible()
    await page.getByRole('button', { name: 'Провести занятие' }).click()

    await expect(page).toHaveURL(/\/today$/)
    await expect(page.getByText(/^Занятие проведено · \d\d:\d\d$/)).toBeVisible()
    await expect(row).toContainText('Проведено')
    await expect(row).toContainText(/\d\d:\d\d/)
    await expect(row).toContainText(`Был ${total - 2}`)

    const after = await balanceOf(db, before.subscription_id)
    expect(after.lessons_used).toBe((before.lessons_used ?? 0) + 1)

    const { data: lesson } = await db
      .from('lessons')
      .select('status, confirmed_at, confirmed_late')
      .eq('id', lessonId)
      .single()
    expect(lesson?.status).toBe('held')
    expect(lesson?.confirmed_late).toBe(true) // September, confirmed «today»
    const { data: audit } = await db
      .from('audit_log')
      .select('id')
      .eq('entity', 'lessons')
      .eq('entity_id', lessonId)
      .eq('reason', 'confirm_lesson')
    expect(audit).toHaveLength(1)

    // Held: read-only for the teacher (И4).
    await page.goto(`/lessons/${lessonId}`)
    // held: marks are locked, the teacher may only ask the admin to correct them (#74)
    await expect(page.getByRole('button', { name: 'Попросить исправить' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Провести занятие' })).toHaveCount(0)
  } finally {
    await removeLesson(db, group, day)
  }
})

test('три заморозки подряд одному ученику — без лимита (К9, #108); на А6 «заморозок 3»', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = desktop ? '2026-09-22' : '2026-09-24'
  // Students without a freeze on their current subscription (the seed's renewal).
  const name = desktop ? 'Улан Жээнбеков' : 'Бегимай Осмонова'
  // Three extra lessons of our own — the seed's held September stays untouched.
  const days = desktop ? ['2026-09-01', '2026-09-03', day] : ['2026-09-05', '2026-09-08', day]
  const db = service()
  const lessons: string[] = []
  for (const d of days) lessons.push(await extraLesson(db, GROUP_8B, d))
  const student = await studentId(db, name)
  const { subscription_id } = await balance(db, GROUP_8B, student)

  try {
    await pinClock(page, `${day}T19:10:00+06:00`)
    await login(page, GULZAT)
    for (const [i, lessonId] of lessons.entries()) {
      await page.goto(`/lessons/${lessonId}`)
      const card = page.getByRole('listitem', { name })
      const freeze = card.getByRole('button', { name: 'Заморозка' })
      await expect(freeze).toBeEnabled()
      await expect(card).toContainText(`заморозок ${i}`)
      await freeze.click()
      await expect(freeze).toHaveAttribute('aria-pressed', 'true')
      await expect(card.getByText('лимит', { exact: false })).toHaveCount(0)
      if (i === 2) {
        await page.waitForTimeout(600) // the avatar flip settles
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({
          path: shot(testInfo, desktop ? 'third-freeze-1280' : 'third-freeze-390'),
          fullPage: desktop,
        })
      }
      await page.getByRole('button', { name: 'Все были' }).click()
      // Earlier days are already over — «Подтвердить занятие» there (#41).
      await page.getByRole('button', { name: /^(Провести|Подтвердить) занятие$/ }).click()
      await expect
        .poll(
          async () => {
            const { data } = await db.from('lessons').select('status').eq('id', lessonId).single()
            return data?.status
          },
          { timeout: 20_000 },
        )
        .toBe('held')
    }

    const { data: marks } = await db
      .from('attendance')
      .select('status')
      .eq('subscription_id', subscription_id)
      .eq('student_id', student)
      .in('lesson_id', lessons)
    expect(marks?.map((m) => m.status)).toEqual(Array(3).fill('absent_frozen'))

    await switchUser(page, KANYKEI)
    await page.goto(`/admin/students/${student}`)
    await expect(page.getByText('заморозок 3', { exact: false }).first()).toBeVisible()
    await page.screenshot({
      path: shot(testInfo, desktop ? 'student-freezes-1280' : 'student-freezes-390'),
      fullPage: desktop,
    })
  } finally {
    for (const d of days) await removeLesson(db, GROUP_8B, d)
  }
})

test('мои группы и группа (У4 / У5 / УД3)', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page, GULZAT)
  await page.goto('/groups')

  if (desktop) {
    await expect(page.getByRole('heading', { name: 'Группы и ученики' })).toBeVisible()
    await expect(page.getByText(/^4 группы · \d+ учени/)).toBeVisible()
    const list = page.getByRole('navigation', { name: 'Мои группы' }).getByRole('link')
    await expect(list).toHaveCount(4)
    await expect(list.nth(0)).toContainText('Математика · 8 класс А')
    await expect(list.nth(0)).toContainText('ВТ · ЧТ · СБ · 09:00 · 8/10')
    await expect(page.getByRole('cell', { name: /Айжан Бекова/ })).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'groups-1280'), fullPage: true })
    await list.nth(2).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${GROUP_8B}$`))
    await expect(page.getByRole('link', { name: 'Отметить сегодня' })).toBeVisible()
    await page.getByRole('button', { name: 'Занятия группы' }).click()
    await expect(page.getByRole('list', { name: 'Занятия группы' })).toContainText('8 окт')
  } else {
    await expect(page.getByRole('heading', { name: 'Мои группы' })).toBeVisible()
    const cards = page.getByRole('list', { name: 'Мои группы' }).getByRole('link')
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(0)).toContainText('ВТ · ЧТ · СБ · 09:00')
    await expect(cards.nth(2)).toContainText('ВТ · ЧТ · СБ · 14:00 · сейчас')
    await expect(cards.nth(2)).toContainText('8 / 10')
    await page.screenshot({ path: shot(testInfo, 'groups-390'), fullPage: true, style: noTabBar })

    await cards.nth(0).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${GROUP_8A}$`))
    await expect(page.getByRole('heading', { name: 'Математика · 8 класс А' })).toBeVisible()
    await expect(page.getByText('Групповая · 8 / 10')).toBeVisible()
    await expect(page.getByText('ВТ · ЧТ · СБ · 09:00–10:00 · каб. 1')).toBeVisible()
    await expect(page.getByRole('listitem', { name: 'Айжан Бекова' })).toContainText('осталось')
    await page.screenshot({ path: shot(testInfo, 'group-390'), fullPage: true })
    await page.getByRole('tab', { name: 'Занятия' }).click()
    await expect(page.getByRole('list', { name: 'Занятия группы' })).toContainText('8 окт')
    await page.getByRole('link', { name: 'Отметить сегодня' }).click()
    // #76: opened from the group page — confirming returns there
    await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}\?from=group&group=[0-9a-f-]{36}$/)
  }
})

test('черновик отметок переживает перезагрузку и уход со страницы (#29)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = desktop ? '2026-09-10' : '2026-09-12'
  const group = desktop ? GROUP_8A : GROUP_8B
  const db = service()
  const lessonId = await extraLesson(db, group, day)

  try {
    await pinClock(page, `${day}T19:10:00+06:00`)
    await login(page, GULZAT)
    await page.goto(`/lessons/${lessonId}`)
    // Rows by name: the seed's September may have used up someone's freezes.
    const free = page
      .getByRole('list', { name: 'Ученики' })
      .getByRole('listitem')
      .filter({ hasNotText: 'Заморозка недоступна' })
    const names = await Promise.all(
      [0, 1, 2].map(async (i) => (await free.nth(i).getAttribute('aria-label')) ?? ''),
    )
    const marks = ['Был', 'Заморозка', 'Не был'] as const
    const button = (i: number) =>
      page.getByRole('listitem', { name: names[i] }).getByRole('button', {
        name: marks[i],
        exact: true,
      })
    for (const i of [0, 1, 2]) await button(i).click()

    await page.reload()
    for (const i of [0, 1, 2]) await expect(button(i)).toHaveAttribute('aria-pressed', 'true')

    await page.goto('/today')
    await page.goto(`/lessons/${lessonId}`)
    await expect(button(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/^(Отмечено )?3 из \d+$/)).toBeVisible()
    await page.waitForTimeout(600) // the avatar flip settles
    await page.screenshot({ path: shot(testInfo, desktop ? 'draft-1280' : 'draft-390') })

    // Held — the draft is gone from the device.
    await page.getByRole('button', { name: 'Все были' }).click()
    await page.getByRole('button', { name: 'Провести занятие' }).click()
    await expect(page).toHaveURL(/\/today$/)
    await expect(page.getByText(/^Занятие проведено · \d\d:\d\d$/)).toBeVisible()
    const left = await page.evaluate(
      (id) => window.localStorage.getItem(`iqup:lesson-draft:${id}`),
      lessonId,
    )
    expect(left).toBeNull()
  } finally {
    await removeLesson(db, group, day)
  }
})

test('учитель: доп. урок задним числом не отправляется (И16, #29)', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page, GULZAT)
  await page.goto(`/groups/${GROUP_8A}`)
  await page.getByRole('button', { name: 'Доп. урок', exact: true }).click()
  const form = page.getByRole('form', { name: 'Доп. урок' })
  await expect(form.getByText('Не раньше сегодняшнего дня — 08.10.2026')).toBeVisible()
  await expect(form.getByLabel('Дата')).toHaveValue('08.10.2026')

  await form.getByLabel('Дата').fill('07.10.2026')
  await expect(form.getByLabel('Дата')).toHaveAttribute('aria-invalid', 'true')
  let rpc = false
  page.on('request', (r) => {
    if (r.url().includes('/rpc/') && r.url().includes('extra')) rpc = true
  })
  await form.getByRole('button', { name: 'Добавить доп. урок' }).click()
  await expect(form.getByRole('alert')).toHaveText(
    'Доп. урок можно добавить только на сегодня или позже',
  )
  await expect(form).toBeVisible()
  expect(rpc).toBe(false)
  await page.screenshot({ path: shot(testInfo, desktop ? 'extra-past-1280' : 'extra-past-390') })
})

const sum = async (page: Page) =>
  Number(((await page.getByTestId('pay-sum').textContent()) ?? '').replace(/\D/g, ''))

test('вчерашнее занятие: «Подтвердить занятие» → ушло из «Требует внимания», «Мой месяц» вырос (#41)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = '2026-10-07'
  const group = desktop ? GROUP_8A : GROUP_8B
  const db = service()
  const lessonId = await extraLesson(db, group, day)
  const menu = page.getByRole('navigation', { name: 'Основное меню' })
  const attention = page.locator(`main a[href="/lessons/${lessonId}?from=today"]`)

  try {
    await pinClock(page, '2026-10-08T14:24:00+06:00')
    await login(page, GULZAT)
    await page.goto('/my-month')
    await expect(page.getByTestId('pay-sum')).toBeVisible()
    const before = await sum(page)

    // from here on — client navigation only, no reload
    await menu.getByRole('link', { name: 'Сегодня' }).click()
    await expect(page).toHaveURL(/\/today$/)
    await expect(attention).toHaveCount(1)
    await attention.click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=today$`))
    await expect(page.getByText('Не подтверждено · 19:00–20:00')).toBeVisible()
    await expect(page.getByText('Отметьте всех, чтобы подтвердить')).toBeVisible()
    await page.getByRole('button', { name: 'Все были' }).click()
    const action = page.getByRole('button', { name: 'Подтвердить занятие' })
    await expect(action).toBeVisible()
    await expect(page.getByRole('button', { name: 'Провести занятие' })).toHaveCount(0)
    await page.waitForTimeout(600) // the avatar flip settles
    await page.screenshot({
      path: shot(testInfo, desktop ? 'confirm-past-1280' : 'confirm-past-390'),
    })
    await action.click()

    await expect(page).toHaveURL(/\/today$/)
    await expect(page.getByText(/^Занятие подтверждено · \d\d:\d\d$/)).toBeVisible()
    await expect(attention).toHaveCount(0)

    await menu.getByRole('link', { name: 'Мой месяц' }).click()
    await expect(page).toHaveURL(/\/my-month$/)
    await expect.poll(() => sum(page)).toBeGreaterThan(before)

    const { data: lesson } = await db.from('lessons').select('status').eq('id', lessonId).single()
    expect(lesson?.status).toBe('held')
  } finally {
    await removeLesson(db, group, day)
  }
})

test('отказ confirm_lesson: тост с причиной, лист и черновик на месте, статус не изменился (#41)', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = '2026-10-07'
  const group = desktop ? GROUP_8A : GROUP_8B
  const db = service()
  const lessonId = await extraLesson(db, group, day)
  // dev 12.10: the migration with confirm_lesson was not applied — PostgREST answers 404
  await page.route('**/rest/v1/rpc/confirm_lesson', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'PGRST202',
        details: null,
        hint: null,
        message: 'Could not find the function public.confirm_lesson(p_lesson_id, p_marks)',
      }),
    }),
  )

  try {
    await pinClock(page, '2026-10-08T14:24:00+06:00')
    await login(page, GULZAT)
    await page.goto(`/lessons/${lessonId}`)
    const students = page.getByRole('list', { name: 'Ученики' }).getByRole('listitem')
    const absent = students.nth(0).getByRole('button', { name: 'Не был' })
    await absent.click()
    await page.getByRole('button', { name: 'Все были' }).click()
    await page.getByRole('button', { name: 'Подтвердить занятие' }).click()

    await expect(
      page.getByText(
        'Не удалось подтвердить занятие: сервер не обновлён — сообщите администратору',
      ),
    ).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}$`))
    await expect(page.getByText('Не подтверждено · 19:00–20:00')).toBeVisible()
    await expect(absent).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Подтвердить занятие' })).toBeEnabled()
    await page.waitForTimeout(600)
    await page.screenshot({
      path: shot(testInfo, desktop ? 'confirm-error-1280' : 'confirm-error-390'),
    })

    const { data: lesson } = await db.from('lessons').select('status').eq('id', lessonId).single()
    expect(lesson?.status).toBe('planned')
    const { data: marks } = await db.from('attendance').select('id').eq('lesson_id', lessonId)
    expect(marks).toHaveLength(0)

    await page.reload()
    await expect(absent).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await removeLesson(db, group, day)
  }
})
