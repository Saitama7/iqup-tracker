import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'

// #101 · subscription size at purchase (И89): «Записать оплату» → «новый абонемент» → «Уроков» 8 →
// 7 200 / 12 × 8 = 4 800, presets and «Откроется 8 уроков» from it → the toast «абонемент 8 уроков
// с …» → А6 «8 уроков · 4 800 сом», «Оплачено 8 из 8» → the picker «осталось 8 из 8». Each project
// makes its own pupil enrolled (no package yet) in the individual group «Бекзат» (7 200 / 12, no
// lessons held for the pupil), removed at the end.

test.use({ serviceWorkers: 'block' })
test.slow()
// recording refetches four queries before the form clears — slow on a loaded machine
const expect = baseExpect.configure({ timeout: 30_000 })

const INDIVIDUAL = '00000000-0000-4000-b000-000000000007'
const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'
const shot = async (page: Page, name: string, testInfo: TestInfo, fullPage = false) => {
  await page.waitForTimeout(600) // the sheet / popover / toast fades in
  await page.screenshot({
    path: `docs/screenshots/r101-${name}-${size(testInfo)}.png`,
    style: noTabBar,
    fullPage,
  })
}

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const pupilName = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} Восьмая ${testInfo.repeatEachIndex + 1}`

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

/** A pupil enrolled today in «Бекзат» (individual), no package yet. */
async function makePupil(fullName: string): Promise<string> {
  const db = service()
  const { data: today } = await db.rpc('bishkek_today')
  const { data: student, error: se } = await db
    .from('students')
    .insert({ full_name: fullName, grade: 9 })
    .select('id')
    .single()
  if (se) throw se
  const { error } = await db
    .from('enrollments')
    .insert({ student_id: student.id, group_id: INDIVIDUAL, start_date: String(today) })
  if (error) throw error
  return student.id
}

test('#101: новый абонемент на 8 уроков — 4 800, А6 «8 уроков», в поиске «осталось 8 из 8»', async ({
  page,
}, testInfo) => {
  const name = pupilName(testInfo)
  await cleanup(name)
  const id = await makePupil(name)
  const { data: today } = await service().rpc('bishkek_today')
  const ddmm = `${String(today).slice(8, 10)}.${String(today).slice(5, 7)}`
  try {
    await login(page, KANYKEI)
    await page.goto(`/admin/payments?student=${id}`)
    const form = page.getByRole('form', { name: 'Записать оплату' })
    await expect(form.getByLabel('Ученик', { exact: true })).toContainText(name)
    await expect(form.getByLabel('Что оплачивает')).toContainText('новый абонемент')

    // «Уроков»: 12 by the tariff; 8 → 4 800 at the same 600 a lesson
    const lessons = form.getByRole('radiogroup', { name: 'Уроков' })
    await expect(lessons.getByRole('radio', { name: '12' })).toBeChecked()
    await expect(form.getByRole('button', { name: /7\s200 · полностью/ })).toBeVisible()
    await lessons.getByRole('radio', { name: '8' }).click()
    await expect(lessons.getByRole('radio', { name: '8' })).toBeChecked()
    await form.getByRole('button', { name: /4\s800 · полностью/ }).click()
    await expect(form.getByLabel('Сумма, сом')).toHaveValue('4800')
    await expect(form).toContainText('Откроется 8 уроков')
    await expect(form).toContainText('полная цена 4\u00a0800')

    // «другое»: out of 1 … 24 is refused before the RPC
    await lessons.getByRole('radio', { name: 'другое' }).click()
    await form.getByLabel('Уроков в абонементе').fill('30')
    await expect(form).toContainText('Уроков — от 1 до 24')
    await lessons.getByRole('radio', { name: '8' }).click()
    await form.getByRole('button', { name: /4\s800 · полностью/ }).click()
    await shot(page, 'record-8', testInfo)

    await form.getByRole('button', { name: /^Записать 4\s800 сом/ }).click()
    await expect(
      page.getByText(
        `Оплата записана: ${name} · 4\u00a0800 сом · Бекзат · абонемент 8 уроков с ${ddmm}`,
      ),
    ).toBeVisible()
    await shot(page, 'toast', testInfo)

    // the database: 8 lessons, 4 800, paid in full
    const { data: subs } = await service()
      .from('subscriptions')
      .select('lessons_total, price_full, price_final, enrollment:enrollments!inner(student_id)')
      .eq('enrollment.student_id', id)
    expect(subs?.map((s) => [s.lessons_total, s.price_full, s.price_final])).toEqual([
      [8, 4800, 4800],
    ])

    // the picker: «осталось 8 из 8»
    const picker = form.getByLabel('Ученик', { exact: true })
    await expect(picker).toContainText('Выберите ученика')
    await picker.click()
    const popup = page.getByRole('dialog', { name: 'Выбор ученика' })
    await popup.getByRole('searchbox', { name: 'Поиск ученика' }).fill(name)
    const option = popup.getByRole('option').filter({ hasText: name })
    await expect(option).toContainText(`Оплачено ${ddmm} · 4\u00a0800`)
    await expect(option).toContainText('осталось 8 из 8')
    await shot(page, 'picker', testInfo)
    await page.keyboard.press('Escape')

    // А6: «8 уроков · 4 800 сом», paid 8 of 8
    await page.goto(`/admin/students/${id}`)
    const card = page.getByRole('region', { name: 'Индивидуально · Бекзат' })
    await expect(card).toContainText(/8 уроков(\s·\s)?4\s800 сом/)
    await expect(card).toContainText('Оплачено 8 из 8')
    await shot(page, 'student', testInfo, true)
  } finally {
    await cleanup(name)
  }
})
