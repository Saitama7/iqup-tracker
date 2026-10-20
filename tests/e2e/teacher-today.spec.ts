/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, KANYKEI, login } from './support/auth'
import { groupTeacher } from './support/db'
import { lockSeed } from './support/seed-lock'

// Pins Гульзат's seed day (lessons, «Не подтверждено», 8 pupils in 8 класс А): no spec may add or
// hold rows of the seed while it reads (#104).
lockSeed('read')

// Needs the local stack + `pnpm seed:users`. Seed: Гульзат teaches 8 класс А 09:00, 6 класс 11:00,
// 8 класс Б 14:00 on ВТ/ЧТ/СБ and 5 класс 15:00 on ПН/СР/ПТ (lessons from 1 Sep, ensure_lessons).
// The real "today" may be a Sunday, so the browser clock is pinned to a seed day — Thursday 8 October,
// the date of the artboards — and server_now() answers the same instant (otherwise the server offset
// would pull the app back to the real time, docs/02-architecture.md §7.1).
// Nothing in the seed is confirmed, so on 8 October 1–7 October hold 12 unconfirmed lessons.
const GROUP_8B = '00000000-0000-4000-b000-000000000003'

// The PWA service worker would fetch server_now() itself, out of page.route's reach.
test.use({ serviceWorkers: 'block' })

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

async function swipeLeft(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(({ x, y, width, height }) => {
    const startX = x + width - 30
    const cy = y + height / 2
    const init = (clientX: number, buttons: number): PointerEventInit => ({
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: cy,
      button: 0,
      buttons,
    })
    const target = document.elementFromPoint(startX, cy)
    if (!target) throw new Error('nothing under the finger')
    target.dispatchEvent(new PointerEvent('pointerdown', init(startX, 1)))
    for (let i = 1; i <= 10; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', init(startX - i * 25, 1)))
    }
    window.dispatchEvent(new PointerEvent('pointerup', init(startX - 250, 0)))
  }, box)
}

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

test('Гульзат: 3 seed lessons, the current one on top (У2 / УД1)', async ({ page }, testInfo) => {
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Сегодня, Гульзат' })).toBeVisible()
  await expect(page.getByText('Четверг, 8 октября')).toBeVisible()

  const list = page.getByRole('list', { name: 'Расписание на сегодня' })
  const rows = list.getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('09:00')
  await expect(rows.nth(0)).toContainText('Математика · 8 класс А')
  await expect(rows.nth(0)).toContainText('Не подтверждено')
  await expect(rows.nth(1)).toContainText('Математика · 6 класс')
  await expect(rows.nth(2)).toContainText('Математика · 8 класс Б')

  if (isDesktop(page)) {
    const current = page.getByRole('link', { name: /Сейчас · 14:00–15:00/ })
    await expect(current).toContainText('Математика · 8 класс Б')
    await expect(current).toContainText('ещё 36 мин')
    await expect(current).toContainText('Групповая · 8 учеников · каб. 2')
    // The group title fits one line, as on the artboard (28 px × line-height 1.1).
    const title = current.getByText('Математика · 8 класс Б', { exact: true })
    expect((await title.boundingBox())?.height).toBeLessThan(40)
    await expect(page.getByText('3 занятия · 0 проведено')).toBeVisible()
    await expect(page.getByText('12 не подтверждено', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Требует внимания' })).toBeVisible()
    await expect(page.getByText('Не подтверждено: 12 занятий')).toBeVisible()
    await expect(page.getByText('Вчера, 15:00 · Математика · 5 класс')).toBeVisible()
    await expect(page.getByText('6 октября, 14:00 · Математика · 8 класс Б')).toBeVisible()
    await expect(page.getByText('6 октября, 11:00 · Математика · 6 класс')).toBeVisible()
    await expect(page.getByText('ещё 9')).toBeVisible()
    await expect(page.getByText('Октябрь · предварительно')).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'today'), fullPage: true })
    await current.click()
  } else {
    await expect(page.getByRole('heading', { name: 'Идёт сейчас' })).toBeVisible()
    await expect(page.getByText('3 занятия · 0 проведено · осталось 3')).toBeVisible()
    const deck = page.getByRole('group', { name: 'Непроведённые занятия' })
    const top = deck.getByRole('link')
    await expect(top).toContainText('Сейчас · 14:00–15:00')
    await expect(top).toContainText('8 класс Б')
    await expect(top).toContainText('ещё 36 мин')
    await expect(page.getByText('1 из 3 · только непроведённые')).toBeVisible()
    const banner = page.getByRole('region', { name: 'Не подтверждено: 12 занятий' })
    await expect(banner.getByRole('link')).toHaveCount(3)
    await expect(banner.getByRole('link').nth(0)).toContainText(
      'Вчера, 15:00 · Математика · 5 класс',
    )
    await expect(banner.getByRole('link').nth(1)).toContainText(
      '6 октября, 14:00 · Математика · 8 класс Б',
    )
    await expect(banner).toContainText('ещё 9')
    await expect(page.getByRole('heading', { name: 'Завтра, пятница' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Завтра' })).toContainText('Математика · 5 класс')
    // The fixed tab bar would cover the middle of a full-page shot.
    const noTabBar = 'nav { visibility: hidden !important; }'
    await page.screenshot({ path: shot(testInfo, 'today'), fullPage: true, style: noTabBar })
    await banner.screenshot({ path: shot(testInfo, 'unconfirmed'), style: noTabBar })

    // Swipe left → the next card (unconfirmed 09:00 goes after the current one).
    // Playwright has no touch gestures in WebKit — synthetic pointer events, as a finger sends them.
    const box = await top.boundingBox()
    if (!box) throw new Error('deck card is not rendered')
    await swipeLeft(page, box)
    await expect(page.getByText('2 из 3 · только непроведённые')).toBeVisible()
    await expect(deck.getByRole('link')).toHaveCount(1) // the swiped card has flown out
    await expect(deck.getByRole('link')).toContainText('Не подтверждено · 09:00–10:00')
    await deck.getByRole('link').click()
  }

  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}\?from=today$/)
  await expect(page.getByRole('list', { name: 'Ученики' }).getByRole('listitem')).toHaveCount(8)
})

