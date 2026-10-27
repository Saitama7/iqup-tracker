import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { GULZAT, KANYKEI, login, switchUser } from './support/auth'
import { lockSeed } from './support/seed-lock'
import {
  cleanup,
  holdLessons,
  makeEnrollment,
  makeGroup,
  service,
  teacherId,
} from './support/undo-fixtures'

// #107 · Айзат on prod: enrolled retroactively (И45) after the lessons were held — the held lessons
// between the dates show her «Не отмечен»; the admin adds «Был» with «Исправить отметки», the
// teacher's «Мой месяц» grows by her lesson. Own group of Гульзат from 1 October (the seed's
// September is never touched). Needs the local stack + `pnpm seed:users`.

// Held October lessons of a new group change Гульзат's month while the spec runs (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r107-${name}-${size(testInfo)}.png` })
}

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  return {
    group: `e2e неотмеченный ${w}`,
    marked: `Е2е Отмеченный ${w}`,
    late: `Е2е Задним числом ${w}`,
  }
}

const REASON = 'Зачислили задним числом'

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

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.marked, n.late])
})
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.marked, n.late])
})

test('зачислен задним числом: «Не отмечен» на проведённом занятии → «Был» → начислено учителю', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  // ВТ/ЧТ from Thu 1 Oct: 1.10 and 6.10 held with one pupil, the other enrolled from 15.10
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const marked = await makeEnrollment(n.marked, groupId, '2026-10-01')
  const late = await makeEnrollment(n.late, groupId, '2026-10-15')
  await holdLessons(groupId, marked.studentId, 2, 'present')
  const { data: held } = await service()
    .from('lessons')
    .select('id, lesson_date')
    .eq('group_id', groupId)
    .eq('status', 'held')
    .order('lesson_date')
  const first = held?.at(0)
  const second = held?.at(1)
  expect([first?.lesson_date, second?.lesson_date]).toEqual(['2026-10-01', '2026-10-06'])
  const lessonId = second?.id ?? ''
  const before = await octoberBase()
  const lessonPay = async () => {
    const { data } = await service().rpc('lesson_payroll_impact', { p_lesson_id: lessonId })
    return data?.[0]?.amount ?? 0
  }
  const onePupil = await lessonPay()
  expect(onePupil).toBeGreaterThan(0)

  // А6: the admin moves the enrollment back to 1 October
  await login(page, KANYKEI)
  await page.goto(`/admin/students/${late.studentId}`)
  await page
    .getByRole('button', { name: `Изменить дату зачисления: Математика · ${n.group}` })
    .click()
  const dialog = page.getByRole('form', { name: 'Дата зачисления' })
  const date = dialog.getByLabel('Зачислен с')
  await date.fill('')
  await date.pressSequentially('01102026')
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('зачислен 1 октября', { exact: false }).first()).toBeVisible()

  // the held lesson of 6.10: she is there, «Не отмечен», out of the counts
  await page.goto(`/lessons/${lessonId}`)
  const row = page.getByRole('listitem', { name: n.late })
  await expect(row.getByText('Не отмечен', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('listitem', { name: n.marked }).getByText('Не отмечен', { exact: true }),
  ).toHaveCount(0)
  for (const k of ['Был', 'Заморозка', 'Не был']) {
    await expect(row.getByRole('button', { name: k, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  }
  await shot(page, 'lesson-unmarked', testInfo)

  // «Исправить отметки»: nothing chosen for her by default; «Был» → «— → был»
  await page.getByRole('button', { name: 'Исправить отметки' }).click()
  await expect(page.getByText('Измените отметки в списке учеников')).toBeVisible()
  await row.getByRole('button', { name: 'Был', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Изменения' })).toHaveText(`${n.late}: — → был`)
  await page.getByLabel('Причина исправления').fill(REASON)
  await shot(page, 'lesson-correct', testInfo)
  await page.getByRole('button', { name: 'Сохранить исправление' }).click()
  await expect(page.getByText('Отметки исправлены')).toBeVisible()
  await expect(row.getByText('Не отмечен', { exact: true })).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Был', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // the mark is charged where the database puts it (attendance_subscription)
  const { data: mark } = await service()
    .from('attendance')
    .select('status, subscription_id')
    .eq('lesson_id', lessonId)
    .eq('student_id', late.studentId)
    .single()
  expect(mark).toEqual({ status: 'present', subscription_id: late.subscriptionId })
  // the untouched lesson of 1.10 still has no mark of her
  const { count } = await service()
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('lesson_id', first?.id ?? '')
    .eq('student_id', late.studentId)
  expect(count).toBe(0)

  // the teacher: paid for her on 6.10; on 1.10 she is «Не отмечен» too (#110)
  await switchUser(page, GULZAT)
  // the same tariff: her mark pays as much as his (whole som — rounding of 142,5 × 2 aside)
  const added = (await lessonPay()) - onePupil
  expect(Math.abs(added - onePupil)).toBeLessThanOrEqual(1)
  const after = await octoberBase()
  expect(Math.abs(after - before - added)).toBeLessThanOrEqual(1)
  await expectOctoberPay(page, after)
  await shot(page, 'my-month', testInfo)
  await page.goto(`/lessons/${first?.id ?? ''}`)
  await expect(
    page.getByRole('listitem', { name: n.late }).getByText('Не отмечен', { exact: true }),
  ).toBeVisible()
})
