import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// #100: a group on Saturdays and Sundays at 15:00 for 1,5 hours — «Длительность, мин» in «Новая
// группа» wins over the tariff's 60; «Изменить группу» → «Длительность занятий» from a date moves only
// the planned lessons from it. Needs the local stack + `pnpm seed:users`.

// The new group's lessons change the months other specs count for a while (#27).
lockSeed('write')

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const snap = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({ path: `docs/screenshots/r100-${name}-${size(testInfo)}.png` })

// One group per project (different teachers), so the two viewports never touch the same rows.
const fixture = (testInfo: TestInfo) =>
  testInfo.project.name === 'webkit-desktop'
    ? { name: 'e2e выходные десктоп', teacher: /^Айпери/ }
    : { name: 'e2e выходные мобильный', teacher: /^Бекзат/ }

const serviceClient = () => {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function removeGroup(name: string) {
  const service = serviceClient()
  const { data: groups } = await service.from('groups').select('id').eq('name', name)
  for (const { id } of groups ?? []) {
    await service.from('lessons').delete().eq('group_id', id)
    await service.from('schedule_rules').delete().eq('group_id', id)
    await service.from('groups').delete().eq('id', id)
  }
}

const DAY_MS = 86_400_000
/** Today in Asia/Bishkek (UTC+6) — the app's «today» too. */
const bishkekToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10)
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 Sunday … 6 Saturday
const ru = (iso: string) => iso.split('-').reverse().join('.')

