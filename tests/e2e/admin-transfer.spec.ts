import { expect, test, type Page, type TestInfo } from '@playwright/test'
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

// #81 · «⋯» of an enrollment: Hadija moves from an individual group to a mini group with the rest of
// her money, a pupil leaves with a refund, a mistaken enrollment with «был» is deleted and the
// teacher's payroll goes down. Needs the local stack + `pnpm seed:users`.
// Every project works on its own groups and pupils (names carry the viewport width).

// September lessons of new groups change the months other specs count (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })
// nine lessons are held through the RPC before the page opens
test.slow()

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
// the dialog fades in: wait for the animation, or the screenshot is half transparent
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r81-${name}-${size(testInfo)}.png` })
}
const label = (name: string) => `Математика · ${name}`
// formatSom puts a non-breaking space between thousands
const som = (n: string) => new RegExp(n.replace(/ /g, '\\s'))

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  const group = (k: string) => `e2e перевод ${k} ${w}`
  const student = (k: string) => `Е2е ${k} ${w}`
  return {
    groups: [group('инд'), group('мини'), group('груп')],
    students: [student('Хадижа'), student('Ушёл'), student('Ошибка')],
    group: { ind: group('инд'), mini: group('мини'), grp: group('груп') },
    student: { hadija: student('Хадижа'), left: student('Ушёл'), mistake: student('Ошибка') },
  }
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

async function openAction(page: Page, who: string, action: string) {
  await page.getByRole('button', { name: `Действия: ${who}` }).click()
  await page.getByRole('button', { name: action }).click()
  return page.getByRole('dialog')
}

test('Хадижа: из индивидуальной в мини-группу, остаток 1 800 вычитается из цены', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const teacher = await teacherId('Бекзат%')
  const ind = await makeGroup(n.group.ind, teacher, '2026-09-01', 'individual')
  const mini = await makeGroup(n.group.mini, teacher, '2026-09-01', 'mini')
  const e = await makeEnrollment(n.student.hadija, ind, '2026-09-01', 7200, 'individual')
  await holdLessons(ind, e.studentId, 9, 'present')

  await login(page, KANYKEI)
  await page.goto(`/admin/students/${e.studentId}`)
  await page.getByRole('button', { name: `Действия: ${label(n.group.ind)}` }).click()
  await expect(page.getByRole('button', { name: 'Ушёл из группы' })).toBeVisible()
  await shot(page, 'menu', testInfo)
  await page.getByRole('button', { name: 'Перевести в другую группу' }).click()
  const dialog = page.getByRole('dialog')
  const form = dialog.getByRole('form', { name: 'Перевести в другую группу' })
  await form
    .getByLabel('Новая группа')
    .selectOption({ label: `${label(n.group.mini)} · Мини-группа` })
  await expect(form.getByText(som('7 200 сом'))).toBeVisible()
  await expect(form.getByText(som('9 уроков × 600 = 5 400 сом'))).toBeVisible()
  await expect(form.getByText(som('1 800 сом')).first()).toBeVisible()
  await expect(form.getByText(som('3 800 − 1 800 = 2 000 сом'))).toBeVisible()
  await shot(page, 'transfer', testInfo)
  await form.getByRole('button', { name: 'Перевести' }).click()
  await expect(dialog).toBeHidden()

  const db = service()
  const { data: old } = await db
    .from('enrollments')
    .select('status, end_date')
    .eq('id', e.enrollmentId)
    .single()
  expect(old?.status).toBe('finished')
  const { data: balance } = await db
    .from('v_student_balance')
    .select('paid_som, price_final')
    .eq('student_id', e.studentId)
    .eq('group_id', mini)
    .single()
  expect(balance).toEqual({ paid_som: 1800, price_final: 3800 })
  const { data: transfers } = await db
    .from('payments')
    .select('amount')
    .eq('kind', 'transfer')
    .in('subscription_id', [e.subscriptionId])
  expect(transfers?.map((p) => p.amount)).toEqual([-1800])

  // the card shows the new group, the payments list both transfer rows
  await page.goto(`/admin/students/${e.studentId}`)
  const payments = page.getByRole('region', { name: 'Платежи' })
  await expect(payments.getByText(`перенос в ${label(n.group.mini)}`)).toBeVisible()
  await expect(payments.getByText(`перенос из ${label(n.group.ind)}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: new RegExp(n.group.mini) }).first()).toBeVisible()
})

