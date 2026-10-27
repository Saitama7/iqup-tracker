import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
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

// #109 · своя цена абонемента и «Изменить абонемент» (К11, К12). Each project makes its own
// individual group of Айпери (50 %) with 1,5-h lessons on Sat / Sun from 1 September and a pupil
// bought 12 / 7 200 as on prod before К11 (600 a lesson → 300 to the teacher), one lesson held on
// 5 September. «Записать оплату → новый абонемент»: «Уроков» 8 by default, «Цена, сом» 7 200 with
// «8 занятий по 1,5 ч = 12 ч · 900 за занятие», a typed price is «своя цена». А6 «⋯ → Изменить
// абонемент» 8 / 7 200: the preview «Айпери: сентябрь 300 → 450 за занятие, +150 × 1 = +150 сом»,
// saved → «8 уроков · 7 200 сом», «Расчёт ЗП» for September: Айпери 5 333 + 450 = 5 783.

test.use({ serviceWorkers: 'block' })
test.slow()
// the held lesson moves September's payroll — the specs pinning it wait (#27)
lockSeed('write')
const expect = baseExpect.configure({ timeout: 30_000 })

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'webkit-desktop'
const size = (testInfo: TestInfo) => (isDesktop(testInfo) ? 1280 : 390)
const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'
const shot = async (page: Page, name: string, testInfo: TestInfo, fullPage = false) => {
  await page.waitForTimeout(600) // the sheet / toast fades in
  await page.screenshot({
    path: `docs/screenshots/r109-${name}-${size(testInfo)}.png`,
    style: noTabBar,
    fullPage,
  })
}

const names = (testInfo: TestInfo) => {
  const tag = isDesktop(testInfo) ? 'десктоп' : 'мобильный'
  return {
    group: `e2e цена ${tag}`,
    pupil: `Е2е Цена ${isDesktop(testInfo) ? 'Десктоп' : 'Мобильный'}`,
  }
}

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.pupil])
})

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.pupil])
})

test('#109: цена в форме оплаты, «Изменить абонемент» 12 → 8 — ЗП 300 → 450', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const teacher = await teacherId('Айпери%')
  const groupId = await makeGroup(n.group, teacher, '2026-09-01', 'individual', [6, 7])
  const { error } = await service()
    .from('groups')
    .update({ lesson_duration_min: 90 })
    .eq('id', groupId)
  if (error) throw error
  const { studentId } = await makeEnrollment(n.pupil, groupId, '2026-09-01', 7200, 'individual')
  await holdLessons(groupId, studentId, 1, 'present')

  await login(page, KANYKEI)

  // «Записать оплату → новый абонемент»: 8 lessons of 1,5 h = 12 h for 7 200 by default (К11)
  await page.goto(`/admin/payments?student=${studentId}`)
  const form = page.getByRole('form', { name: 'Записать оплату' })
  await expect(form.getByLabel('Ученик', { exact: true })).toContainText(n.pupil)
  const what = form.getByLabel('Что оплачивает')
  const value = await what.locator('option', { hasText: 'новый абонемент' }).getAttribute('value')
  await what.selectOption(value ?? '')
  await expect(
    form.getByRole('radiogroup', { name: 'Уроков' }).getByRole('radio', { name: '8' }),
  ).toBeChecked()
  const price = form.getByLabel('Цена, сом')
  await expect(price).toHaveValue('7200')
  await expect(form).toContainText('8 занятий по 1,5 ч = 12 ч · 900 за занятие')
  await price.fill('5400')
  await expect(form.getByText('своя цена')).toBeVisible()
  await expect(form).toContainText('8 занятий по 1,5 ч = 12 ч · 675 за занятие')
  await expect(form.getByRole('button', { name: /5\s400 · полностью/ })).toBeVisible()
  await form.getByRole('radiogroup', { name: 'Уроков' }).scrollIntoViewIfNeeded()
  await shot(page, 'payment-price', testInfo)
  await form.getByRole('button', { name: 'по тарифу' }).click()
  await expect(price).toHaveValue('7200')

  // А6 «⋯ → Изменить абонемент»
  await page.goto(`/admin/students/${studentId}`)
  const card = page.getByRole('region', { name: `Математика · ${n.group}` })
  await expect(card).toContainText(/12 уроков(\s·\s)?7\s200 сом/)
  await card.getByRole('button', { name: `Действия: Математика · ${n.group}` }).click()
  await page.getByRole('button', { name: 'Изменить абонемент' }).click()
  const edit = page.getByRole('form', { name: 'Изменить абонемент' })
  await expect(edit).toContainText('Сейчас: 12 уроков · 7 200 сом')
  await edit.getByLabel('Уроков').fill('8')
  const preview = edit.getByRole('status', { name: 'Что изменится' })
  await expect(preview).toContainText('Айпери: сентябрь 300 → 450 за занятие, +150 × 1 = +150 сом')
  await expect(preview).toContainText('Станет: Оплачено 7 200 из 7 200 · остаток 7 уроков')
  await edit.getByLabel('Причина').fill('К11: 12 часов = 8 занятий по 1,5 ч')
  await shot(page, 'edit', testInfo)
  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Абонемент изменён: 8 уроков · 7 200 сом')).toBeVisible()
  await expect(card).toContainText(/8 уроков(\s·\s)?7\s200 сом/)

  // the database and «Расчёт ЗП»: Айпери's September 5 333 + 450
  const { data: subs } = await service()
    .from('subscriptions')
    .select('lessons_total, price_full, enrollment:enrollments!inner(student_id)')
    .eq('enrollment.student_id', studentId)
  expect(subs?.map((s) => [s.lessons_total, s.price_full])).toEqual([[8, 7200]])
  await page.goto('/payroll?month=2026-09')
  const row = isDesktop(testInfo)
    ? page.getByRole('table', { name: 'Учителя' }).getByRole('row', { name: /Айпери Жусупова/ })
    : page
        .getByRole('region', { name: 'По учителям' })
        .getByRole('listitem')
        .filter({ hasText: 'Айпери' })
  await expect(row).toContainText('5 783')
})
