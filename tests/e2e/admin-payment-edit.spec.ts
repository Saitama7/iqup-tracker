import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import type { Database } from '../../src/lib/supabase/types.gen'
import { AIGERIM, KANYKEI, login } from './support/auth'

// #92 · the duplicate payment on production: the admin records a pupil's package payment and then
// the same money again as «новый абонемент» → А7 «⋯ / тап → Удалить» with a reason → one row left in
// the journal, А6 balance as before the duplicate, А10 «Оплата удалена … Причина …»; then «Изменить»
// fixes the amount. The accountant sees no «⋯». Each project makes its own pupil in «ОРТ ·
// математика» (no lessons are held there), removed at the end.
// Needs the local stack + `pnpm seed:users`.

test.use({ serviceWorkers: 'block' })
test.slow()
// every write here waits for its refetch of the journal, balances and А10 (no optimistic updates)
const expect = baseExpect.configure({ timeout: 15_000 })

const ORT = '00000000-0000-4000-b000-000000000006'
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const shot = (testInfo: TestInfo, name: string) =>
  testInfo.outputPath(`${name}-${testInfo.project.name === 'webkit-desktop' ? 1280 : 390}.png`)

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function asAdmin() {
  const env = localSupabase()
  const db = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await db.auth.signInWithPassword({
    email: phoneToEmail(`0${KANYKEI.phone}`),
    password: KANYKEI.password,
  })
  if (error) throw error
  return db
}

const pupilName = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} Дублева ${testInfo.repeatEachIndex + 1}`

// The test pupil's rows go as superuser with triggers off (the journal rows stay — like any audit).
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

/** A pupil enrolled today in ОРТ with one unpaid package at the group tariff. */
async function makePupil(fullName: string) {
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
  const { data: sub, error } = await db
    .from('subscriptions')
    .insert({
      enrollment_id: enrollment.id,
      tariff_id: tariff.id,
      lessons_total: tariff.lessons_in_package,
      price_full: tariff.package_price,
      price_final: tariff.package_price,
      started_at: String(today),
    })
    .select('id')
    .single()
  if (error) throw error
  return {
    studentId: student.id,
    enrollmentId: enrollment.id,
    subscriptionId: sub.id,
    price: tariff.package_price,
  }
}

async function balanceOf(studentId: string) {
  const { data, error } = await service()
    .from('v_student_balance')
    .select('paid_som, paid_lessons, debt_lessons, debt_som, lessons_left')
    .eq('student_id', studentId)
  if (error) throw error
  return data
}

const som = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/\s/g, ' ')} сом`