test('«Ушёл из группы» с возвратом части остатка, разница — явно центру', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const teacher = await teacherId('Бекзат%')
  const grp = await makeGroup(n.group.grp, teacher, '2026-09-01', 'group')
  const e = await makeEnrollment(n.student.left, grp, '2026-09-01', 3200, 'group')
  await holdLessons(grp, e.studentId, 3, 'present')

  await login(page, KANYKEI)
  await page.goto(`/admin/groups/${grp}`)
  const dialog = await openAction(page, n.student.left, 'Ушёл из группы')
  const form = dialog.getByRole('form', { name: 'Ушёл из группы' })
  await expect(form.getByText(som('3 урока × 266,67 = 800 сом'))).toBeVisible()
  await expect(form.getByLabel('Сумма возврата, сом')).toHaveValue('2400')
  await form.getByRole('button', { name: 'Наличные' }).click()
  await shot(page, 'withdraw', testInfo)
  // a partial refund: the difference is never dropped silently
  await form.getByLabel('Сумма возврата, сом').fill('2000')
  await expect(form.getByText(/Разница 400.сом не вернётся/)).toBeVisible()
  await form.getByRole('button', { name: 'Оформить возврат и завершить' }).click()
  await expect(form.getByText(/Укажите, почему 400.сом остаётся центру/)).toBeVisible()
  await form.getByLabel(/Почему 400.сом остаётся центру/).fill('договорились с родителем')
  await form.getByRole('button', { name: 'Оформить возврат и завершить' }).click()
  await expect(dialog).toBeHidden()

  const db = service()
  const { data: enrollment } = await db
    .from('enrollments')
    .select('status')
    .eq('id', e.enrollmentId)
    .single()
  expect(enrollment?.status).toBe('finished')
  const { data: refund } = await db
    .from('payments')
    .select('amount, method, kind')
    .eq('subscription_id', e.subscriptionId)
    .eq('kind', 'refund')
    .single()
  expect(refund).toEqual({ amount: -2000, method: 'cash', kind: 'refund' })
  const { data: closed } = await db
    .from('subscriptions')
    .select('status')
    .eq('id', e.subscriptionId)
    .single()
  expect(closed?.status).toBe('exhausted')
  const { data: journal } = await db
    .from('audit_log')
    .select('reason')
    .eq('entity', 'subscriptions')
    .eq('entity_id', e.subscriptionId)
    .like('reason', 'остаток 400 сом оставлен центру%')
  expect(journal?.map((r) => r.reason)).toEqual([
    'остаток 400 сом оставлен центру: договорились с родителем',
  ])
  // the roster no longer has them
  await expect(page.getByRole('button', { name: `Действия: ${n.student.left}` })).toHaveCount(0)
})

test('«Записан по ошибке» с отметками «был»: ЗП учителя уменьшилась', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const teacher = await teacherId('Бекзат%')
  const grp = await makeGroup(n.group.grp, teacher, '2026-09-01', 'group')
  const e = await makeEnrollment(n.student.mistake, grp, '2026-09-01', 0, 'group')
  await holdLessons(grp, e.studentId, 3, 'present')
  const db = service()
  const payroll = async () => {
    const { data } = await db
      .from('v_payroll_preview')
      .select('base_amount')
      .eq('teacher_id', teacher)
      .eq('month', '2026-09-01')
      .single()
    return data?.base_amount ?? 0
  }
  const before = await payroll()
  const { data: impact } = await db.rpc('enrollment_payroll_impact', {
    p_enrollment_id: e.enrollmentId,
  })
  const amount = impact?.[0]?.amount ?? 0
  expect(amount).toBeGreaterThan(0)

  await login(page, KANYKEI)
  await page.goto(`/admin/students/${e.studentId}`)
  const dialog = await openAction(page, label(n.group.grp), 'Записан по ошибке — удалить')
  await expect(dialog.getByText('Отметки: «был» — 3')).toBeVisible()
  await expect(
    dialog.getByText(
      new RegExp(
        `ЗП уменьшится: учителю Бекзат −${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s?')}\\s?сом за 3 урока`,
      ),
    ),
  ).toBeVisible()
  await shot(page, 'mistake', testInfo)
  await dialog.getByRole('button', { name: 'Удалить зачисление' }).click()
  await expect(dialog).toBeHidden()

  const { count } = await db
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', e.studentId)
  expect(count).toBe(0)
  expect(Math.abs(before - (await payroll()) - amount)).toBeLessThanOrEqual(1)

  await page.goto('/admin/audit')
  await expect(page.getByText('Причина: записан(а) по ошибке').first()).toBeVisible()
})
