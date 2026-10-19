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

// #95 · «Отменить проведение»: the admin returns a held lesson to planned with a reason — the dialog
// shows the teacher's payroll drop, the teacher's «Мой месяц» goes down by it, А10 has the line with
// the reason; the teacher has no such button. Own group of Гульзат from 1 October (the seed's
// September is never touched). Needs the local stack + `pnpm seed:users`.

// A held October lesson of a new group changes Гульзат's month while the spec runs (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r95-${name}-${size(testInfo)}.png` })
}

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  return { group: `e2e отмена проведения ${w}`, student: `Е2е Отмена ${w}` }
}

const REASON = 'Провели не ту дату'

async function switchUser(page: Page, user: Credentials) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await login(page, user)
}

/** Гульзат's October payroll (v_payroll_preview). */
async function octoberBase() {
  const { data } = await service()
    .from('v_payroll_preview')
    .select('base_amount')
    .eq('teacher_id', await teacherId('Гульзат%'))
    .eq('month', '2026-10-01')
    .maybeSingle()
  return data?.base_amount ?? 0
}

/** «Мой месяц» → октябрь shows `expected` сом (digits only — the sum groups thousands). */
async function expectOctoberPay(page: Page, expected: number) {
  await page.goto('/my-month?month=2026-10')
  const sum = page.getByTestId('pay-sum')
  await expect.poll(async () => Number((await sum.innerText()).replace(/\D/g, ''))).toBe(expected)
}

async function lessonStatus(lessonId: string) {
  const { data } = await service()
    .from('lessons')
    .select('status, confirmed_at')
    .eq('id', lessonId)
    .single()
  return data
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

test('админ отменяет проведение: −X сом, «Мой месяц» уменьшился, строка в журнале; у учителя кнопки нет', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const e = await makeEnrollment(n.student, groupId, '2026-10-01')
  await holdLessons(groupId, e.studentId, 1, 'present')
  const { data: held } = await service()
    .from('lessons')
    .select('id, lesson_date')
    .eq('group_id', groupId)
    .eq('status', 'held')
    .single()
  const lessonId = held?.id ?? ''
  const { data: impact } = await service().rpc('lesson_payroll_impact', { p_lesson_id: lessonId })
  const amount = impact?.[0]?.amount ?? 0
  expect(amount).toBeGreaterThan(0)

  // the teacher: «Попросить исправить», no «Отменить проведение»
  await login(page, GULZAT)
  const before = await octoberBase()
  expect(before).toBeGreaterThanOrEqual(amount)
  await expectOctoberPay(page, before)
  await page.goto(`/lessons/${lessonId}`)
  await expect(page.getByRole('button', { name: 'Попросить исправить' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отменить проведение' })).toHaveCount(0)

  await switchUser(page, KANYKEI)
  await page.goto(`/admin/groups/${groupId}`)
  await page.getByRole('tab', { name: 'Занятия' }).click()
  await page.getByRole('link', { name: /^Отметки: / }).click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}`))
  await expect(page.getByRole('button', { name: 'Исправить отметки' })).toBeVisible()
  await shot(page, 'lesson-held', testInfo)

  await page.getByRole('button', { name: 'Отменить проведение' }).click()
  const dialog = page.getByRole('dialog', { name: 'Отменить проведение?' })
  await expect(dialog.getByTestId('unconfirm-impact')).toHaveText(
    new RegExp(
      `^Отметки 1 ученика будут удалены: учителю Гульзат −${amount.toLocaleString('ru-RU').replace(/\s/g, '\\s')} сом за октябрь$`,
    ),
  )
  const submit = dialog.getByRole('button', { name: 'Отменить проведение' })
  await submit.click()
  await expect(dialog.getByText('Укажите причину')).toBeVisible()
  await dialog.getByLabel('Причина').fill(REASON)
  await shot(page, 'dialog', testInfo)
  await submit.click()

  const day = (held?.lesson_date ?? '').slice(5).split('-').reverse().join('.')
  await expect(page.getByText(`Проведение отменено: ${n.group} · ${day}`)).toBeVisible()
  // И64: back to the group on «Занятия», where the sheet was opened from
  await expect(page).toHaveURL(new RegExp(`/admin/groups/${groupId}\\?tab=lessons$`))
  await expect(page.getByRole('link', { name: /^Отметки: / })).toHaveCount(0)
  expect(await lessonStatus(lessonId)).toEqual({ status: 'planned', confirmed_at: null })
  const { count } = await service()
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('lesson_id', lessonId)
  expect(count).toBe(0)

  await page.goto('/admin/audit')
  const line = page
    .getByRole('article')
    .filter({ hasText: new RegExp(`Проведение отменено: .*${n.group}`) })
    .first()
  await expect(line).toContainText('1 отметка удалена (учителю Гульзат')
  await expect(line).toContainText(`Причина: «${REASON}»`)
  await line.scrollIntoViewIfNeeded()
  await shot(page, 'audit', testInfo)

  // the teacher's month went down by the preview
  await switchUser(page, GULZAT)
  expect(await octoberBase()).toBe(before - amount)
  await expectOctoberPay(page, before - amount)
  await shot(page, 'my-month', testInfo)
})
