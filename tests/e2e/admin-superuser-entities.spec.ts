import { expect, test, type TestInfo } from '@playwright/test'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import {
  cleanup,
  holdLessons,
  makeEnrollment,
  makeGroup,
  service,
  teacherId,
} from './support/undo-fixtures'

// #94 «админ может всё»: trial (edit + back to the funnel), group (refused with payments / deleted
// without money), student (deleted without payments). Own group of Гульзат from 1 October; a held
// lesson moves her October payroll, hence the write lock.

lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const names = (testInfo: TestInfo) => ({
  group: `e2e суперюзер сущности ${size(testInfo)}`,
  student: `Е2е Сущности ${size(testInfo)}`,
})

async function wipe(testInfo: TestInfo) {
  const n = names(testInfo)
  await service().from('trials').delete().eq('full_name', n.student)
  await cleanup([n.group], [n.student])
}

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => wipe(testInfo))
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => wipe(testInfo))

test('А11: админ правит закрытое пробное и возвращает его в воронку', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const db = service()
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const { data: lesson } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'planned')
    .order('lesson_date', { ascending: false })
    .limit(1)
    .single()
  const { data: trial, error } = await db
    .from('trials')
    .insert({ full_name: n.student, group_id: groupId, lesson_id: lesson?.id ?? '' })
    .select('id')
    .single()
  if (error) throw error
  const closed = await db.from('trials').update({ status: 'closed' }).eq('id', trial.id)
  if (closed.error) throw closed.error

  await login(page, KANYKEI)
  await page.goto('/admin/trials?tab=conversion')
  const row = page.getByRole('list', { name: 'Пробные месяца' }).getByRole('listitem').filter({
    hasText: n.student,
  })
  await expect(row).toContainText('Отменено')

  await row.getByRole('button', { name: `Действия: ${n.student}` }).click()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  const edit = page.getByRole('form', { name: 'Изменить пробное' })
  await edit.getByLabel('Заметка').fill('e2e заметка')
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(edit.getByRole('alert')).toHaveText('Укажите причину')
  await edit.getByLabel('Причина').fill('e2e: дополнили')
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Пробное изменено')).toBeVisible()

  await row.getByRole('button', { name: `Действия: ${n.student}` }).click()
  await page.getByRole('button', { name: 'Вернуть в воронку' }).click()
  const reopen = page.getByRole('form', { name: 'Вернуть в воронку' })
  await expect(reopen.getByTestId('reopen-target')).toContainText('«Записан»')
  await reopen.getByLabel('Причина').fill('e2e: закрыли по ошибке')
  await reopen.getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(page.getByText(/^Пробное возвращено/)).toBeVisible()
  await expect(row).toContainText('Записан')

  const { data } = await db.from('trials').select('status, note').eq('id', trial.id).single()
  expect(data).toEqual({ status: 'scheduled', note: 'e2e заметка' })
})

test('А4: группа с оплатами не удаляется — подсказка про перевод и архив', async ({ page }) => {
  const { data: group } = await service().from('groups').select('id').eq('name', '8 класс А').single()
  await login(page, KANYKEI)
  await page.goto(`/admin/groups/${group?.id ?? ''}`)
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить группу' }).click()

  const blockers = page.getByTestId('group-delete-blockers')
  await expect(blockers).toContainText('Нельзя удалить: в группе оплаты учеников')
  await expect(blockers).toContainText('переведите учеников в другую группу')
  await expect(blockers).toContainText('архивируйте группу')
  await expect(page.getByRole('button', { name: 'Архивировать' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(blockers).toBeHidden()

  const { data } = await service().from('groups').select('id').eq('id', group?.id ?? '')
  expect(data).toHaveLength(1)
})

test('А4: группа без денег удаляется с предпросмотром ЗП и причиной', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const e = await makeEnrollment(n.student, groupId, '2026-10-01')
  await holdLessons(groupId, e.studentId, 1, 'present')

  await login(page, KANYKEI)
  await page.goto(`/admin/groups/${groupId}`)
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить группу' }).click()

  await expect(page.getByTestId('group-delete-impact')).toContainText(/^Удалится: \d+ занятий \(1 проведённых\)/)
  const form = page.getByRole('form', { name: 'Удалить группу' })
  await form.getByRole('button', { name: 'Удалить группу' }).click()
  await expect(form.getByRole('alert')).toHaveText('Укажите причину')
  await form.getByLabel('Причина').fill('e2e: создали по ошибке')
  await form.getByRole('button', { name: 'Удалить группу' }).click()
  await expect(page.getByText(`Группа удалена: ${n.group}`)).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/groups$/)

  const { data } = await service().from('groups').select('id').eq('id', groupId)
  expect(data).toEqual([])
})

test('А6: ученик без оплат удаляется с причиной', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const e = await makeEnrollment(n.student, groupId, '2026-10-01')

  await login(page, KANYKEI)
  await page.goto(`/admin/students/${e.studentId}`)
  await page.getByRole('button', { name: `Действия: ${n.student}` }).click()
  await page.getByRole('button', { name: 'Удалить ученика', exact: true }).click()

  await expect(page.getByTestId('student-delete-impact')).toContainText('0 оплат на 0 сом')
  const form = page.getByRole('form', { name: 'Удалить ученика' })
  await form.getByRole('button', { name: 'Удалить ученика' }).click()
  await expect(form.getByRole('alert')).toHaveText('Укажите причину')
  await form.getByLabel('Причина').fill('e2e: завели дубль')
  await form.getByRole('button', { name: 'Удалить ученика' }).click()
  await expect(page.getByText(`Ученик удалён: ${n.student}`)).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/students$/)

  const { data } = await service().from('students').select('id').eq('id', e.studentId)
  expect(data).toEqual([])
})
