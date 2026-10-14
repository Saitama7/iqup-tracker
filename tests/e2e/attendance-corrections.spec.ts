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

// #74 · Исправление отметок проведённого занятия: the admin corrects «был → не был» with a reason;
// a teacher asks to correct, the admin applies, the teacher sees «Исправлено». Own group of Гульзат
// from 1 October (the seed's September is never touched). Needs the local stack + `pnpm seed:users`.

// Held October lessons of a new group change Гульзат's month while the spec runs (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r74-${name}-${size(testInfo)}.png` })
}

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  return { group: `e2e исправление ${w}`, student: `Е2е Исправление ${w}` }
}

async function switchUser(page: Page, user: Credentials) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await login(page, user)
}

/** Group of Гульзат from 1 Oct with one pupil, the first lesson held with «Был». */
async function heldLesson(testInfo: TestInfo) {
  const n = names(testInfo)
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const e = await makeEnrollment(n.student, groupId, '2026-10-01')
  await holdLessons(groupId, e.studentId, 1, 'present')
  const { data } = await service()
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'held')
    .single()
  return { groupId, studentId: e.studentId, lessonId: data?.id ?? '' }
}

async function markOf(lessonId: string, studentId: string) {
  const { data } = await service()
    .from('attendance')
    .select('status')
    .eq('lesson_id', lessonId)
    .eq('student_id', studentId)
    .single()
  return data?.status
}

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.student])
})
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.student])
})

test('админ исправляет «был → не был» с причиной из страницы группы', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const { groupId, studentId, lessonId } = await heldLesson(testInfo)

  await login(page, KANYKEI)
  await page.goto(`/admin/groups/${groupId}`)
  await page.getByRole('tab', { name: 'Занятия' }).click()
  await page.getByRole('link', { name: /^Отметки: / }).click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}`))

  const row = page.getByRole('listitem', { name: n.student })
  await expect(row.getByRole('button', { name: 'Был', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(row.getByRole('button', { name: 'Не был' })).toBeDisabled()

  await page.getByRole('button', { name: 'Исправить отметки' }).click()
  await row.getByRole('button', { name: 'Не был' }).click()
  await expect(page.getByRole('list', { name: 'Изменения' })).toContainText(
    `${n.student}: был → не был`,
  )
  const save = page.getByRole('button', { name: 'Сохранить исправление' })
  await expect(save).toBeDisabled()
  await page.getByLabel('Причина исправления').fill('Перепутали — ученика не было')
  await shot(page, 'admin-correct', testInfo)
  await save.click()

  await expect(page.getByText('Отметки исправлены')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Не был' })).toHaveAttribute('aria-pressed', 'true')
  expect(await markOf(lessonId, studentId)).toBe('absent_burned')

  const { data: journal } = await service()
    .from('audit_log')
    .select('reason, kind')
    .eq('entity', 'attendance')
    .eq('entity_id', (await attendanceId(lessonId, studentId)) ?? '')
    .eq('reason', 'Перепутали — ученика не было')
  expect(journal).toEqual([{ reason: 'Перепутали — ученика не было', kind: 'retro' }])

  await page.goto('/admin/audit')
  await expect(
    page.getByText(new RegExp(`Отметки занятия .*исправлены: ${n.student}`)).first(),
  ).toBeVisible()
})

async function attendanceId(lessonId: string, studentId: string) {
  const { data } = await service()
    .from('attendance')
    .select('id')
    .eq('lesson_id', lessonId)
    .eq('student_id', studentId)
    .single()
  return data?.id
}

test('учитель просит исправить → админ применяет → учитель видит «Исправлено»', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const { studentId, lessonId } = await heldLesson(testInfo)

  await login(page, GULZAT)
  await page.goto(`/lessons/${lessonId}`)
  const row = page.getByRole('listitem', { name: n.student })
  await page.getByRole('button', { name: 'Попросить исправить' }).click()
  await row.getByRole('button', { name: 'Не был' }).click()
  await page
    .getByLabel('Что не так — комментарий администратору')
    .fill('Ученика не было, отметила по ошибке')
  await shot(page, 'teacher-request', testInfo)
  await page.getByRole('button', { name: 'Отправить запрос' }).click()
  await expect(page.getByText('Запрос отправлен администратору')).toBeVisible()
  await expect(page.getByTestId('correction-status')).toHaveText(
    'Запрос на исправление: Ждёт решения администратора',
  )
  await expect(page.getByRole('button', { name: 'Попросить исправить' })).toHaveCount(0)
  // nothing changed yet
  expect(await markOf(lessonId, studentId)).toBe('present')

  await switchUser(page, KANYKEI)
  await page.goto('/admin')
  const item = page
    .getByRole('link', { name: new RegExp(`Гульзат просит исправить отметки: .*${n.group}`) })
    .or(
      page
        .getByRole('listitem')
        .filter({ hasText: new RegExp(`Гульзат просит исправить отметки: .*${n.group}`) })
        .getByRole('link', { name: 'Открыть' }),
    )
  await expect(item).toBeVisible()
  await expect(page.getByLabel(/^запросов на исправление: \d+$/).first()).toBeVisible()
  await shot(page, 'admin-dashboard', testInfo)
  await item.click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}`))

  const review = page.getByRole('region', { name: 'Запрос учителя' })
  await expect(review).toContainText(`${n.student}: был → не был`)
  await expect(review).toContainText('Ученика не было, отметила по ошибке')
  await shot(page, 'admin-review', testInfo)
  await review.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('Запрос применён — отметки исправлены')).toBeVisible()
  await expect(review).toHaveCount(0)
  expect(await markOf(lessonId, studentId)).toBe('absent_burned')

  await switchUser(page, GULZAT)
  await page.goto(`/lessons/${lessonId}`)
  await expect(page.getByTestId('correction-status')).toHaveText(
    'Запрос на исправление: Исправлено',
  )
  await expect(
    page.getByRole('listitem', { name: n.student }).getByRole('button', { name: 'Не был' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'teacher-fixed', testInfo)
})