test('only yesterday is unconfirmed → «Вчера не подтверждено»', async ({ page }) => {
  // Friday 2 October: the only earlier days of the month are 1 October with three lessons.
  await pinClock(page, '2026-10-02T10:00:00+06:00')
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  if (isDesktop(page)) {
    await expect(page.getByText('3 не подтверждено за вчера')).toBeVisible()
    await expect(page.getByText('Вчера не подтверждено')).toBeVisible()
    await expect(page.getByText('Вчера, 14:00 · Математика · 8 класс Б')).toBeVisible()
  } else {
    const banner = page.getByRole('region', { name: 'Вчера не подтверждено' })
    await expect(banner.getByRole('link')).toHaveCount(3)
    await expect(banner.getByRole('link').nth(2)).toContainText(
      'Вчера, 09:00 · Математика · 8 класс А',
    )
    await expect(banner).not.toContainText('ещё')
  }
})

test('realtime: admin cancels a lesson → its card leaves the deck without reload', async ({
  page,
}, testInfo) => {
  // Own Saturday per project, so the two viewports never touch the same rows; after 8 October, so the
  // specs pinned to that day (payroll, А1) never count the extra lesson (#27).
  const day = testInfo.project.name === 'webkit-desktop' ? '2026-10-17' : '2026-10-10'
  const db = service()
  const cleanup = () =>
    db
      .from('lessons')
      .delete()
      .eq('group_id', GROUP_8B)
      .eq('lesson_date', day)
      .eq('planned_start', '18:00')
  await cleanup()
  const { data: extra, error } = await db
    .from('lessons')
    .insert({
      group_id: GROUP_8B,
      teacher_id: await groupTeacher(db, GROUP_8B),
      lesson_date: day,
      planned_start: '18:00',
      duration_min: 60,
    })
    .select('id')
    .single()
  if (error) throw error

  try {
    await pinClock(page, `${day}T17:55:00+06:00`)
    await login(page, GULZAT)
    await expect(page).toHaveURL(/\/today$/)
    const current = isDesktop(page)
      ? page.getByRole('link', { name: /Сейчас · 18:00–19:00/ })
      : page.getByRole('group', { name: 'Непроведённые занятия' }).getByRole('link')
    await expect(current).toContainText('Сейчас · 18:00–19:00')
    const row = page
      .getByRole('list', { name: 'Расписание на сегодня' })
      .getByRole('listitem')
      .filter({ hasText: '18:00' })
    await expect(row).toContainText(isDesktop(page) ? 'Отметить →' : 'Сейчас')

    const { error: cancelError } = await db
      .from('lessons')
      .update({ status: 'cancelled', cancel_reason: 'center' })
      .eq('id', extra.id)
    if (cancelError) throw cancelError

    // Realtime, not the 60 s poll: well under the refetch interval.
    await expect(page.getByRole('link', { name: /18:00–19:00/ })).toHaveCount(0, {
      timeout: 15_000,
    })
    await expect(row).toContainText('Отменено')
    await page.screenshot({ path: shot(testInfo, 'after-cancel'), fullPage: true })
  } finally {
    await cleanup()
  }
})

test('admin+teacher Каныкей opens /today as a teacher', async ({ page }) => {
  await pinClock(page, '2026-10-08T14:24:00+06:00')
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Сегодня, Каныкей' })).toBeVisible()
  await expect(page.getByText('Сегодня занятий нет.').first()).toBeVisible()
})