test('группа Сб+Вс 15:00 по 90 мин; длительность с даты — только будущие запланированные', async ({
  page,
}, testInfo) => {
  const f = fixture(testInfo)
  await removeGroup(f.name)
  const service = serviceClient()
  const today = bishkekToday()
  // the first Saturday after today, its Sunday; the length changes from the Saturday a week later
  let sat = addDays(today, 1)
  while (weekday(sat) !== 6) sat = addDays(sat, 1)
  const sun = addDays(sat, 1)
  const from = addDays(sat, 7)

  try {
    await login(page, KANYKEI)
    await page.goto('/admin/groups')
    if (!isDesktop(page)) await page.getByRole('button', { name: '+ Новая' }).click()
    const form = page.getByRole('form', { name: 'Новая группа' })
    await form.getByLabel('Название').fill(f.name)
    await form.getByLabel('Предмет').selectOption('Математика')
    await form.getByLabel('Класс').selectOption('6')
    await form
      .getByLabel('Тип и тариф')
      .selectOption({ label: 'Мини-группа · до 4 · 3 800 / 12 ур' })
    const teacher = await form
      .getByLabel('Учитель')
      .locator('option')
      .filter({ hasText: f.teacher })
      .first()
      .getAttribute('value')
    await form.getByLabel('Учитель').selectOption(teacher ?? '')
    await form.getByRole('button', { name: 'СБ' }).click()
    await form.getByRole('button', { name: 'ВС' }).click()
    await form.getByLabel('Время').fill('15:00')
    await form.getByLabel('Первое занятие').fill(ru(sat))

    // the tariff's length fills the field until the admin changes it
    const duration = form.getByLabel('Длительность, мин')
    await expect(duration).toHaveValue('60')
    await expect(form.getByText('по тарифу — 60 мин')).toBeVisible()
    await duration.fill('90')
    await expect(form.getByRole('status', { name: 'Предпросмотр' })).toContainText(
      /Будет создано \d+ заняти\S* до/,
    )
    await snap(page, testInfo, 'new-group')
    await form.getByRole('button', { name: 'Создать группу' }).click()
    await expect(page).toHaveURL(/\/admin\/groups\/[0-9a-f-]{36}$/)
    const groupId = page.url().split('/').pop() ?? ''

    // А4: the schedule with the group's length
    await expect(page.getByText('СБ, ВС 15:00–16:30', { exact: false })).toBeVisible()
    const { data: created } = await service
      .from('lessons')
      .select('lesson_date, duration_min')
      .eq('group_id', groupId)
    expect(created?.length).toBeGreaterThanOrEqual(4)
    expect(new Set(created?.map((l) => l.duration_min))).toEqual(new Set([90]))

    // А2: Saturday and Sunday at 15:00; the lesson card says 15:00–16:30
    await page.goto(`/admin/schedule?date=${sat}`)
    if (isDesktop(page)) {
      const week = page.getByRole('table', { name: 'Расписание недели' })
      await expect(week.getByRole('row').filter({ hasText: '15:00' })).toContainText(
        `Математика · ${f.name}`,
      )
      await expect(
        week.getByRole('link', { name: new RegExp(`Математика · ${f.name}`) }),
      ).toHaveCount(2)
    } else {
      for (const day of [sat, sun]) {
        if (day === sun) {
          await page
            .getByRole('group', { name: 'День недели' })
            .getByRole('button', { name: new RegExp(`^ВС`, 'i') })
            .click()
        }
        await expect(
          page
            .getByRole('list', { name: 'Расписание дня' })
            .getByRole('listitem')
            .filter({ hasText: `Математика · ${f.name}` }),
        ).toContainText('15:00')
      }
    }
    await snap(page, testInfo, 'schedule')
    const { data: satLesson } = await service
      .from('lessons')
      .select('id')
      .eq('group_id', groupId)
      .eq('lesson_date', sat)
      .single()
    await page.goto(`/lessons/${satLesson?.id ?? ''}`)
    await expect(page.getByText('15:00–16:30', { exact: false }).first()).toBeVisible()

    // «Изменить группу» → 60 minutes from the next Saturday
    await page.goto(`/admin/groups/${groupId}`)
    await page.getByRole('button', { name: 'Изменить' }).click()
    const edit = page.getByRole('form', { name: 'Изменить группу' })
    const box = edit.getByRole('group', { name: 'Длительность занятий' })
    await expect(box.getByLabel('Минут')).toHaveValue('90')
    await expect(
      box.getByText('Изменятся только запланированные занятия с этой даты'),
    ).toBeVisible()
    await box.getByLabel('Минут').fill('60')
    await box.getByLabel('Действует с').fill(ru(from))
    await box.scrollIntoViewIfNeeded()
    await snap(page, testInfo, 'edit-duration')
    await edit.getByRole('button', { name: 'Сохранить' }).click()
    await expect(edit).toBeHidden()
    await expect(page.getByText(/Длительность — 60 мин с .* · изменено занятий: \d+/)).toBeVisible()

    const { data: after } = await service
      .from('lessons')
      .select('lesson_date, duration_min')
      .eq('group_id', groupId)
    const before = (after ?? []).filter((l) => l.lesson_date < from)
    const later = (after ?? []).filter((l) => l.lesson_date >= from)
    expect(before.map((l) => l.duration_min)).toEqual([90, 90])
    expect(later.length).toBeGreaterThan(0)
    expect(new Set(later.map((l) => l.duration_min))).toEqual(new Set([60]))
    // the group's own length is the tariff's now → back to the tariff (null)
    const { data: group } = await service
      .from('groups')
      .select('lesson_duration_min')
      .eq('id', groupId)
      .single()
    expect(group?.lesson_duration_min).toBeNull()

    const { data: nextSat } = await service
      .from('lessons')
      .select('id')
      .eq('group_id', groupId)
      .eq('lesson_date', from)
      .single()
    await page.goto(`/lessons/${nextSat?.id ?? ''}`)
    await expect(page.getByText('15:00–16:00', { exact: false }).first()).toBeVisible()
    await page.goto(`/lessons/${satLesson?.id ?? ''}`)
    await expect(page.getByText('15:00–16:30', { exact: false }).first()).toBeVisible()

    // А10: the journal line
    await page.goto('/admin/audit')
    await expect(
      page
        .getByText(`Математика · ${f.name} — Длительность занятий: 90 → 60 мин (по тарифу) с`)
        .first(),
    ).toBeVisible()
    await snap(page, testInfo, 'audit')
  } finally {
    await removeGroup(f.name)
  }
})
