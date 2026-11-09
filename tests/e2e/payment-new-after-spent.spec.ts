import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect as baseExpect, test, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

test.use({ serviceWorkers: 'block' })
test.slow()
// the fixture adds held lessons to ОРТ — other specs must not see them
lockSeed('write')
const expect = baseExpect.configure({ timeout: 15_000 })

const ORT = '00000000-0000-4000-b000-000000000006'
const shot = (testInfo: TestInfo, name: string) =>
  testInfo.outputPath(`${name}-${testInfo.project.name === 'webkit-desktop' ? 1280 : 390}.png`)
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n).replace(/\s/g, ' ')
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

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

/** Raw SQL past the guards — the fixture's held lessons and their marks. */
const sql = (...statements: string[]) =>
  execFileSync(
    'psql',
    [
      localSupabase().dbUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'set session_replication_role = replica',
      ...statements.flatMap((s) => ['-c', s]),
    ],
    { stdio: 'ignore' },
  )

const pupilName = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} Израсходова ${testInfo.repeatEachIndex + 1}`

async function cleanup(fullName: string) {
  const db = service()
  const { data: students } = await db.from('students').select('id').eq('full_name', fullName)
  for (const { id } of students ?? []) {
    sql(
      `with a as (delete from public.attendance where student_id = '${id}' returning lesson_id)
       delete from public.lessons where id in (select lesson_id from a)`,
      `delete from public.payments where subscription_id in (select s.id from public.subscriptions s join public.enrollments e on e.id = s.enrollment_id where e.student_id = '${id}')`,
      `delete from public.subscriptions where enrollment_id in (select id from public.enrollments where student_id = '${id}')`,
      `delete from public.enrollments where student_id = '${id}'`,
      `delete from public.students where id = '${id}'`,
    )
  }
}

/** Каныкей's case (И97): a 12-lesson package paid in full, 20 lessons taken. */
async function makeSpentPupil(fullName: string) {
  const db = service()
  const { data: now } = await db.rpc('bishkek_today')
  const start = new Date(Date.parse(`${String(now)}T00:00:00Z`) - 49 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: tariff, error: te } = await db
    .from('tariffs')
    .select('id, lessons_in_package, package_price')
    .eq('group_type', 'group')
    .lte('valid_from', start)
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()
  if (te) throw te
  const { data: student, error: se } = await db
    .from('students')
    .insert({ full_name: fullName, grade: 7 })
    .select('id')
    .single()
  if (se) throw se
  const { data: enrollment, error: ee } = await db
    .from('enrollments')
    .insert({ student_id: student.id, group_id: ORT, start_date: start })
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
      started_at: start,
    })
    .select('id')
    .single()
  if (error) throw error
  const paid = await (
    await asAdmin()
  ).rpc('record_payment', {
    p_subscription_id: sub.id,
    p_amount: tariff.package_price,
    p_method: 'cash',
    p_paid_on: start,
  })
  if (paid.error) throw paid.error
  // 20 held lessons at an hour no seed lesson uses, one mark each on the package
  sql(`with l as (
    insert into public.lessons (group_id, lesson_date, planned_start, duration_min, status, confirmed_at, teacher_id)
    select g.id, '${start}'::date + i * 2, '22:30', 60, 'held', now(), g.teacher_id
    from public.groups g, generate_series(0, 19) i where g.id = '${ORT}'
    returning id)
    insert into public.attendance (lesson_id, student_id, subscription_id, status)
    select l.id, '${student.id}', '${sub.id}', 'present' from l`)
  return {
    studentId: student.id,
    subscriptionId: sub.id,
    start,
    price: tariff.package_price,
    total: tariff.lessons_in_package,
  }
}

test('А7: израсходованный абонемент → по умолчанию «новый», долг переезжает в него (И97, #127)', async ({
  page,
}, testInfo) => {
  const name = pupilName(testInfo)
  await cleanup(name)
  const pupil = await makeSpentPupil(name)
  const debt = 20 - pupil.total
  try {
    await login(page, KANYKEI)
    await page.goto(`/admin/payments?student=${pupil.studentId}`)
    const form = page.getByRole('form', { name: 'Записать оплату' })
    const what = form.getByLabel('Что оплачивает')
    await expect(what.locator('option:checked')).toHaveText(
      `ОРТ · математика · новый абонемент · долг ${debt} ур. перейдёт в него`,
    )
    await expect(what.locator('option').nth(0)).toContainText(
      `закрыть долг · абонемент с ${dm(pupil.start)} · ${debt} ур.`,
    )
    await expect(form.getByText('Похоже на повтор')).toHaveCount(0)
    await page.screenshot({ path: shot(testInfo, 'r127-pay-new-default'), fullPage: true })

    // the old one picked with a whole package: «переплата» → back to «новый», the sum stays
    await what.selectOption({ index: 0 })
    const amount = form.getByLabel('Сумма, сом')
    await amount.fill(String(pupil.price))
    const over = form.getByRole('status').filter({ hasText: 'Абонемент уже оплачен полностью' })
    await expect(over).toContainText(
      `лишние ${fmt(pupil.price)} сом лучше записать в новый абонемент`,
    )
    await page.screenshot({ path: shot(testInfo, 'r127-overpay'), fullPage: true })
    await over.getByRole('button', { name: 'Записать в новый абонемент' }).click()
    await expect(what.locator('option:checked')).toContainText('новый абонемент')
    await expect(amount).toHaveValue(String(pupil.price))

    await form.getByRole('button', { name: /^Записать/ }).click()
    await expect(page.getByText(`Оплата записана: ${name}`)).toBeVisible()

    const db = service()
    await expect
      .poll(async () => {
        const { data } = await db
          .from('v_student_balance')
          .select('subscription_id, carried_in, lessons_left, debt_lessons')
          .eq('student_id', pupil.studentId)
          .order('started_at')
        return data?.map((b) => [
          Number(b.carried_in),
          Number(b.lessons_left),
          Number(b.debt_lessons),
        ])
      })
      .toEqual([
        [0, 0, 0],
        [debt, pupil.total - debt, 0],
      ])

    // А4: the current package — «4 / 12»
    await page.goto(`/admin/groups/${ORT}`)
    await expect(page.locator('tr, li').filter({ hasText: name }).first()).toContainText(
      `${pupil.total - debt} / ${pupil.total}`,
    )
    await page.screenshot({ path: shot(testInfo, 'r127-group'), fullPage: true })
  } finally {
    await cleanup(name)
  }
})
