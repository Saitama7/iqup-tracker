import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { AIGERIM, KANYKEI, login } from './support/auth'

// #47 · А7 Оплаты on the phone and on the desktop: a pupil with an unpaid 3 200 subscription →
// «Записать оплату» 1 600 (В7.1: 6 lessons open) → А6 shows «Оплачено 6 из 12» → «Возврат» of the
// remaining 6 lessons (В8) → the journal has both rows, the subscription is closed, the enrollment
// stays active (И42).
// Needs the local stack + `pnpm seed:users`. Each project makes its own pupil in «ОРТ · математика»
// (no lessons are held or marked, nobody else counts that group), removed again at the end.

test.use({ serviceWorkers: 'block' })

const ORT = '00000000-0000-4000-b000-000000000006'
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// One pupil per project and per --repeat-each copy (#38).
const pupilName = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} Оплатова ${testInfo.repeatEachIndex + 1}`

// Payments are immutable (И41): the test pupil's rows are removed as superuser with triggers off.
function deletePayments(subIds: string[]) {
  execFileSync(
    'psql',
    [
      localSupabase().dbUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'set session_replication_role = replica',
      '-c',
      `delete from public.payments where subscription_id in (${subIds.map((id) => `'${id}'::uuid`).join(', ')})`,
    ],
    { stdio: 'ignore' },
  )
}

async function cleanup(fullName: string) {
  const db = service()
  const { data: students } = await db.from('students').select('id').eq('full_name', fullName)
  for (const { id } of students ?? []) {
    const { data: enrollments } = await db.from('enrollments').select('id').eq('student_id', id)
    const ids = (enrollments ?? []).map((e) => e.id)
    if (ids.length > 0) {
      const { data: subs } = await db.from('subscriptions').select('id').in('enrollment_id', ids)
      const subIds = (subs ?? []).map((s) => s.id)
      if (subIds.length > 0) {
        deletePayments(subIds)
        await db.from('subscriptions').delete().in('id', subIds)
      }
      await db.from('enrollments').delete().in('id', ids)
    }
    await db.from('students').delete().eq('id', id)
  }
}

/** A pupil enrolled today in ОРТ with one unpaid subscription at the group tariff. */
async function makePupil(fullName: string): Promise<string> {
  const db = service()
  const { data: today } = await db.rpc('bishkek_today')
  const { data: tariff, error: te } = await db
    .from('tariffs')
    .select('id, lessons_in_package, package_price')
    .eq('group_type', 'group')
    .lte('valid_from', String(today))
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()
  if (te) throw te
  const { data: student, error: se } = await db
    .from('students')
    .insert({ full_name: fullName, grade: 11 })
    .select('id')
    .single()
  if (se) throw se
  const { data: enrollment, error: ee } = await db
    .from('enrollments')
    .insert({ student_id: student.id, group_id: ORT, start_date: String(today) })
    .select('id')
    .single()
  if (ee) throw ee
  const { error } = await db.from('subscriptions').insert({
    enrollment_id: enrollment.id,
    tariff_id: tariff.id,
    lessons_total: tariff.lessons_in_package,
    price_full: tariff.package_price,
    price_final: tariff.package_price,
    started_at: String(today),
  })
  if (error) throw error
  return student.id
}

test('А7: частичная оплата открывает 6 уроков, возврат по остатку (В7.1, В8)', async ({
  page,
}, testInfo) => {
  const name = pupilName(testInfo)
  await cleanup(name)
  const studentId = await makePupil(name)
  try {
    await login(page, KANYKEI)

    // the menu item is on (sidebar on the desktop, the tab bar's «Оплата» on the phone)
    if (isDesktop(page)) {
      await page.getByRole('link', { name: 'Оплаты' }).click()
      await expect(page.getByRole('heading', { name: 'Оплаты' })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Журнал оплат' })).toBeVisible()
    } else {
      await page.getByRole('link', { name: 'Оплата' }).click()
      await expect(page.getByRole('heading', { name: 'Оплаты' })).toBeVisible()
      await expect(page.getByRole('form', { name: 'Записать оплату' })).toBeVisible()
    }

    // from А5 / А6: the pupil comes preselected
    await page.goto(`/admin/payments?student=${studentId}`)
    const form = page.getByRole('form', { name: 'Записать оплату' })
    await expect(form.getByLabel('Ученик', { exact: true })).toContainText(name)
    await expect(form.getByLabel('Что оплачивает')).toContainText('доплата по текущему')
    await expect(form.getByText('Текущий: осталось 12 из 12')).toBeVisible()
    await expect(form.getByText('пора оплачивать', { exact: true })).toBeVisible()

    await form.getByLabel('Сумма, сом').fill('1600')
    await form.getByRole('radio', { name: 'Mbank' }).click()
    await expect(form.getByText('После записи: оплачено 6 из 12, доступно 6 уроков')).toBeVisible()
    await form.getByLabel('Комментарий').fill('половина, доплата через неделю')
    await form.getByRole('button', { name: /^Записать 1\s600 сом/ }).click()
    await expect(page.getByText(`Оплата записана: ${name} · 1\u00a0600 сом`)).toBeVisible()

    // the panel is reset for the next student (#93); the pupil's balance now has 6 paid lessons
    await form.getByLabel('Ученик', { exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Выбор ученика' })
    await picker.getByRole('searchbox', { name: 'Поиск ученика' }).fill(name)
    await picker.getByRole('option', { name: new RegExp(name) }).click()
    await expect(form.getByText('оплачено 6 из 12', { exact: true })).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'payments'), fullPage: true })

    // the journal: the partial payment of this month
    if (!isDesktop(page)) await page.getByRole('tab', { name: 'Журнал' }).click()
    const journal = isDesktop(page)
      ? page.getByRole('table', { name: 'Журнал оплат' })
      : page.getByRole('list', { name: 'Журнал оплат' })
    const row = journal.locator(isDesktop(page) ? 'tr' : 'li').filter({ hasText: name })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('1\u00a0600')
    await expect(row).toContainText('частично')
    await expect(row).toContainText('Mbank')
    if (!isDesktop(page))
      await page.screenshot({ path: shot(testInfo, 'payments-journal'), fullPage: true })

    // А6: «Оплачено 6 из 12», the payment in «Платежи»
    await page.goto(`/admin/students/${studentId}`)
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await expect(page.getByText(/Оплачено 6 из 12/).first()).toBeVisible()
    await expect(page.getByText(/\+\s?1\s600 сом/).first()).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'student'), fullPage: true })

    // «Возврат»: the remaining paid lessons (6 × 266,67 = 1 600) are suggested
    await page.goto(`/admin/payments?student=${studentId}`)
    await form.getByRole('button', { name: 'Возврат' }).click()
    const refund = page.getByRole('form', { name: 'Возврат' })
    await expect(refund.getByLabel('Сумма возврата, сом')).toHaveValue('1600')
    await expect(refund.getByText('Остаток 6 уроков × 266,67 сом = 1\u00a0600 сом')).toBeVisible()
    await refund.getByRole('button', { name: /^Оформить возврат/ }).click()
    await expect(refund.getByRole('alert')).toHaveText('Укажите причину возврата')
    await refund.getByLabel('Причина возврата').fill('Переезд')
    await refund.getByRole('button', { name: /^Оформить возврат 1\s600 сом/ }).click()
    await expect(page.getByText(`Возврат оформлен: ${name} · 1\u00a0600 сом`)).toBeVisible()

    // the subscription is closed, the journal has the refund
    if (!isDesktop(page)) await page.getByRole('tab', { name: 'Журнал' }).click()
    const refundRow = journal
      .locator(isDesktop(page) ? 'tr' : 'li')
      .filter({ hasText: name })
      .filter({ hasText: 'возврат' })
    await expect(refundRow).toContainText('− 1\u00a0600')
    await expect(refundRow).toContainText('остаток 6 ур')

    // the refund is only about the money (И42): the pupil stays in the group until the admin finishes
    // the enrollment on А6
    const db = service()
    const { data: enrollment } = await db
      .from('enrollments')
      .select('status, subscriptions(status)')
      .eq('student_id', studentId)
      .single()
    expect(enrollment).toMatchObject({
      status: 'active',
      subscriptions: [{ status: 'refunded' }],
    })
  } finally {
    await cleanup(name)
  }
})

test('А7: итоги по группам и учителям (Г4)', async ({ page }, testInfo) => {
  await login(page, KANYKEI)
  // September of the seed: every first package and the renewals are there, cash and Mbank apart
  await page.goto('/admin/payments?month=2026-09&tab=groups')
  if (isDesktop(page)) {
    const table = page.getByRole('table', { name: 'Итоги по группам' })
    await expect(table.locator('tr').filter({ hasText: 'Математика · 8 класс А' })).toContainText(
      'Гульзат',
    )
    await page.getByRole('tab', { name: 'По учителям' }).click()
    const teachers = page.getByRole('table', { name: 'Итоги по учителям' })
    await expect(teachers.locator('tr').filter({ hasText: 'Гульзат' })).toContainText('4 группы')
  } else {
    const list = page.getByRole('list', { name: 'Итоги по группам' })
    await expect(list.getByText('Математика · 8 класс А')).toBeVisible()
    await page.getByRole('button', { name: 'По учителям' }).click()
    await expect(
      page.getByRole('list', { name: 'Итоги по учителям' }).getByText('4 группы'),
    ).toBeVisible()
  }
  await page.screenshot({ path: shot(testInfo, 'payments-totals'), fullPage: true })
})

test('учитель видит долг из реального баланса (Д3, В7): Азамат — 2 урока, 740 сом', async ({
  page,
}, testInfo) => {
  // Seed: Азамат Уулу has not paid the after-school renewal and used 2 lessons of it.
  await login(page, { phone: '555 201 004', password: 'iqup-demo' }) // Нургуль
  await page.goto('/groups/00000000-0000-4000-b000-000000000005')
  const azamat = isDesktop(page)
    ? page.getByRole('row').filter({ hasText: 'Азамат Уулу' })
    : page.getByRole('listitem').filter({ hasText: 'Азамат Уулу' })
  await expect(azamat.first()).toContainText(/[Дд]олг\s2\s(ур\.|урока)\s·\s740\sсом/)
  await page.screenshot({ path: shot(testInfo, 'teacher-debt'), fullPage: true })
})

test('А7: бухгалтер только читает (Г1, И43)', async ({ page }, testInfo) => {
  await login(page, AIGERIM)
  await page.goto('/admin/payments?month=2026-09')
  await expect(page.getByRole('heading', { name: 'Оплаты' })).toBeVisible()
  const journal = isDesktop(page)
    ? page.getByRole('table', { name: 'Журнал оплат' })
    : page.getByRole('list', { name: 'Журнал оплат' })
  await expect(journal).toContainText('Асема Ниязова')
  // no panel, no «Записать» tab, names are not links to А6 (admin-only)
  await expect(page.getByRole('form', { name: 'Записать оплату' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Записать' })).toHaveCount(0)
  await expect(journal.getByRole('link')).toHaveCount(0)
  if (isDesktop(page)) await expect(page.getByRole('link', { name: 'Оплаты' })).toBeVisible()
  await page.screenshot({ path: shot(testInfo, 'payments-accountant'), fullPage: true })
})
