import { createClient } from '@supabase/supabase-js'
import { devices, expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import {
  formatHours,
  isoWeekday,
  monthAccusative,
  monthPrepositional,
  monthQuote,
  monthStart,
  tariffHourPrice,
} from '../../src/features/afterschool/model'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, submitLogin, type Credentials } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { wipeFixtures } from './support/undo-fixtures'

// #82 · продлёнка по часам on the phone (390) and the desktop (1280): the admin enrolls a pupil in an
// after-school group with the plan ПН 2 / СР 1 / ПТ 2 → the first month's invoice in hours × hour
// price → «Записать оплату» of that invoice → the teacher marks a past Monday/Friday «Был» → the mark
// carries 2 h of the invoice, «Мой месяц» shows the student-hours and the pay grows by
// 2 h × hour price × 45 %.
// Each project makes its own after-school group (Нургуль) and pupil, removed again at the end. The
// group's past lessons are unconfirmed while the test runs (А1 counts them) — the seed lock.

test.use({ serviceWorkers: 'block' })
lockSeed('write')

const NURGUL = { phone: '555 201 004', password: 'iqup-demo' }
const SEED_AFTERSCHOOL = '00000000-0000-4000-b000-000000000005'
const PLAN = [2, 0, 1, 0, 2, 0, 0]

// the RPCs run against a busy local stack — the toasts and the saved state get more time
const slow = expect.configure({ timeout: 15_000 })

/** login() of support/auth with the busy-stack timeouts. */
async function signIn(page: Page, user: Credentials) {
  await submitLogin(page, user)
  await slow(page).not.toHaveURL(/\/login$/)
  await slow(page.getByRole('main')).toBeVisible()
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const shot = (page: Page, testInfo: TestInfo, name: string) =>
  testInfo.outputPath(`${name}-${isDesktop(page) ? '1280' : '390'}.png`)

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const suffix = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'деск' : 'моб'} ${testInfo.repeatEachIndex + 1}`

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
/** «12 октября» — formatDayMonth of the app (its module pulls in the Supabase client). */
const formatDayMonth = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${GEN[Number(iso.slice(5, 7)) - 1]}`
const ru = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/** Everything the test made (#104: one shared wipe, errors surface). */
function cleanup(groupName: string, pupil: string) {
  wipeFixtures([groupName], [pupil])
}

