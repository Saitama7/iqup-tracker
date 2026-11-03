import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { cleanup, makeGroup, service, teacherId } from './support/undo-fixtures'

// #124 · «Изменить абонемент» — any live package of the enrollment, the newest by default. As Гусев
// Артём on prod (03.11): an old package 20 ур · 7 400 (really 16 · 5 920, its 5 920 paid) and a new
// paid 16 · 5 920. The old one is picked and fixed to 16 · 5 920 → nothing is owed on it any more.

lockSeed('write')
test.use({ serviceWorkers: 'block' })
test.slow()
const expect = baseExpect.configure({ timeout: 30_000 })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600) // the sheet fades in
  await page.screenshot({
    path: `docs/screenshots/r124-${name}-${size(testInfo)}.png`,
    style: noTabBar,
  })
}
const names = (testInfo: TestInfo) => ({
  group: `e2e правка старого ${size(testInfo)}`,
  student: `Е2е Гусев Старый ${size(testInfo)}`,
})
const nb = (t: string) => t.replace(/ /g, ' ')

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

async function gusev(group: string, fullName: string) {
  const db = service()
  const { data: student, error: se } = await db
    .from('students')
    .insert({ full_name: fullName, grade: 11 })
    .select('id')
    .single()
  if (se) throw se
  const { data: tariff, error: te } = await db
    .from('tariffs')
    .select('id')
    .eq('group_type', 'group')
    .lte('valid_from', '2026-09-22')
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()
  if (te) throw te
  const { data: enrollment, error: ee } = await db
    .from('enrollments')
    .insert({ student_id: student.id, group_id: group, start_date: '2026-09-22' })
    .select('id')
    .single()
  if (ee) throw ee
  const pkg = (started: string, lessons: number, price: number) => ({
    enrollment_id: enrollment.id,
    tariff_id: tariff.id,
    lessons_total: lessons,
    price_full: price,
    price_final: price,
    started_at: started,
  })
  const { data: subs, error } = await db
    .from('subscriptions')
    .insert([pkg('2026-09-22', 20, 7400), pkg('2026-10-29', 16, 5920)])
    .select('id, started_at')
  if (error) throw error
  const old = subs.find((s) => s.started_at === '2026-09-22')?.id ?? ''
  const fresh = subs.find((s) => s.started_at === '2026-10-29')?.id ?? ''
  const { error: pe } = await db.from('payments').insert([
    { subscription_id: old, amount: 5920, method: 'cash', paid_at: '2026-09-22T10:00:00Z' },
    { subscription_id: fresh, amount: 5920, method: 'cash', paid_at: '2026-10-29T10:00:00Z' },
  ])
  if (pe) throw pe
  return { studentId: student.id, old, fresh }
}

test('#124: «Изменить абонемент» — выбор старого абонемента, 20 · 7 400 → 16 · 5 920', async ({
  page,
}, testInfo) => {
  const n = names(testInfo)
  const group = await makeGroup(n.group, await teacherId('Бекзат%'), '2026-09-01', 'group')
  const g = await gusev(group, n.student)
  const db = service()
  const oldTerms = async () => {
    const { data } = await db
      .from('subscriptions')
      .select('lessons_total, price_full')
      .eq('id', g.old)
      .single()
    return data && [data.lessons_total, data.price_full]
  }

  await login(page, KANYKEI)
  await page.goto(`/admin/students/${g.studentId}`)
  const card = page.getByRole('region', { name: `Математика · ${n.group}` })
  await card.getByRole('button', { name: `Действия: Математика · ${n.group}` }).click()
  await page.getByRole('button', { name: 'Изменить абонемент' }).click()

  const dialog = page.getByRole('dialog', { name: 'Изменить абонемент' })
  const abon = dialog.getByLabel('Абонемент', { exact: true })
  await expect(abon.locator('option')).toHaveText([
    nb('абонемент с 29.10 · 16 ур · 5 920 · оплачен'),
    nb('абонемент с 22.09 · 20 ур · 7 400 · не хватает 1 480'),
  ])
  await expect(abon).toHaveValue(g.fresh)
  const edit = dialog.getByRole('form', { name: 'Изменить абонемент' })
  await expect(edit).toContainText(nb('Сейчас: 16 уроков · 5 920 сом'))
  await expect(edit.getByLabel('Уроков')).toHaveValue('16')

  await abon.selectOption(g.old)
  await expect(edit).toContainText(nb('Сейчас: 20 уроков · 7 400 сом'))
  await expect(edit.getByLabel('Уроков')).toHaveValue('20')
  await expect(edit.getByLabel('Цена, сом')).toHaveValue('7400')
  await edit.getByLabel('Уроков').fill('16')
  await edit.getByLabel('Цена, сом').fill('5920')
  const preview = edit.getByRole('status', { name: 'Что изменится' })
  await expect(preview).toContainText(nb('Было: Оплачено 5 920 из 7 400 · остаток 20 уроков'))
  await expect(preview).toContainText(nb('Станет: Оплачено 5 920 из 5 920 · остаток 16 уроков'))
  await edit.getByLabel('Причина').fill('заведён как полный, реально 16 ур · 5 920')
  await shot(page, 'subscription-edit-old', testInfo)

  await edit.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(nb('Абонемент изменён: 16 уроков · 5 920 сом'))).toBeVisible()
  await expect.poll(oldTerms).toEqual([16, 5920])

  // the old package owes nothing now — «Изменить абонемент» signs it «оплачен»
  await card.getByRole('button', { name: `Действия: Математика · ${n.group}` }).click()
  await page.getByRole('button', { name: 'Изменить абонемент' }).click()
  await expect(abon.locator('option')).toHaveText([
    nb('абонемент с 29.10 · 16 ур · 5 920 · оплачен'),
    nb('абонемент с 22.09 · 16 ур · 5 920 · оплачен'),
  ])
})