test('А7: дубль оплаты удаляется с причиной, баланс как до дубля, строка в А10 (#92)', async ({
  page,
}, testInfo) => {
  const name = pupilName(testInfo)
  await cleanup(name)
  const pupil = await makePupil(name)
  try {
    const admin = await asAdmin()
    const first = await admin.rpc('record_payment', {
      p_subscription_id: pupil.subscriptionId,
      p_amount: pupil.price,
      p_method: 'cash',
    })
    if (first.error) throw first.error
    const before = await balanceOf(pupil.studentId)
    // the duplicate: the same money again as «новый абонемент»
    const dup = await admin.rpc('buy_subscription', {
      p_enrollment_id: pupil.enrollmentId,
      p_amount: pupil.price,
      p_method: 'cash',
    })
    if (dup.error) throw dup.error

    await login(page, KANYKEI)
    await page.goto('/admin/payments?tab=journal')
    const journal = isDesktop(page)
      ? page.getByRole('table', { name: 'Журнал оплат' })
      : page.getByRole('list', { name: 'Журнал оплат' })
    const rows = journal.locator(isDesktop(page) ? 'tbody tr' : 'li').filter({ hasText: name })
    await expect(rows).toHaveCount(2)

    // newest first: the duplicate
    if (isDesktop(page)) {
      await rows
        .first()
        .getByRole('button', { name: /^Действия:/ })
        .click()
      await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    } else {
      await rows.first().getByRole('button').click()
      const sheet = page.getByRole('dialog', { name: 'Оплата' })
      await expect(sheet).toContainText(name)
      await expect(sheet.getByRole('link', { name: 'Карточка ученика' })).toBeVisible()
      await page.waitForTimeout(600) // the sheet slides in (500 ms) — for the screenshot only
      await page.screenshot({ path: shot(testInfo, 'r92-payment-sheet') })
      await sheet.getByRole('button', { name: 'Удалить' }).click()
    }

    const form = page.getByRole('form', { name: 'Удалить оплату' })
    await expect(form).toContainText(name)
    await expect(form.getByTestId('delete-impact')).toHaveText(
      /^Абонемент с \d\d\.\d\d будет удалён — по нему нет других оплат и отметок$/,
    )
    await form.getByRole('button', { name: 'Удалить оплату' }).click()
    await expect(form.getByRole('alert')).toHaveText('Укажите причину')
    await form.getByLabel('Причина').fill('внесли дважды')
    await page.screenshot({ path: shot(testInfo, 'r92-payment-delete') })
    await form.getByRole('button', { name: 'Удалить оплату' }).click()
    await expect(page.getByText(`Оплата удалена: ${name} · ${som(pupil.price)}`)).toBeVisible()

    // one row left; the balance and the packages as before the duplicate
    await expect(rows).toHaveCount(1)
    expect(await balanceOf(pupil.studentId)).toEqual(before)
    await page.screenshot({ path: shot(testInfo, 'r92-payments-journal'), fullPage: true })

    // «Изменить»: the amount was half in fact
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
    await expect(edit.getByLabel('Сумма, сом')).toHaveValue(String(pupil.price))
    await edit.getByLabel('Сумма, сом').fill(String(pupil.price / 2))
    await edit.getByRole('radio', { name: 'Mbank' }).click()
    await edit.getByLabel('Причина исправления').fill('ошиблись суммой')
    await page.screenshot({ path: shot(testInfo, 'r92-payment-edit') })
    await edit.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Оплата изменена')).toBeVisible()
    await expect(rows.first()).toContainText('Mbank')
    await expect(rows.first()).toContainText('частично')

    // А6: one payment, the «⋯» there too
    await page.goto(`/admin/students/${pupil.studentId}`)
    const payments = page.getByRole('region', { name: 'Платежи' }).first()
    await expect(payments.getByRole('listitem')).toHaveCount(1)
    await expect(payments.getByRole('button', { name: /^Действия:/ })).toHaveCount(1)
    await page.screenshot({ path: shot(testInfo, 'r92-student-payments'), fullPage: true })

    // А10: the deletion with its reason
    await page.goto('/admin/audit')
    await page.getByRole('searchbox', { name: 'Поиск по журналу' }).fill(name)
    const feed = page.getByRole('feed', { name: 'Изменения' })
    const deleted = feed
      .getByRole('article')
      .filter({ hasText: `Оплата удалена: ${name} · ${som(pupil.price)}` })
    await expect(deleted).toHaveCount(1)
    await expect(deleted).toContainText('Причина: «внесли дважды»')
    await expect(
      feed.getByRole('article').filter({ hasText: `Абонемент удалён вместе с оплатой: ${name}` }),
    ).toHaveCount(1)
    await expect(
      feed.getByRole('article').filter({ hasText: `Оплата изменена: ${name} · сумма` }),
    ).toContainText('Причина: «ошиблись суммой»')
    await page.screenshot({ path: shot(testInfo, 'r92-audit'), fullPage: true })
  } finally {
    await cleanup(name)
  }
})

test('А7: у бухгалтера нет «⋯» и шита (И43)', async ({ page }) => {
  await login(page, AIGERIM)
  await page.goto('/admin/payments?month=2026-09')
  const journal = isDesktop(page)
    ? page.getByRole('table', { name: 'Журнал оплат' })
    : page.getByRole('list', { name: 'Журнал оплат' })
  await expect(journal).toContainText('Асема Ниязова')
  await expect(journal.getByRole('button')).toHaveCount(0)
})
