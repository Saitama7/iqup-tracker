import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { GULZAT, KANYKEI, login, type Credentials } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { cleanup, makeEnrollment, makeGroup, service, teacherId } from './support/undo-fixtures'

// #84: the admin sets «Заморозка» before the lesson («Предупредил о пропуске»), the teacher sees it
// prefilled and confirms; «Заморозка» is not paid, «Не был» is (Мой месяц).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r84-${name}-${size(testInfo)}.png` })
}

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  return {
    group: `e2e заморозка ${w}`,
    warned: `Е2е Предупредил ${w}`,
    missed: `Е2е Пропустил ${w}`,
  }
}

/** Today in Asia/Bishkek (UTC+6, no DST). */
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10)

async function switchUser(page: Page, user: Credentials) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await login(page, user)
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
  await cleanup([n.group], [n.warned, n.missed])
})
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.warned, n.missed])
})

test('админ: «предупредил» заранее → учитель видит «Заморозку» → проводит; «Не был» в ЗП', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const today = bishkekToday()
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const warned = await makeEnrollment(n.warned, groupId, '2026-10-01')
  const missed = await makeEnrollment(n.missed, groupId, '2026-10-01')
  const { data: next } = await service()
    .from('lessons')
    .select('id, lesson_date')
    .eq('group_id', groupId)
    .gt('lesson_date', today)
    .order('lesson_date')
    .limit(1)
    .single()
  const lessonId = next?.id ?? ''

  // ── Admin: student card → «+ Заморозка заранее» on the next lesson ──
  await login(page, KANYKEI)
  await page.goto(`/admin/students/${warned.studentId}`)
  const section = page.getByRole('region', { name: 'Предупредил о пропуске' })
  await section.getByRole('button', { name: '+ Заморозка заранее' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Предупредил о пропуске' })).toBeVisible()
  await dialog.getByLabel('Комментарий').fill('Мама написала: заболел')
  await shot(page, 'student-dialog', testInfo)
  await dialog.getByRole('button', { name: 'Поставить заморозку' }).click()
  await expect(page.getByText(`Заморозка заранее: ${n.warned}`)).toBeVisible()
  await expect(section.getByText(/^Заморозка · /)).toBeVisible()
  await expect(section.getByText('Мама написала: заболел')).toBeVisible()
  await shot(page, 'student-card', testInfo)

  // ── Admin: the planned lesson's card shows it, with «Снять заморозку» ──
  await page.goto(`/lessons/${lessonId}`)
  const warnedRow = page.getByRole('listitem', { name: n.warned })
  await expect(warnedRow.getByText('Админ: предупредил · Мама написала: заболел')).toBeVisible()
  await expect(warnedRow.getByRole('button', { name: 'Заморозка' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(warnedRow.getByRole('button', { name: 'Снять заморозку' })).toBeVisible()
  await expect(
    page.getByRole('listitem', { name: n.missed }).getByRole('button', {
      name: 'Предупредил о пропуске',
    }),
  ).toBeVisible()
  await shot(page, 'admin-lesson', testInfo)

  // ── The day comes: the lesson is moved to today, already started ──
  const { error } = await service()
    .from('lessons')
    .update({ lesson_date: today, planned_start: '00:00' })
    .eq('id', lessonId)
  expect(error).toBeNull()

  // ── Teacher: «Заморозка» is prefilled, marks the other one «Не был», confirms ──
  await switchUser(page, GULZAT)
  await page.goto(`/lessons/${lessonId}`)
  const tWarned = page.getByRole('listitem', { name: n.warned })
  const tMissed = page.getByRole('listitem', { name: n.missed })
  await expect(tWarned.getByRole('button', { name: 'Заморозка' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(tWarned.getByText('Админ: предупредил · Мама написала: заболел')).toBeVisible()
  await expect(tWarned.getByRole('button', { name: 'Снять заморозку' })).toHaveCount(0)
  await tMissed.getByRole('button', { name: 'Не был' }).click()
  await shot(page, 'teacher-lesson', testInfo)
  await page.getByRole('button', { name: /Провести занятие|Подтвердить занятие/ }).click()
  await expect(page).not.toHaveURL(new RegExp(`/lessons/${lessonId}`))

  expect(await markOf(lessonId, warned.studentId)).toBe('absent_frozen')
  expect(await markOf(lessonId, missed.studentId)).toBe('absent_burned')

  // ── Мой месяц: «Заморозка 1 · Не был 1 → в ЗП 1» ──
  await page.goto(`/my-month?month=${today.slice(0, 7)}&group=${groupId}`)
  await expect(page.getByText('Заморозка 1 · Не был 1 → в ЗП 1').first()).toBeVisible()
  await expect(page.getByText(/«Заморозка» в ЗП не идёт/)).toBeVisible()
  await shot(page, 'my-month', testInfo)
})
