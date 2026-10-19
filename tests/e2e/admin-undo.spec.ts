import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { GULZAT, KANYKEI, login, type Credentials } from './support/auth'
import { lockSeed } from './support/seed-lock'
import {
  cleanup,
  holdLessons,
  makeEnrollment,
  makeGroup,
  service,
  teacherId,
} from './support/undo-fixtures'

// #73 · admin undo: remove a mistaken enrollment, transfer one with a payment, change a group's
// teacher from a date (the old teacher's lessons leave «Мой месяц», the new one's appear), delete an
// empty group, refusals for marks. Needs the local stack + `pnpm seed:users`.
// Every project works on its own groups and pupils (names carry the viewport width).

// September lessons of new groups change the months other specs count (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
// the dialog fades in: wait for the animation, or the screenshot is half transparent
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r73-${name}-${size(testInfo)}.png` })
}
const label = (name: string) => `Математика · ${name}`

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  const group = (k: string) => `e2e откат ${k} ${w}`
  const student = (k: string) => `Е2е ${k} ${w}`
  return {
    groups: [group('A'), group('B'), group('C'), group('D'), `${group('D')} пустая`],
    students: [student('Откат'), student('Перевод'), student('Учитель'), student('Отметка')],
    group: {
      a: group('A'),
      b: group('B'),
      c: group('C'),
      d: group('D'),
      empty: `${group('D')} пустая`,
    },
    student: {
      a: student('Откат'),
      b: student('Перевод'),
      c: student('Учитель'),
      d: student('Отметка'),
    },
  }
}

async function switchUser(page: Page, user: Credentials) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await login(page, user)
}

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup(n.groups, n.students)
})
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup(n.groups, n.students)
})

test('убрать ошибочное зачисление: перечень, удаление, журнал', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const groupName = n.group.a
  const studentName = n.student.a
  const groupId = await makeGroup(groupName, await teacherId('Бекзат%'))
  const e = await makeEnrollment(studentName, groupId, '2026-09-01')
  await holdLessons(groupId, e.studentId, 1, 'absent_frozen')

  await login(page, KANYKEI)
  await page.goto(`/admin/students/${e.studentId}`)
  // #81: «Убрать из группы» is now «⋯» → «Записан по ошибке — удалить»
  await page.getByRole('button', { name: `Действия: ${label(groupName)}` }).click()
  await page.getByRole('button', { name: 'Записан по ошибке — удалить' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Зачисление и абонемент')).toBeVisible()
  await expect(dialog.getByText('Отметки: «заморожен» — 1')).toBeVisible()
  await shot(page, 'remove', testInfo)
  await dialog.getByRole('button', { name: 'Удалить зачисление' }).click()
  await expect(dialog).toBeHidden()

  const db = service()
  const { count } = await db
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('id', e.enrollmentId)
  expect(count).toBe(0)

  await page.goto('/admin/audit')
  await expect(
    page.getByText(`зачисление в ${label(groupName)} удалено (ошибочное)`).first(),
  ).toBeVisible()
})

test('перевод зачисления с оплатой в другую группу', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const { b: from, c: to } = n.group
  const studentName = n.student.b
  const teacher = await teacherId('Бекзат%')
  const fromId = await makeGroup(from, teacher)
  const toId = await makeGroup(to, teacher)
  const e = await makeEnrollment(studentName, fromId, '2026-09-01', 1000)

  await login(page, KANYKEI)
  await page.goto(`/admin/groups/${fromId}`)
  // #81: same type, nothing written off — «Перевести» moves the enrollment whole (#73)
  await page.getByRole('button', { name: `Действия: ${studentName}` }).click()
  await page.getByRole('button', { name: 'Перевести в другую группу' }).click()
  const dialog = page.getByRole('dialog')
  const form = dialog.getByRole('form', { name: 'Перевести в другую группу' })
  await form.getByLabel('Новая группа').selectOption({ label: `${label(to)} · Мини-группа` })
  await expect(form.getByLabel('С какого дня в новой группе')).toHaveValue('01.09.2026')
  await expect(form.getByText(/зачисление переедет целиком вместе с абонементом/)).toBeVisible()
  await form.getByRole('button', { name: 'Перевести' }).click()
  await expect(dialog).toBeHidden()

  const db = service()
  const { data: moved } = await db
    .from('enrollments')
    .select('group_id')
    .eq('id', e.enrollmentId)
    .single()
  expect(moved?.group_id).toBe(toId)
  const { data: payments } = await db
    .from('payments')
    .select('amount')
    .eq('subscription_id', e.subscriptionId)
  expect(payments?.map((p) => p.amount)).toEqual([1000])

  await page.goto('/admin/audit')
  await expect(
    page.getByText(`переведён(а) из ${label(from)} в ${label(to)}`).first(),
  ).toBeVisible()
})

test('смена учителя с даты: занятия уходят из «Моего месяца» старого и появляются у нового', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const groupName = n.group.c
  const studentName = n.student.c
  const gulzat = await teacherId('Гульзат%')
  const kanykei = await teacherId('Каныкей%')
  const groupId = await makeGroup(groupName, gulzat)
  const e = await makeEnrollment(studentName, groupId, '2026-09-01')
  await holdLessons(groupId, e.studentId, 2, 'present')
  const db = service()
  const teachersOf = async () => {
    const { data } = await db.from('lessons').select('teacher_id').eq('group_id', groupId)
    return new Set((data ?? []).map((l) => l.teacher_id))
  }

  await login(page, GULZAT)
  await page.goto('/my-month?month=2026-09')
  await expect(page.getByText(groupName).first()).toBeVisible()

  await switchUser(page, KANYKEI)
  await page.goto(`/admin/groups/${groupId}`)
  await page.getByRole('button', { name: 'Изменить' }).click()
  const edit = page.getByRole('form', { name: 'Изменить группу' })
  await edit.getByLabel('Учитель группы').selectOption({ label: 'Каныкей' })
  await expect(edit.getByLabel('С какой даты')).toHaveValue('01.09.2026')
  await expect(
    edit.getByText(/занятий \(из них 2 проведено\) перейдут к Каныкей; ЗП пересчитается/),
  ).toBeVisible()
  await shot(page, 'teacher-preview', testInfo)
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(edit).toBeHidden()
  expect(await teachersOf()).toEqual(new Set([kanykei]))

  await switchUser(page, GULZAT)
  await page.goto('/my-month?month=2026-09')
  await expect(page.getByRole('heading', { name: /Сентябрь/ }).first()).toBeVisible()
  await expect(page.getByText(groupName)).toHaveCount(0)

  await switchUser(page, KANYKEI)
  await page.goto('/my-month?month=2026-09')
  await expect(page.getByText(groupName).first()).toBeVisible()

  await page.goto('/admin/audit')
  await expect(
    page
      .getByText(`учитель группы ${label(groupName)} сменён с Гульзат Асанова на Каныкей с 01.09`)
      .first(),
  ).toBeVisible()
})

test('удалить пустую группу и группу с отметками без оплат (#94)', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const groupName = n.group.d
  const studentName = n.student.d
  const teacher = await teacherId('Бекзат%')
  const empty = await makeGroup(n.group.empty, teacher, '2026-10-20')
  const marked = await makeGroup(groupName, teacher)
  const e = await makeEnrollment(studentName, marked, '2026-09-01')
  await holdLessons(marked, e.studentId, 1, 'present')

  await login(page, KANYKEI)
  // И84 (#94): marks and enrollments no longer block — the dialog shows the payroll taken back
  await page.goto(`/admin/groups/${marked}`)
  await page.getByRole('button', { name: 'Изменить' }).click()
  await page.getByRole('button', { name: 'Удалить группу' }).click()
  const impact = page.getByTestId('group-delete-impact')
  await expect(impact).toContainText('(1 проведённых)')
  await expect(impact).toContainText(/учителю Бекзат −.+ сом/)
  await shot(page, 'delete-refusal', testInfo)
  await page.getByRole('button', { name: 'Не сейчас' }).click()
  await expect(impact).toBeHidden()

  // «был» no longer blocks «Записан по ошибке» (#81): the dialog shows the payroll it takes back
  await page.getByRole('button', { name: `Действия: ${studentName}` }).click()
  await page.getByRole('button', { name: 'Записан по ошибке — удалить' }).click()
  const mistake = page.getByRole('dialog')
  await expect(mistake.getByText(/ЗП уменьшится: учителю Бекзат −.+ сом за 1 урок/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(mistake).toBeHidden()

  // an empty group goes with its schedule and lessons
  await page.goto(`/admin/groups/${empty}`)
  await page.getByRole('button', { name: 'Изменить' }).click()
  await page.getByRole('button', { name: 'Удалить группу' }).click()
  const confirm = page.getByRole('dialog')
  await expect(
    confirm.getByRole('heading', { name: `Удалить группу «${n.group.empty}»?` }),
  ).toBeVisible()
  await expect(confirm.getByTestId('group-delete-impact')).toContainText(/^Удалится: \d+ занятий/)
  await shot(page, 'delete-confirm', testInfo)
  await confirm.getByLabel('Причина').fill('e2e: создали по ошибке')
  await confirm.getByRole('button', { name: 'Удалить группу' }).click()
  await expect(page).toHaveURL(/\/admin\/groups$/)

  const db = service()
  const { count } = await db
    .from('groups')
    .select('id', { count: 'exact', head: true })
    .eq('id', empty)
  expect(count).toBe(0)
  await page.goto('/admin/audit')
  await expect(page.getByText(`группа ${n.group.empty} удалена`).first()).toBeVisible()
})
