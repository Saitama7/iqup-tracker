import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// Needs the local stack + `pnpm seed:users` (seed: 8 groups with schedule_rules and lessons).

// The new group's lessons change the months other specs count for a while (#27).
lockSeed('write')

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

// One group per project (different teachers), so the two viewports never touch the same rows.
const testGroup = (testInfo: TestInfo) =>
  testInfo.project.name === 'webkit-desktop'
    ? { name: 'e2e десктоп', teacher: /^Айпери/ }
    : { name: 'e2e мобильный', teacher: /^Бекзат/ }

const serviceClient = () => {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function removeGroup(name: string) {
  const { data: groups } = await serviceClient().from('groups').select('id').eq('name', name)
  await removeGroups((groups ?? []).map((g) => g.id))
}

async function removeGroups(ids: readonly string[]) {
  const service = serviceClient()
  for (const id of ids) {
    await service
      .from('lessons')
      .delete()
      .eq('group_id', id)
      .not('makes_up_for_lesson_id', 'is', null)
    await service.from('lessons').delete().eq('group_id', id)
    await service.from('schedule_rules').delete().eq('group_id', id)
    await service.from('groups').delete().eq('id', id)
  }
}

const groupRow = (page: Page, label: string) =>
  isDesktop(page)
    ? page.getByRole('table', { name: 'Группы' }).getByRole('row').filter({ hasText: label })
    : page.getByRole('list', { name: 'Группы' }).getByRole('listitem').filter({ hasText: label })

test('А3: groups with schedule and seats; А4: 8 класс А with students and lessons', async ({
  page,
}, testInfo) => {
  await login(page, KANYKEI)
  if (isDesktop(page)) {
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('link', { name: 'Группы' })
      .click()
  } else {
    await page.goto('/admin/groups')
  }
  await expect(page).toHaveURL(/\/admin\/groups$/)
  await expect(page.getByRole('heading', { name: 'Группы', exact: true })).toBeVisible()
  await expect(page.getByText(/^\d+ активн\S+ · \d+ набира\S+ · \d+ в архиве$/)).toBeVisible()

  const row = groupRow(page, 'Математика · 8 класс А')
  await expect(row).toContainText('ВТ ЧТ СБ · 09:00')
  // 8 / 10 in the seed; admin-students may enroll one more in parallel
  await expect(row).toContainText(/[89] \/ 10/)
  await expect(row).toContainText('Гульзат')
  await expect(row).toContainText('Активна')
  await expect(groupRow(page, 'Продлёнка · утро')).toContainText('ПН–ПТ · 08:00')
  await page.screenshot({ path: testInfo.outputPath('groups.png'), fullPage: true })

  await page.getByRole('searchbox', { name: 'Поиск группы' }).fill('химия')
  await expect(groupRow(page, 'Химия · 9 класс')).toBeVisible()
  await expect(groupRow(page, 'Математика · 8 класс А')).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Поиск группы' }).fill('')

  await row.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/admin\/groups\/00000000-0000-4000-b000-000000000001$/)
  await expect(page.getByRole('heading', { name: 'Математика · 8 класс А' })).toBeVisible()
  await expect(
    page.getByText('Групповая · Гульзат (45 %) · ВТ, ЧТ, СБ 09:00–10:00 · каб. 1', {
      exact: false,
    }),
  ).toBeVisible()
  const roster = page.getByRole(isDesktop(page) ? 'table' : 'list', { name: 'Ученики группы' })
  await expect(roster).toContainText('Айжан Бекова')
  await expect(roster).toContainText('скидка 15 %')
  await expect(roster).toContainText('Нурлан Асанов')
  await page.screenshot({ path: testInfo.outputPath('group.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Занятия' }).click()
  const upcoming = page.getByRole('list', { name: 'Предстоящие занятия' })
  await expect(upcoming.getByRole('listitem').first()).toContainText('09:00')
  await expect(page.getByRole('list', { name: 'Прошедшие занятия' })).toContainText(
    'не подтверждено',
  )
})

test('create a group from А3 → future lessons on А4; cancel, make up, substitute', async ({
  page,
}, testInfo) => {
  const { name, teacher } = testGroup(testInfo)
  const label = `Химия · ${name}`
  await removeGroup(name)
  await login(page, KANYKEI)
  await page.goto('/admin/groups')

  if (!isDesktop(page)) await page.getByRole('button', { name: '+ Новая' }).click()
  const form = page.getByRole('form', { name: 'Новая группа' })
  await form.getByRole('button', { name: 'Создать группу' }).click()
  await expect(form.getByRole('alert')).toHaveText('Введите название')

  await form.getByLabel('Название').fill(name)
  await form.getByLabel('Предмет').selectOption('Химия')
  await form.getByLabel('Класс').selectOption('7')
  await form.getByLabel('Тип и тариф').selectOption({ label: 'Мини-группа · до 4 · 3 800 / 12 ур' })
  const teacherOption = await form
    .getByLabel('Учитель')
    .locator('option')
    .filter({ hasText: teacher })
    .first()
    .getAttribute('value')
  await form.getByLabel('Учитель').selectOption(teacherOption ?? '')
  await form.getByRole('button', { name: 'ПН' }).click()
  await form.getByRole('button', { name: 'СР' }).click()
  await form.getByLabel('Время').fill('19:00')
  await form.getByLabel('Кабинет').fill('3')
  const preview = form.getByRole('status', { name: 'Предпросмотр' })
  await expect(preview).toContainText('нет.')
  await expect(preview).toContainText(
    /Будет создано \d+ заняти\S* до \d+ \S+, праздники пропущены\./,
  )
  await page.screenshot({ path: testInfo.outputPath('new-group.png') })

  await form.getByRole('button', { name: 'Создать группу' }).click()
  await expect(page).toHaveURL(/\/admin\/groups\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: label })).toBeVisible()
  await expect(page.getByText('Набор', { exact: true })).toBeVisible()
  await expect(page.getByText('· каб. 3 ·', { exact: false })).toBeVisible()

  await page.getByRole('tab', { name: 'Занятия' }).click()
  const upcoming = page.getByRole('list', { name: 'Предстоящие занятия' })
  const first = upcoming.getByRole('listitem').first()
  await expect(first).toContainText(/(пн|ср) 19:00/)
  expect(await upcoming.getByRole('listitem').count()).toBeGreaterThanOrEqual(8)

  // Cancel the first upcoming lesson (center), then make it up with an extra lesson.
  const when = (await first.locator('span').first().innerText()).trim()
  await first.getByRole('button', { name: /^Отменить/ }).click()
  const cancel = page.getByRole('form', { name: 'Отменить занятие' })
  await cancel.getByRole('button', { name: 'Отменить занятие' }).click()
  await expect(cancel.getByRole('alert')).toHaveText('Выберите причину')
  await cancel.getByRole('radio', { name: /Отменил центр/ }).click()
  await cancel.getByRole('button', { name: 'Отменить занятие' }).click()
  await expect(cancel).toBeHidden()
  const cancelled = upcoming.getByRole('listitem').filter({ hasText: when })
  await expect(cancelled).toContainText('отменено · отменил центр')

  await cancelled.getByRole('button', { name: /^Доп. урок за/ }).click()
  const extra = page.getByRole('form', { name: 'Доп. урок' })
  await expect(extra.getByLabel('Восполняет')).not.toHaveValue('')
  await extra.getByLabel('Время').fill('20:30')
  await extra.getByRole('button', { name: 'Добавить доп. урок' }).click()
  await expect(extra).toBeHidden()
  await expect(cancelled).toContainText('восполнено')
  await expect(upcoming.getByRole('listitem').filter({ hasText: '20:30' })).toContainText('доп.')

  // Substitute: informational.
  const next = upcoming.getByRole('listitem').filter({ hasText: 'запланировано' }).nth(1)
  await next.getByRole('button', { name: /^Замена/ }).click()
  const sub = page.getByRole('form', { name: 'Замена учителя' })
  await sub.getByLabel('Фактически вёл').selectOption({ label: 'Гульзат Асанова' })
  await sub.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sub).toBeHidden()
  await expect(next).toContainText('замена: Гульзат')
  await page.screenshot({ path: testInfo.outputPath('group-lessons.png'), fullPage: true })

  // Schedule change from next week: old planned lessons go, new ones appear.
  await page.getByRole('button', { name: 'Изменить' }).click()
  const edit = page.getByRole('form', { name: 'Изменить группу' })
  await edit.getByRole('button', { name: 'Активна' }).click()
  await edit.getByRole('button', { name: 'СР' }).click()
  await edit.getByRole('button', { name: 'ПТ' }).click()
  await expect(edit.getByRole('status')).toContainText('по старому расписанию удалятся')
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(edit).toBeHidden()
  await expect(page.getByText('Активна', { exact: true })).toBeVisible()
  await expect(upcoming.getByRole('listitem').filter({ hasText: /ср 19:00/ })).toHaveCount(0)
  await expect(
    upcoming
      .getByRole('listitem')
      .filter({ hasText: /пт 19:00/ })
      .first(),
  ).toBeVisible()

  // Archive: future planned lessons disappear, the group moves to «Архив».
  await page.getByRole('button', { name: 'Архивировать' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Архивировать' }).click()
  await expect(page.getByText('В архиве', { exact: true })).toBeVisible()
  await expect(upcoming.getByRole('listitem').filter({ hasText: 'запланировано' })).toHaveCount(0)
  await page.goto('/admin/groups?tab=archived')
  await expect(groupRow(page, label)).toContainText('В архиве')

  await removeGroup(name)
})

