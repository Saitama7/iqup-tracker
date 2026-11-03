import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import {
  asAdmin,
  cleanup,
  holdLessons,
  makeEnrollment,
  makeGroup,
  service,
  teacherId,
} from './support/undo-fixtures'

// #122 · «Изменить оплату»: Гусев Артём's case — the old package owes, both payments sit on the new
// one. The «Абонемент» options are signed by state, a hint offers the owing package, the move clears
// the debt on the student card. Needs the local stack + `pnpm seed:users`.

// September lessons of a new group change the months other specs count (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })
test.slow()
const expect = baseExpect.configure({ timeout: 15_000 })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const names = (testInfo: TestInfo) => ({
  group: `e2e перенос оплаты ${size(testInfo)}`,
  student: `Е2е Гусев ${size(testInfo)}`,
})
const nb = (t: string) => t.replace(/ /g, ' ')
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

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

test('А7: «Изменить оплату» подписывает абонементы по состоянию и подсказывает перенос на должный (#122)', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const teacher = await teacherId('Бекзат%')
  const group = await makeGroup(n.group, teacher, '2026-09-01', 'group')
  // old package 01.09 · 12 ур · 3 200: four lessons held, nothing paid → долг 4 ур. · 1 067
  const e = await makeEnrollment(n.student, group, '2026-09-01', 0, 'group')
  await holdLessons(group, e.studentId, 4, 'present')
  const admin = await asAdmin()
  const bought = await admin.rpc('buy_subscription', {
    p_enrollment_id: e.enrollmentId,
    p_amount: 3200,
    p_method: 'cash',
  })
  if (bought.error) throw bought.error
  const db = service()
  const { data: fresh } = await db
    .from('subscriptions')
    .select('id, started_at')
    .eq('enrollment_id', e.enrollmentId)
    .neq('id', e.subscriptionId)
    .single()
  if (!fresh) throw new Error('no new subscription')
  const second = await admin.rpc('record_payment', {
    p_subscription_id: fresh.id,
    p_amount: 3200,
    p_method: 'cash',
  })
  if (second.error) throw second.error
  const debtOf = async () => {
    const { data } = await db
      .from('v_student_balance')
      .select('debt_som')
      .eq('subscription_id', e.subscriptionId)
      .single()
    return data?.debt_som
  }
  expect(await debtOf()).toBe(1067)

  await login(page, KANYKEI)
  await page.goto(`/admin/students/${e.studentId}`)
  // phone: the dark tile «−4 уроков в долг»; desktop: «Долг · долг 4 ур. · 1 067 сом»
  const debtOnCard = () =>
    isDesktop(page) ? page.getByText(/долг 4 ур\./) : page.getByText('уроков в долг')
  await expect(debtOnCard().first()).toBeVisible()

  await page.goto('/admin/payments?tab=journal')
  const journal = isDesktop(page)
    ? page.getByRole('table', { name: 'Журнал оплат' })
    : page.getByRole('list', { name: 'Журнал оплат' })
  const rows = journal.locator(isDesktop(page) ? 'tbody tr' : 'li').filter({ hasText: n.student })
  await expect(rows).toHaveCount(2)
  if (isDesktop(page)) {
    await rows
      .first()
      .getByRole('button', { name: /^Действия:/ })
      .click()
    await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  } else {
    await rows.first().getByRole('button').click()
    await page
      .getByRole('dialog', { name: 'Оплата' })
      .getByRole('button', { name: 'Изменить' })
      .click()
  }

  const edit = page.getByRole('form', { name: 'Изменить оплату' })
  const abon = edit.getByLabel('Абонемент')
  await expect(abon.locator('option')).toHaveText([
    nb('абонемент с 01.09 · 12 ур · 3 200 · долг 1 067'),
    nb(`абонемент с ${dm(fresh.started_at)} · 12 ур · 3 200 · оплачен (сейчас)`),
  ])
  const hint = edit.getByTestId('move-hint')
  await expect(hint).toContainText(
    nb('Абонемент с 01.09 не оплачен (долг 4 ур. · 1 067). Перенести эту оплату на него?'),
  )
  await edit.getByLabel('Причина исправления').fill('оплата за старый абонемент')
  await page.waitForTimeout(600) // the dialog fades in — for the screenshot only
  await page.screenshot({ path: `docs/screenshots/r122-payment-move-hint-${size(testInfo)}.png` })

  await hint.getByRole('button', { name: 'Перенести на абонемент с 01.09' }).click()
  await expect(abon).toHaveValue(e.subscriptionId)
  await expect(hint).toBeHidden()
  await expect(edit.getByTestId('move-impact')).toHaveText(
    nb(
      `Оплата перейдёт на абонемент с 01.09 — он будет оплачен; абонемент с ${dm(fresh.started_at)} останется оплачен`,
    ),
  )
  await page.screenshot({ path: `docs/screenshots/r122-payment-move-impact-${size(testInfo)}.png` })
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Оплата изменена')).toBeVisible()
  await expect.poll(debtOf).toBe(0)

  await page.goto(`/admin/students/${e.studentId}`)
  await expect(page.getByRole('heading', { name: n.student })).toBeVisible()
  await expect(debtOnCard()).toHaveCount(0)
})
