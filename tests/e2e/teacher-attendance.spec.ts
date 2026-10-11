/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'

// Needs the local stack + `pnpm seed:users`. Seed: Гульзат teaches 8 класс А and 8 класс Б (8 students
// each, ВТ/ЧТ/СБ, from 1 Sep). Each test works on its own extra lesson at 19:00 on a September day and
// a group of its own per project (projects run in parallel), so nothing touches the October days
// other specs count. September is in the past for the database clock, so the lesson may be held
// (lessons_guard: not before the start, Б1). The seed's September is held (#13): tests never change
// its marks, and payroll.spec (which sums September) runs after this spec (playwright.config.ts).
const GULZAT = { phone: '555 123 456', password: 'iqup-demo' }
const GROUP_8A = '00000000-0000-4000-b000-000000000001'
const GROUP_8B = '00000000-0000-4000-b000-000000000003'

test.use({ serviceWorkers: 'block' })

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

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Номер телефона').fill(GULZAT.phone)
  await page.getByLabel('Пароль', { exact: true }).fill(GULZAT.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/today$/)
  // Settle the post-login redirect before page.goto (#27).
  await expect(page.getByRole('heading', { name: /^Сегодня/ })).toBeVisible()
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
    await login(page)
    const row = page
      .getByRole('list', { name: 'Расписание на сегодня' })
      .getByRole('listitem')
      .filter({ hasText: '19:00' })
    await row.getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}$`))

    await expect(page.getByText('Сейчас · 19:00–20:00')).toBeVisible()
    const students = page.getByRole('list', { name: 'Ученики' }).getByRole('listitem')
    await expect(students).toHaveCount(total)
    await expect(page.getByText('Отметьте всех, чтобы провести')).toBeVisible()
    const first = (await students.nth(0).getAttribute('aria-label')) ?? ''
    const before = await balance(db, group, await studentId(db, first))

    // Three states: present, frozen, burned — then «Все были» for the rest.
    await students.nth(0).getByRole('button', { name: 'Был', exact: true }).click()
    // 3 and 4: not the students the freeze-limit test fills up (Улан, Бегимай)
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
    await expect(
      page.getByText('Занятие проведено. Исправить отметки может администратор'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Провести занятие' })).toHaveCount(0)
  } finally {
    await removeLesson(db, group, day)
  }
})

test('третья заморозка на абонементе — кнопка disabled, «лимит 2 на абонемент»', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = desktop ? '2026-09-22' : '2026-09-24'
  // Students without a freeze on their current subscription (the seed's renewal).
  const name = desktop ? 'Улан Жээнбеков' : 'Бегимай Осмонова'
  // Two freezes on planned extra lessons of our own — the seed's held September stays untouched.
  const freezeDays = desktop ? ['2026-09-01', '2026-09-03'] : ['2026-09-05', '2026-09-08']
  const db = service()
  const lessonId = await extraLesson(db, GROUP_8B, day)
  const student = await studentId(db, name)
  const { subscription_id } = await balance(db, GROUP_8B, student)
  const earlier: string[] = []
  for (const d of freezeDays) {
    await removeLesson(db, GROUP_8B, d)
    const { data, error } = await db
      .from('lessons')
      .insert({
        group_id: GROUP_8B,
        lesson_date: d,
        planned_start: '19:00',
        duration_min: 60,
        is_extra: true,
      })
      .select('id')
      .single()
    if (error) throw error
    earlier.push(data.id)
  }
  const cleanup = async () => {
    for (const d of [day, ...freezeDays]) await removeLesson(db, GROUP_8B, d)
  }
  const { error: markError } = await db.from('attendance').insert(
    earlier.map((id) => ({
      lesson_id: id,
      student_id: student,
      subscription_id,
      status: 'absent_frozen' as const,
    })),
  )
  if (markError) throw markError

  try {
    await pinClock(page, `${day}T19:10:00+06:00`)
    await login(page)
    await page.goto(`/lessons/${lessonId}`)
    const card = page.getByRole('listitem', { name })
    const freeze = card.getByRole('button', { name: 'Заморозка' })
    await expect(freeze).toBeDisabled()
    await expect(card.getByText('лимит 2 на абонемент', { exact: false })).toBeVisible()
    await expect(card).toContainText(desktop ? 'заморозок 2/2 — лимит' : 'заморозок 2/2')
    // Other students may still be frozen.
    await expect(
      page
        .getByRole('listitem', { name: 'Алина Исакова' })
        .getByRole('button', { name: 'Заморозка' }),
    ).toBeEnabled()
    await card.getByRole('button', { name: 'Не был' }).click()
    await expect(card.getByRole('button', { name: 'Не был' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await card.screenshot({ path: shot(testInfo, 'freeze-limit'), style: noTabBar })
  } finally {
    await cleanup()
  }
})

test('мои группы и группа (У4 / У5 / УД3)', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page)
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
    await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}$/)
  }
})