test('А3: auto name from subject and class with a letter; new subject from the form (#42)', async ({
  page,
}, testInfo) => {
  const { teacher } = testGroup(testInfo)
  // Unique per run — `--repeat-each` copies and both projects run in parallel (И30).
  const subject = `Е2е ${testInfo.project.name === 'webkit-desktop' ? 'деск' : 'моб'} ${Date.now() % 1_000_000}`
  const service = serviceClient()
  try {
    await login(page, KANYKEI)
    await page.goto('/admin/groups')
    if (!isDesktop(page)) await page.getByRole('button', { name: '+ Новая' }).click()
    const form = page.getByRole('form', { name: 'Новая группа' })
    const nameField = form.getByLabel('Название')

    // Seed: Математика · 8 класс А / Б, Математика · 6 класс.
    await form.getByLabel('Предмет').selectOption({ label: 'Математика' })
    await form.getByLabel('Класс').selectOption('8')
    await expect(nameField).toHaveValue('8 класс В')
    await form.getByLabel('Класс').selectOption('6')
    await expect(nameField).toHaveValue('6 класс А')
    await form.getByLabel('Класс').selectOption('7')
    await expect(nameField).toHaveValue('7 класс')
    await form.getByLabel('Тип и тариф').selectOption('pair')
    await expect(nameField).toHaveValue('7 класс · пара')
    await form.getByLabel('Тип и тариф').selectOption('group')

    // A name typed by the admin is kept.
    await nameField.fill('Олимпиадная')
    await form.getByLabel('Класс').selectOption('9')
    await expect(nameField).toHaveValue('Олимпиадная')
    await form.getByLabel('Класс').selectOption('6')
    await expect(nameField).toHaveValue('Олимпиадная')

    // A duplicate typed by hand is caught before saving.
    await nameField.fill('6 класс')
    await form.getByLabel('Учитель').selectOption({ index: 1 })
    await form.getByRole('button', { name: 'ВТ' }).click()
    await form.getByRole('button', { name: 'Создать группу' }).click()
    await expect(form.getByRole('alert')).toHaveText(
      'Группа с таким названием по этому предмету уже есть',
    )

    // New subject right from the form; it becomes the selected subject.
    await form.getByLabel('Предмет').selectOption({ label: '+ Новый предмет…' })
    await form.getByLabel('Новый предмет').fill(subject)
    await form.getByRole('button', { name: 'Добавить предмет' }).click()
    await expect(form.getByLabel('Новый предмет')).toBeHidden()
    await expect(form.getByLabel('Предмет').locator('option:checked')).toHaveText(subject)
    await form.getByLabel('Класс').selectOption('7')
    await nameField.fill('7 класс')
    const teacherOption = await form
      .getByLabel('Учитель')
      .locator('option')
      .filter({ hasText: teacher })
      .first()
      .getAttribute('value')
    await form.getByLabel('Учитель').selectOption(teacherOption ?? '')
    await form.getByLabel('Время').fill('20:00')
    await page.screenshot({ path: testInfo.outputPath('new-group-autoname.png') })

    await form.getByRole('button', { name: 'Создать группу' }).click()
    await expect(page).toHaveURL(/\/admin\/groups\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: `${subject} · 7 класс` })).toBeVisible()

    // A fresh form names the second group of the same subject and class with «А».
    await page.goto('/admin/groups')
    if (!isDesktop(page)) await page.getByRole('button', { name: '+ Новая' }).click()
    await form.getByLabel('Предмет').selectOption({ label: subject })
    await form.getByLabel('Класс').selectOption('7')
    await expect(nameField).toHaveValue('7 класс А')
  } finally {
    const { data: subj } = await service.from('subjects').select('id').eq('name', subject)
    for (const { id } of subj ?? []) {
      const { data: groups } = await service.from('groups').select('id').eq('subject_id', id)
      await removeGroups((groups ?? []).map((g) => g.id))
      await service.from('subjects').delete().eq('id', id)
    }
  }
})
