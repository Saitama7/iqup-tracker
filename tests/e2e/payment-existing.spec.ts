import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'

// #119 · the payment of a new package went in while an older one stayed unpaid (Ясмин, Айдин): А7
// «Что оплачивает» lists every package still owed — the older one first and by default, then the
// partly paid one, then «новый абонемент» (a warning with «Да, это новый абонемент»). Paying the
// older one clears it; «⋯ → Изменить оплату → Абонемент» moves a payment between the packages.
// Each project makes its own pupil in «ОРТ · математика» (no lessons are held there), removed at the
// end. Needs the local stack + `pnpm seed:users`.

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
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} Долгова ${testInfo.repeatEachIndex + 1}`

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

/** A pupil enrolled in ОРТ 30 days ago with one unpaid package from then. */
async function makePupil(fullName: string) {
  const db = service()
  const { data: now } = await db.rpc('bishkek_today')
  const today = new Date(Date.parse(`${String(now)}T00:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: tariff, error: te } = await db
    .from('tariffs')
    .select('id, lessons_in_package, package_price')
    .eq('group_type', 'group')
    .lte('valid_from', today)
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
    .insert({ student_id: student.id, group_id: ORT, start_date: today })
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
      started_at: today,
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

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n).replace(/\s/g, '\u00a0')

test('А7: оплата на старый неоплаченный абонемент, новый — с предупреждением, перенос оплаты (#119)', async ({
  page,
}, testInfo) => {
  const name = pupilName(testInfo)
  await cleanup(name)
  const pupil = await makePupil(name)
  try {
    const db = service()
    const { data: old } = await db
      .from('subscriptions')
      .select('started_at')
      .eq('id', pupil.subscriptionId)
      .single()
    const start = old?.started_at ?? ''
    await login(page, KANYKEI)

    // right after the enrollment: its unpaid package by default, not «новый»
    await page.goto(`/admin/payments?student=${pupil.studentId}`)
    const form = page.getByRole('form', { name: 'Записать оплату' })
    const what = form.getByLabel('Что оплачивает')
    await expect(what.locator('option:checked')).toHaveText(
      `ОРТ · математика · оплатить абонемент с ${dm(start)} · 12 ур. · ${fmt(pupil.price)}`,
    )

    // the half of the price went in as a «новый абонемент» — the older one stays unpaid
    const admin = await asAdmin()
    const half = pupil.price / 2
    const dup = await admin.rpc('buy_subscription', {
      p_enrollment_id: pupil.enrollmentId,
      p_amount: half,
      p_method: 'cash',
    })
    if (dup.error) throw dup.error

    await page.reload()
    await expect(what.locator('option')).toHaveCount(3)
    await expect(what.locator('option').nth(0)).toContainText(`оплатить абонемент с ${dm(start)}`)
    await expect(what.locator('option').nth(1)).toContainText(`доплата · абонемент с`)
    await expect(what.locator('option').nth(1)).toContainText(`осталось ${fmt(pupil.price - half)}`)
    await expect(what.locator('option').nth(2)).toHaveText('ОРТ · математика · новый абонемент')
    // the oldest owed by default; the panel names it
    await expect(what.locator('option:checked')).toContainText('оплатить абонемент с')
    await expect(form.getByText(`Абонемент с ${dm(start)}: осталось 12 из 12`)).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'r119-pay-old'), fullPage: true })

    // the partly paid one
    await what.selectOption({ index: 1 })
    await expect(form.getByText('Текущий: осталось 12 из 12')).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'r119-pay-partial'), fullPage: true })

    // «новый абонемент» while one is unpaid: blocked until «Да, это новый абонемент»
    await what.selectOption({ index: 2 })
    await expect(form.getByRole('status').filter({ hasText: 'Похоже на повтор' })).toContainText(
      `Абонемент с ${dm(start)} не оплачен (осталось внести ${fmt(pupil.price)}) — оплатите его, новый не нужен`,
    )
    await form.getByLabel('Сумма, сом').fill(String(pupil.price))
    await expect(form.getByRole('button', { name: /^Записать/ })).toBeDisabled()
    await expect(form.getByLabel('Да, это новый абонемент')).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'r119-pay-new'), fullPage: true })

    // pay the older one: it is paid, the list is the partial one and «новый»
    await what.selectOption({ index: 0 })
    await form.getByLabel('Сумма, сом').fill(String(pupil.price))
    // today's payment of the new one is a repeat by И75 — confirmed
    await form.getByLabel('Да, это новая оплата — записать ещё одну').check()
    await form.getByRole('button', { name: /^Записать/ }).click()
    await expect(page.getByText(`Оплата записана: ${name}`)).toBeVisible()
    const { data: paid } = await db
      .from('v_student_balance')
      .select('paid_som')
      .eq('subscription_id', pupil.subscriptionId)
      .single()
    expect(paid?.paid_som).toBe(pupil.price)

    // «⋯ → Изменить оплату → Абонемент»: the half moves to the older package too
    await page.goto('/admin/payments?tab=journal')
    const journal = isDesktop(page)
      ? page.getByRole('table', { name: 'Журнал оплат' })
      : page.getByRole('list', { name: 'Журнал оплат' })
    const row = journal
      .locator(isDesktop(page) ? 'tbody tr' : 'li')
      .filter({ hasText: name })
      .filter({ hasText: fmt(half) })
    if (isDesktop(page)) {
      await row.getByRole('button', { name: /^Действия:/ }).click()
      await page.getByRole('button', { name: 'Изменить', exact: true }).click()
    } else {
      await row.getByRole('button').click()
      await page
        .getByRole('dialog', { name: 'Оплата' })
        .getByRole('button', { name: 'Изменить' })
        .click()
    }
    const edit = page.getByRole('form', { name: 'Изменить оплату' })
    const abon = edit.getByLabel('Абонемент')
    await expect(abon.locator('option')).toHaveCount(2)
    await abon.selectOption({ index: 0 })
    await edit.getByLabel('Причина исправления').fill('оплата ушла в новый абонемент')
    await page.screenshot({ path: shot(testInfo, 'r119-payment-move') })
    await edit.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Оплата изменена')).toBeVisible()
    await expect
      .poll(async () => {
        const { data } = await db
          .from('payments')
          .select('id')
          .eq('subscription_id', pupil.subscriptionId)
        return data?.length
      })
      .toBe(2)

    // А10: «оплата перенесена на абонемент с …»
    await page.goto('/admin/audit')
    await page.getByRole('searchbox', { name: 'Поиск по журналу' }).fill(name)
    await expect(
      page
        .getByRole('feed', { name: 'Изменения' })
        .getByRole('article')
        .filter({
          hasText: `Оплата изменена: ${name} · оплата перенесена на абонемент с ${dm(start)}`,
        })
        // audit rows outlive the pupil (a rerun with the same name) — newest first
        .first(),
    ).toContainText('Причина: «оплата ушла в новый абонемент»')
  } finally {
    await cleanup(name)
  }
})