test('продлёнка: график ПН 2 / СР 1 / ПТ 2 → счёт за месяц → оплата → отметка → ЗП учителя', async ({
  page,
  browser,
}, testInfo) => {
  // four screens and two users in one flow
  test.setTimeout(240_000)
  const groupName = `e2e продлёнка ${suffix(testInfo)}`
  const pupil = `Часова ${suffix(testInfo)}`
  cleanup(groupName, pupil)
  const db = service()
  try {
    // ─── fixtures: Нургуль's new after-school group, Mon–Fri 13:00, from the 1st of the month of the
    // Monday / Friday the teacher marks (a mark goes to the invoice of its month, #82 review) ───
    const { data: todayData } = await db.rpc('bishkek_today')
    const today = String(todayData)
    const markDay = [1, 2, 3, 4, 5, 6, 7]
      .map((n) => addDays(today, -n))
      .find((d) => [1, 5].includes(isoWeekday(d)))
    if (!markDay) throw new Error('no Monday / Friday in the last week')
    const start = monthStart(markDay)
    const { data: seedGroup, error: ge } = await db
      .from('groups')
      .select('teacher_id, subject_id')
      .eq('id', SEED_AFTERSCHOOL)
      .single()
    if (ge) throw ge
    const { data: group, error: ce } = await db
      .from('groups')
      .insert({
        name: groupName,
        subject_id: seedGroup.subject_id,
        grade: 3,
        group_type: 'afterschool',
        teacher_id: seedGroup.teacher_id,
        start_date: start,
        status: 'active',
      })
      .select('id')
      .single()
    if (ce) throw ce
    const { error: re } = await db.from('schedule_rules').insert(
      [1, 2, 3, 4, 5].map((weekday) => ({
        group_id: group.id,
        weekday,
        start_time: '13:00',
        valid_from: start,
      })),
    )
    if (re) throw re
    const { error: le } = await db.rpc('generate_lessons', {
      p_group_id: group.id,
      p_until: addDays(today, 70),
    })
    if (le) throw le
    const { data: student, error: se } = await db
      .from('students')
      .insert({ full_name: pupil, grade: 3 })
      .select('id')
      .single()
    if (se) throw se

    // what the invoice must say: the start month's lesson days × the plan, × the hour price
    const { data: lessons } = await db
      .from('lessons')
      .select('id, lesson_date, status')
      .eq('group_id', group.id)
      .neq('status', 'cancelled')
    const dates = (lessons ?? []).map((l) => l.lesson_date)
    const month = monthStart(start)
    const quote = monthQuote(dates, [{ valid_from: start, hours: PLAN }], month, start)
    const { data: tariff, error: tariffError } = await db
      .from('tariffs')
      .select('package_price, lessons_in_package, lesson_duration_min, hour_price')
      .eq('group_type', 'afterschool')
      .lte('valid_from', start)
      .order('valid_from', { ascending: false })
      .limit(1)
      .single()
    if (tariffError) throw tariffError
    const hourPrice = tariffHourPrice(tariff)
    const price = Math.round(quote.hours * hourPrice)
    const som = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ')

    // ─── А6: «Зачислить в группу» with the plan ─────────────────────────────
    await signIn(page, KANYKEI)
    await page.goto(`/admin/students/${student.id}`)
    await expect(page.getByRole('heading', { name: pupil })).toBeVisible()
    await page
      .getByRole('button', { name: /Зачислить в группу/ })
      .first()
      .click()
    const form = page.getByRole('form', { name: 'Зачислить в группу' })
    await form.getByLabel('Группа').selectOption(group.id)
    await form.getByLabel('Дата начала').fill(ru(start))
    const days = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'] as const
    for (const [i, d] of days.entries()) {
      await form.getByLabel(`${d}, часов`).selectOption(String(PLAN[i]))
    }
    const bill = form.getByRole('status', { name: 'Абонемент' })
    await expect(bill).toContainText(
      `≈ ${formatHours(quote.hours)} ч в ${monthPrepositional(month)}`,
    )
    await expect(bill).toContainText(`${formatHours(quote.hours)} ч × ${som(hourPrice)} сом`)
    await expect(bill).toContainText(`${som(price)} сом`)
    await page.screenshot({ path: shot(page, testInfo, 'afterschool-enroll') })
    await form.getByRole('button', { name: 'Зачислить' }).click()
    await slow(page.getByText(`${pupil} зачислен(а) в группу`)).toBeVisible()

    // the card: the plan and the invoice of the start month
    const panel = page.getByLabel('Продлёнка по часам').first()
    await slow(panel).toContainText('ПН 2 · СР 1 · ПТ 2 ч')
    await expect(panel).toContainText(`Счёт выставлен · ${formatHours(quote.hours)} ч`)
    const { data: invoice } = await db
      .from('subscriptions')
      .select(
        'id, hours_total, price_final, period_month, enrollment:enrollments!inner(student_id)',
      )
      .eq('enrollment.student_id', student.id)
      .single()
    expect(invoice).toMatchObject({
      hours_total: quote.hours,
      price_final: price,
      period_month: month,
    })
    await page.screenshot({ path: shot(page, testInfo, 'afterschool-student'), fullPage: true })

    // ─── А7: the invoice paid in full ───────────────────────────────────────
    await page.goto(`/admin/payments?student=${student.id}`)
    const pay = page.getByRole('form', { name: 'Записать оплату' })
    await expect(pay.getByLabel('Что оплачивает')).toContainText(
      `счёт за ${monthAccusative(month)}`,
    )
    await expect(
      pay.getByText(`Счёт за ${monthAccusative(month)}: осталось ${formatHours(quote.hours)} из`),
    ).toBeVisible()
    await pay.getByLabel('Сумма, сом').fill(String(price))
    await pay.getByRole('button', { name: /^Записать/ }).click()
    await slow(page.getByText(`Оплата записана: ${pupil}`)).toBeVisible()

    // ─── the teacher marks a past Monday / Friday «Был» (2 h) ───────────────
    const lesson = (lessons ?? []).find((l) => l.lesson_date === markDay)
    if (!lesson) throw new Error(`no lesson on ${markDay} (a holiday?)`)
    const before = await db
      .from('v_payroll_preview')
      .select('student_hours, base_amount')
      .eq('teacher_id', seedGroup.teacher_id)
      .eq('month', monthStart(lesson.lesson_date))
      .maybeSingle()

    // the teacher on her own device
    const teacherContext = await browser.newContext({
      ...(isDesktop(page) ? devices['Desktop Safari'] : devices['iPhone 13']),
      viewport: page.viewportSize(),
      baseURL: new URL(page.url()).origin,
      serviceWorkers: 'block',
    })
    const teacher = await teacherContext.newPage()
    await signIn(teacher, NURGUL)
    await teacher.goto(`/lessons/${lesson.id}`)
    const students = teacher.getByRole('list', { name: 'Ученики' }).getByRole('listitem')
    await expect(students).toHaveCount(1)
    await expect(students.first()).toContainText(pupil)
    await expect(students.first()).toContainText(' ч · заморозок')
    await students.first().getByRole('button', { name: 'Был', exact: true }).click()
    await teacher.screenshot({ path: shot(teacher, testInfo, 'afterschool-mark') })
    await teacher.getByRole('button', { name: 'Подтвердить занятие' }).click()
    await slow(teacher).not.toHaveURL(new RegExp(`/lessons/${lesson.id}$`))

    const { data: mark } = await db
      .from('attendance')
      .select('hours, subscription_id, status')
      .eq('lesson_id', lesson.id)
      .single()
    expect(mark).toEqual({ hours: 2, subscription_id: invoice?.id, status: 'present' })

    // ─── ЗП: 2 h × hour price × 45 % on top of what the teacher had ─────────
    const after = await db
      .from('v_payroll_preview')
      .select('student_hours, base_amount')
      .eq('teacher_id', seedGroup.teacher_id)
      .eq('month', monthStart(lesson.lesson_date))
      .single()
    expect((after.data?.student_hours ?? 0) - (before.data?.student_hours ?? 0)).toBe(2)
    const exact = (price * 2 * 45) / (quote.hours * 100)
    expect(
      Math.abs((after.data?.base_amount ?? 0) - (before.data?.base_amount ?? 0) - exact),
    ).toBeLessThanOrEqual(1)

    await teacher.goto(`/my-month?month=${monthStart(lesson.lesson_date).slice(0, 7)}`)
    await expect(teacher.getByText(/2 ученико-ч продлёнки|2 уч-ч/).first()).toBeVisible()
    await teacher.screenshot({
      path: shot(teacher, testInfo, 'afterschool-my-month'),
      fullPage: true,
    })
    await teacherContext.close()

    // ─── А6: the plan from that day, in the past — the warning with the money, a reason ─────
    await page.goto(`/admin/students/${student.id}`)
    await slow(page.getByLabel('Продлёнка по часам').first()).toContainText('ПН 2 · СР 1 · ПТ 2 ч')
    await page.getByRole('button', { name: 'Изменить с даты' }).first().click()
    const planForm = page.getByRole('form', { name: 'График продлёнки' })
    await planForm.getByLabel('Действует с').fill(ru(markDay))
    const dayLabel = isoWeekday(markDay) === 1 ? 'ПН' : 'ПТ'
    await planForm.getByLabel(`${dayLabel}, часов`).selectOption('3')
    const warning = planForm.getByRole('alert')
    await slow(warning).toContainText(
      `Изменятся часы проведённых занятий с ${formatDayMonth(markDay)}: 1 отметка, +1 ч`,
    )
    const payDelta = Math.round((price * 1 * 45) / (quote.hours * 100))
    await expect(warning).toContainText(`ЗП учителя +${som(payDelta)} сом`)
    await planForm.getByRole('button', { name: 'Сохранить график' }).click()
    await expect(planForm.getByText('Дата в прошлом — укажите причину')).toBeVisible()
    await planForm.getByLabel('Причина (в журнал)').fill('e2e: график внесён задним числом')
    await page.screenshot({ path: shot(page, testInfo, 'afterschool-plan-past') })
    await planForm.getByRole('button', { name: 'Сохранить график' }).click()
    await slow(page.getByText(`График изменён с ${formatDayMonth(markDay)}`)).toBeVisible()
    const { data: repriced } = await db
      .from('attendance')
      .select('hours')
      .eq('lesson_id', lesson.id)
      .single()
    expect(repriced).toEqual({ hours: 3 })
  } finally {
    cleanup(groupName, pupil)
  }
})
