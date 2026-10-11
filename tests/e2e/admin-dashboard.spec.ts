/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// А1 / АМ1 / А2. Needs the local stack + `pnpm seed:users`. The browser clock is pinned to the
// artboards' moment — Thursday 8 October, 14:24 — and server_now() answers the same instant
// (as in teacher-today.spec.ts). Nothing in the seed is confirmed, so on 8 October:
// 1–7 October hold 25 planned lessons of 5 teachers, and today Продлёнка 08:00 (3 h), 8 класс А 09:00
// and 6 класс 11:00 are over too → 28 «не подтверждено»; 8 класс Б 14:00 is on, Химия 16:00 and
// Индивидуально 17:00 are ahead.
const GULZAT_ID = '00000000-0000-4000-a000-000000000001'
const CHEMISTRY = '00000000-0000-4000-b000-000000000008' // Эльмира, not on anyone's «Сегодня» test

test.use({ serviceWorkers: 'block' })
// «Не подтверждено» counts every teacher: wait for specs that add or remove lessons (#27).
lockSeed('read')

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

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

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)
// The fixed tab bar would cover the middle of a full-page shot.
const noTabBar = 'nav { visibility: hidden !important; }'

test('dashboard: KPI, today of all teachers, «Не подтверждено» 3 + ещё (А1 / АМ1)', async ({
  page,
}, testInfo) => {
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page, KANYKEI)
  await expect(page.getByText('Четверг, 8 октября')).toBeVisible()
  const kpi = page.getByTestId('kpi-unconfirmed')
  await expect(kpi).toHaveText('28')

  const today = page.getByRole('list', { name: 'Занятия сегодня' })
  const rows = today.getByRole('listitem')
  await expect(rows).toHaveCount(6)
  await expect(rows.nth(0)).toContainText('08:00')
  await expect(rows.nth(0)).toContainText('Продлёнка · утро')
  await expect(rows.nth(3)).toContainText('Математика · 8 класс Б')

  if (isDesktop(page)) {
    await expect(page.getByRole('heading', { name: 'Добрый день, Каныкей' })).toBeVisible()
    await expect(page.getByText('0 проведено · 1 идёт · 2 впереди · 3 не подтв.')).toBeVisible()
    await expect(page.getByText('за 7 дней · 5 учителей')).toBeVisible()
    await expect(rows.nth(0)).toContainText('Нургуль')
    await expect(rows.nth(0)).toContainText('Не подтверждено')
    await expect(rows.nth(3)).toContainText('Гульзат · 8 учеников · каб. 2')
    await expect(rows.nth(3)).toContainText('Идёт')
    await expect(rows.nth(4)).toContainText('Далее')

    const widget = page.getByRole('region', { name: 'Не подтверждено' })
    await expect(widget.getByRole('listitem')).toHaveCount(3)
    await expect(widget.getByRole('listitem').nth(0)).toContainText(
      'Сегодня 11:00 · Математика · 6 класс · Гульзат',
    )
    await expect(widget.getByRole('listitem').nth(2)).toContainText(
      'Сегодня 08:00 · Продлёнка · утро · Нургуль',
    )
    await expect(widget.getByRole('link', { name: 'Все 28 →' })).toBeVisible()
    await expect(widget.getByText('ещё 25 занятий · самое старое 1 окт →')).toBeVisible()
    // Money and trials wait for R2: same places, no numbers.
    await expect(page.getByText('Пробные занятия — появится в R2')).toBeVisible()
    await expect(page.getByText('Сентябрь · ЗП')).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'dashboard'), fullPage: true })
    await widget.getByText('ещё 25 занятий').click()
  } else {
    await expect(page.getByRole('heading', { name: 'Центр сегодня' })).toBeVisible()
    await expect(page.getByText('5 учителей')).toBeVisible()
    const attention = page.getByRole('list', { name: 'Требует внимания' })
    await expect(attention.getByRole('listitem')).toHaveCount(3)
    await expect(attention.getByRole('listitem').nth(1)).toContainText(
      'Сегодня 09:00 · Математика · 8 класс А · Гульзат — не подтверждено',
    )
    await page.screenshot({ path: shot(testInfo, 'dashboard'), fullPage: true, style: noTabBar })
    await page.getByRole('link', { name: 'ещё 25 занятий · самое старое 1 окт →' }).click()
  }

  // «ещё N» → А2 with the filter: only lessons that are over and not confirmed.
  await expect(page).toHaveURL(/\/admin\/schedule\?filter=unconfirmed$/)
  await expect(page.getByRole('button', { name: 'Не подтверждено' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '28 сентября – 3 октября · 13' })).toBeVisible()
  if (isDesktop(page)) {
    const cards = page.getByRole('table', { name: 'Расписание недели' }).getByRole('link')
    // 5–7 October: 3 + 6 + 3, and today's three that are over.
    await expect(cards).toHaveCount(15)
    for (const tone of await cards.evaluateAll((els) => els.map((e) => e.dataset.tone))) {
      expect(tone).toBe('unconfirmed')
    }
  } else {
    const day = page.getByRole('list', { name: 'Расписание дня' })
    await expect(day.getByRole('listitem')).toHaveCount(3)
    await expect(day).not.toContainText('8 класс Б')
  }
})

