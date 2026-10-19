import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { AIGERIM, GULZAT, KANYKEI, login } from './support/auth'

// #93 · «Записать оплату» guards against paying twice: the admin pays a pupil → opens the picker
// again, finds him by name → «Оплачено <today> · 3 200» in the list, picks him → «Похоже на повтор»,
// «Записать» is off until «Да, это новая оплата» → records. Two pupils with look-alike names
// (Повторова / Повторёва) are told apart by the phone; «Не оплатили» hides the paid one; the phone
// search finds the other. Each project makes its own pupils in «ОРТ · математика», removed at the end.

test.use({ serviceWorkers: 'block' })
// recording refetches four queries before the form clears — slow on a loaded machine
const expect = baseExpect.configure({ timeout: 30_000 })

const ORT = '00000000-0000-4000-b000-000000000006'
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'
const shot = async (page: Page, name: string, testInfo: TestInfo) => {
  await page.waitForTimeout(600) // the sheet / popover fades in
  await page.screenshot({
    path: `docs/screenshots/r93-${name}-${size(testInfo)}.png`,
    style: noTabBar,
  })
}

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const tag = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} ${testInfo.repeatEachIndex + 1}`
// look-alike names: «повтор» finds both; the search folds ё → е, «повторева» finds the second
const names = (testInfo: TestInfo) => ({
  paid: `${tag(testInfo)} Повторова`,
  other: `${tag(testInfo)} Повторёва`,
})
// distinct phones per project: 99670093 + project + index + pupil
const phone = (testInfo: TestInfo, n: number) =>
  `99670093${testInfo.project.name === 'webkit-desktop' ? 2 : 1}${testInfo.repeatEachIndex % 10}${n}${n}`

/** '996700931011' → '0700 931 011', as the picker shows it. */
const shown = (p: string) => `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}`

// Payments are immutable (И41): the test pupils' rows are removed as superuser with triggers off.
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
async function makePupil(fullName: string, parentPhone: string): Promise<string> {
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
    .insert({ full_name: fullName, grade: 11, parent_phone: parentPhone })
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

test('#93: повторная оплата — статус в поиске, «Похоже на повтор», подтверждение', async ({
  page,
}, testInfo) => {
  const { paid, other } = names(testInfo)
  await Promise.all([cleanup(paid), cleanup(other)])
  const paidId = await makePupil(paid, phone(testInfo, 1))
  await makePupil(other, phone(testInfo, 2))
  const { data: today } = await service().rpc('bishkek_today')
  const ddmm = `${String(today).slice(8, 10)}.${String(today).slice(5, 7)}`
  try {
    await login(page, KANYKEI)

    // ─── the first payment (the pupil comes preselected from А5 / А6) ───────
    await page.goto(`/admin/payments?student=${paidId}`)
    const form = page.getByRole('form', { name: 'Записать оплату' })
    const picker = form.getByLabel('Ученик', { exact: true })
    await expect(picker).toContainText(paid)
    await expect(form.getByRole('region', { name: 'Оплаты ученика' })).toContainText(
      'Оплат ещё не было',
    )
    await form.getByLabel('Сумма, сом').fill('3200')
    await form.getByRole('button', { name: /^Записать 3\s200 сом/ }).click()
    await expect(
      page.getByText(
        `Оплата записана: ${paid} · 3\u00a0200 сом · математика · абонемент с ${ddmm}`,
      ),
    ).toBeVisible()
    // the form is cleared for the next student, the focus is on the picker
    await expect(picker).toContainText('Выберите ученика')
    await expect(picker).toBeFocused()

    // ─── the picker: both look-alikes, told apart by the phone ──────────────
    await picker.click()
    const popup = page.getByRole('dialog', { name: 'Выбор ученика' })
    await popup.getByRole('searchbox', { name: 'Поиск ученика' }).fill('повтор')
    const options = popup.getByRole('option')
    await expect(options).toHaveCount(2)
    const paidRow = options.filter({ hasText: paid })
    const otherRow = options.filter({ hasText: other })
    await expect(paidRow).toContainText(`Оплачено ${ddmm} · 3\u00a0200`)
    await expect(paidRow).toContainText('осталось 12 из 12')
    await expect(paidRow).toContainText('ОРТ · математика')
    await expect(paidRow).toContainText(shown(phone(testInfo, 1)))
    await expect(otherRow).toContainText(shown(phone(testInfo, 2)))
    await expect(otherRow).toContainText('Нет оплат')
    await shot(page, 'picker', testInfo)

    // «Не оплатили» hides the paid one
    await popup.getByRole('button', { name: /^Не оплатили/ }).click()
    await expect(paidRow).toHaveCount(0)
    await expect(otherRow).toHaveCount(1)
    await popup.getByRole('button', { name: /^Оплатили/ }).click()
    await expect(paidRow).toHaveCount(1)
    await expect(otherRow).toHaveCount(0)
    await popup.getByRole('button', { name: /^Все/ }).click()
    await paidRow.click()
    await expect(popup).toHaveCount(0)

    // ─── «Похоже на повтор»: «Записать» is off until confirmed ──────────────
    await expect(form.getByRole('region', { name: 'Оплаты ученика' })).toContainText(
      `${ddmm}3\u00a0200 сом`,
    )
    const warning = form.getByRole('status').filter({ hasText: 'Похоже на повтор' })
    await expect(warning).toContainText(`Оплата 3\u00a0200 сом уже внесена ${ddmm}`)
    await expect(warning).toContainText(
      'Текущий абонемент оплачен, осталось 12 уроков — новый ещё не нужен',
    )
    await form.getByLabel('Сумма, сом').fill('3200')
    const submit = form.getByRole('button', { name: /^Записать 3\s200 сом/ })
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAccessibleDescription(/Похоже на повтор/)
    await shot(page, 'repeat-warning', testInfo)
    await warning.getByLabel('Да, это новая оплата — записать ещё одну').check()
    await expect(submit).toBeEnabled()
    await submit.click()
    // the form is cleared again — the second payment (a new package) is in
    await expect(picker).toContainText('Выберите ученика')
    await expect
      .poll(async () => {
        const { data } = await service()
          .from('subscriptions')
          .select('id, enrollment:enrollments!inner(student_id)')
          .eq('enrollment.student_id', paidId)
        return data?.length
      })
      .toBe(2)

    // ─── the phone search finds the other look-alike only ───────────────────
    await picker.click()
    await popup
      .getByRole('searchbox', { name: 'Поиск ученика' })
      .fill(`0${phone(testInfo, 2).slice(3)}`)
    await expect(popup.getByRole('option')).toHaveCount(1)
    await expect(popup.getByRole('option')).toContainText(other)
    // ё = е (И47 nameKey)
    await popup.getByRole('searchbox', { name: 'Поиск ученика' }).fill('повторева')
    await expect(popup.getByRole('option')).toHaveCount(1)
    await expect(popup.getByRole('option')).toContainText(other)
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    // «Кто ещё не оплатил» → А5 with «Не оплатили»
    await form.getByRole('link', { name: 'Кто ещё не оплатил →' }).click()
    await expect(page).toHaveURL(/\/admin\/students\?pay=unpaid/)
    await expect(page.getByRole('button', { name: /^Не оплатили/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const list = isDesktop(page)
      ? page.getByRole('table', { name: 'Ученики' })
      : page.getByRole('list', { name: 'Ученики' })
    await expect(list).toContainText(other)
    await expect(list).not.toContainText(paid)
  } finally {
    await Promise.all([cleanup(paid), cleanup(other)])
  }
})

test('#93: бухгалтер и учитель не видят выбор ученика (И43)', async ({ page }) => {
  await login(page, AIGERIM)
  await page.goto('/admin/payments')
  await expect(page.getByRole('heading', { name: 'Оплаты' })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Записать оплату' })).toHaveCount(0)
  await expect(page.getByLabel('Ученик', { exact: true })).toHaveCount(0)
})

test('#93: учитель на А7 — 403', async ({ page }) => {
  await login(page, GULZAT)
  await page.goto('/admin/payments')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  await expect(page.getByLabel('Ученик', { exact: true })).toHaveCount(0)
})
