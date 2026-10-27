import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { GULZAT, KANYKEI, login, switchUser } from './support/auth'
import { lockSeed } from './support/seed-lock'
import {
  asAdmin,
  cleanup,
  makeEnrollment,
  makeGroup,
  service,
  teacherId,
} from './support/undo-fixtures'

// #110 (К10): the teacher corrects the marks of own held lesson — no request to the admin.
// Changes Гульзат's October pay while it runs — hold the seed lock.
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r110-${name}-${size(testInfo)}.png` })
}

/**
 * The closed-period test locks one lesson — unlock it, or wipeFixtures hits the wall. Only an admin
 * flips is_locked back (lessons_guard).
 */
async function unlock(groupName: string) {
  const { data: groups } = await service().from('groups').select('id').eq('name', groupName)
  const ids = (groups ?? []).map((g) => g.id)
  if (ids.length === 0) return
  const { error } = await (
    await asAdmin()
  )
    .from('lessons')
    .update({ is_locked: false })
    .in('group_id', ids)
    .eq('is_locked', true)
  if (error) throw error
}

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  return { group: `e2e учитель правит ${w}`, student: `Е2е Учитель Правит ${w}` }
}

async function octoberBase() {
  const { data } = await service()
    .from('v_payroll_preview')
    .select('base_amount')
    .eq('teacher_id', await teacherId('Гульзат%'))
    .eq('month', '2026-10-01')
    .maybeSingle()
  return data?.base_amount ?? 0
}

/** «Мой месяц» shows `expected` сом (digits only — the sum groups thousands). */
async function expectPay(page: Page, expected: number) {
  const sum = page.getByTestId('pay-sum')
  await expect.poll(async () => Number((await sum.innerText()).replace(/\D/g, ''))).toBe(expected)
}

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await unlock(n.group)
  await cleanup([n.group], [n.student])
})
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await unlock(n.group)
  await cleanup([n.group], [n.student])
})

test('учитель: провести → «Мой месяц» → «Исправить отметки» → ЗП пересчитана, в журнале «исправил учитель»', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  // ВТ/ЧТ from Thu 1 Oct: the first lesson is over and not confirmed
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const { studentId } = await makeEnrollment(n.student, groupId, '2026-10-01')
  const { data: first } = await service()
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .eq('lesson_date', '2026-10-01')
    .single()
  const lessonId = first?.id ?? ''
  const month = `/my-month?month=2026-10&group=${groupId}`
  const links = page.locator(`main a[href^="/lessons/${lessonId}"]`)

  await login(page, GULZAT)
  await page.goto(month)

  // provesti: «Подтвердить →» from «Мой месяц»
  await links.filter({ hasText: 'Подтвердить' }).click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=my-month`))
  await page.getByRole('button', { name: 'Все были' }).click()
  await page.getByRole('button', { name: 'Подтвердить занятие' }).click()
  await expect(page).toHaveURL(new RegExp(`/my-month\\?month=2026-10&group=${groupId}`))
  const held = await octoberBase()
  await expectPay(page, held)

  // back to the held lesson through «Мой месяц» (#110: its row opens the card). The desktop table
  // shows the newest 7 lessons — after 19:00 on a lesson day the oldest row is behind «ещё N».
  const more = page.getByRole('button', { name: /^ещё \d+ заняти/ })
  if (await more.isVisible().catch(() => false)) await more.click()
  await links.filter({ hasNotText: 'Подтвердить' }).click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}\\?from=my-month`))
  const row = page.getByRole('listitem', { name: n.student })
  await expect(row.getByRole('button', { name: 'Был', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(row.getByRole('button', { name: 'Заморозка' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Попросить исправить' })).toHaveCount(0)
  await shot(page, 'teacher-held', testInfo)

  await page.getByRole('button', { name: 'Исправить отметки' }).click()
  await row.getByRole('button', { name: 'Заморозка' }).click()
  await expect(page.getByRole('list', { name: 'Изменения' })).toContainText(
    `${n.student}: был → заморозка`,
  )
  // the comment is optional
  const save = page.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(save).toBeEnabled()
  await page.getByLabel('Комментарий (необязательно)').fill('Предупредил заранее')
  await shot(page, 'teacher-correct', testInfo)
  await save.click()

  await expect(page.getByText('Отметки исправлены')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/my-month\\?month=2026-10&group=${groupId}`))
  const { data: mark } = await service()
    .from('attendance')
    .select('status')
    .eq('lesson_id', lessonId)
    .eq('student_id', studentId)
    .single()
  expect(mark?.status).toBe('absent_frozen')
  const fixed = await octoberBase()
  expect(fixed).toBeLessThan(held)
  await expectPay(page, fixed)
  await shot(page, 'my-month', testInfo)

  await switchUser(page, KANYKEI)
  await page.goto('/admin/audit')
  const line = page.getByText(new RegExp(`исправил учитель: ${n.student} Был → Заморозка`)).first()
  await expect(line).toBeVisible()
  await expect(page.getByText('Комментарий: «Предупредил заранее»').first()).toBeVisible()
  await shot(page, 'audit', testInfo)
})

test('учитель: в закрытом периоде «Исправить отметки» нет — «Период закрыт»', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const { studentId } = await makeEnrollment(n.student, groupId, '2026-10-01')
  const db = service()
  const { data: first } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .eq('lesson_date', '2026-10-01')
    .single()
  const lessonId = first?.id ?? ''
  const { error } = await db.rpc('confirm_lesson', {
    p_lesson_id: lessonId,
    p_marks: [{ student_id: studentId, status: 'present' }],
  })
  if (error) throw error
  // lock one lesson only — closing the whole October would touch the seed (service role passes)
  await db.from('lessons').update({ is_locked: true }).eq('id', lessonId)

  await login(page, GULZAT)
  await page.goto(`/lessons/${lessonId}`)
  await expect(page.getByText('Период закрыт — отметки не меняются')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Исправить отметки' })).toHaveCount(0)
})