test('schedule: week grid / day list, teacher filter, week navigation (А2)', async ({
  page,
}, testInfo) => {
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page, KANYKEI)
  await page.goto('/admin/schedule')

  if (isDesktop(page)) {
    await expect(page.getByRole('heading', { name: '5 – 10 октября' })).toBeVisible()
    const grid = page.getByRole('table', { name: 'Расписание недели' })
    await expect(grid.getByRole('columnheader', { name: 'ЧТ 8 · сегодня' })).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: 'ВС 11' })).toHaveCount(0)
    await expect(grid.getByRole('rowheader')).toHaveText([
      '08:00',
      '09:00',
      '11:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
    ])
    await expect(grid.locator('[data-tone="current"]')).toHaveText(/Математика · 8 класс Б · идёт/)
    await expect(page.getByRole('list', { name: 'Легенда' })).toContainText(
      'пробный ученик / группа на пробном',
    )
    await page.screenshot({ path: shot(testInfo, 'schedule'), fullPage: true })

    await page
      .getByRole('group', { name: 'Учитель' })
      .getByRole('button', { name: 'Гульзат' })
      .click()
    await expect(page).toHaveURL(new RegExp(`teacher=${GULZAT_ID}`))
    await expect(grid.getByRole('link')).toHaveCount(12)
    await expect(grid).not.toContainText('Нургуль')

    await page.getByRole('button', { name: 'Следующая неделя' }).click()
    await expect(page.getByRole('heading', { name: '12 – 17 октября' })).toBeVisible()
    await expect(grid.locator('[data-tone="unconfirmed"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Сегодня' }).click()
    await expect(page.getByRole('heading', { name: '5 – 10 октября' })).toBeVisible()

    await grid.locator('[data-tone="current"]').click()
    await expect(page).toHaveURL(/\/admin\/groups\/00000000-0000-4000-b000-000000000003$/)
  } else {
    await expect(page.getByRole('heading', { name: 'Четверг, 8 октября' })).toBeVisible()
    const day = page.getByRole('list', { name: 'Расписание дня' })
    await expect(day.getByRole('listitem')).toHaveCount(6)
    await expect(day.locator('[data-tone="current"]')).toContainText('8 класс Б · идёт')
    await page.screenshot({ path: shot(testInfo, 'schedule'), fullPage: true, style: noTabBar })

    await page.getByRole('button', { name: 'Следующий день' }).click()
    await expect(page.getByRole('heading', { name: 'Пятница, 9 октября' })).toBeVisible()
    await expect(page).toHaveURL(/date=2026-10-09/)
    await page
      .getByRole('group', { name: 'День недели' })
      .getByRole('button', { name: 'ПН 5' })
      .click()
    await expect(page.getByRole('heading', { name: 'Понедельник, 5 октября' })).toBeVisible()
    await page.getByRole('button', { name: 'Сегодня' }).click()
    await expect(page.getByRole('heading', { name: 'Четверг, 8 октября' })).toBeVisible()

    await page
      .getByRole('group', { name: 'Учитель' })
      .getByRole('button', { name: 'Гульзат' })
      .click()
    await expect(day.getByRole('listitem')).toHaveCount(3)
  }
})

test('realtime: a lesson gets confirmed → «Не подтверждено» drops without reload', async ({
  page,
}, testInfo) => {
  // Own month per project (the counter is per month), so the two viewports never meet.
  const [today, yesterday] =
    testInfo.project.name === 'webkit-desktop'
      ? ['2026-11-05', '2026-11-04']
      : ['2026-12-03', '2026-12-02']
  const db = service()
  const cleanup = () =>
    db
      .from('lessons')
      .delete()
      .eq('group_id', CHEMISTRY)
      .eq('lesson_date', yesterday)
      .eq('planned_start', '19:00')
  await cleanup()
  const { data: extra, error } = await db
    .from('lessons')
    .insert({
      group_id: CHEMISTRY,
      lesson_date: yesterday,
      planned_start: '19:00',
      duration_min: 60,
    })
    .select('id')
    .single()
  if (error) throw error

  try {
    await pinClock(page, `${today}T12:00:00+06:00`)
    await login(page, KANYKEI)
    const kpi = page.getByTestId('kpi-unconfirmed')
    await expect(kpi).toHaveText(/^\d+$/)
    const before = Number(await kpi.textContent())
    expect(before).toBeGreaterThan(0)

    // What «Провести» (#12) will do to the row; RPC comes with R1-8, so the service role here.
    const { error: heldError } = await db
      .from('lessons')
      .update({ status: 'held' })
      .eq('id', extra.id)
    if (heldError) throw heldError

    // Realtime, not the 60 s poll: well under the refetch interval.
    await expect(kpi).toHaveText(String(before - 1), { timeout: 15_000 })
    await page.screenshot({
      path: shot(testInfo, 'after-confirm'),
      fullPage: true,
      style: noTabBar,
    })
  } finally {
    await cleanup()
  }
})
