import { createClient } from '@supabase/supabase-js'
import { devices, expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { isoWeekday } from '../../src/features/afterschool/model'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, submitLogin, type Credentials } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { wipeFixtures } from './support/undo-fixtures'

// #111 (К13) · продлёнка — пакет дней, on the phone (390) and the desktop (1280): the admin enrolls a
// pupil in an after-school group with the plan ВТ/СР/ЧТ, 12 days for 5 400 → the teacher does not see
// the pupil on a past Monday (0 h), marks a past Tuesday «Был» → А6 «1 из 12» → «Изменить с даты» back
// to that Tuesday without ВТ: the preview says the mark goes and the teacher loses 202,5 → the mark is
// deleted. Each project makes its own after-school group (Нургуль) and pupil, removed at the end; the
// group's past lessons change Нургуль's month while the spec runs — the seed lock.

test.use({ serviceWorkers: 'block' })
lockSeed('write')

const NURGUL = { phone: '555 201 004', password: 'iqup-demo' }
const SEED_AFTERSCHOOL = '00000000-0000-4000-b000-000000000005'

// the RPCs run against a busy local stack — the toasts and the saved state get more time
const slow = expect.configure({ timeout: 15_000 })

async function signIn(page: Page, user: Credentials) {
  await submitLogin(page, user)
  await slow(page).not.toHaveURL(/\/login$/)
  await slow(page.getByRole('main')).toBeVisible()
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const size = (page: Page) => (isDesktop(page) ? 1280 : 390)
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r111-${name}-${size(page)}.png`, fullPage })
}

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

test('продлёнка: 12 дней за 5 400, ВТ/СР/ЧТ → ПН без ученика, ВТ «Был» → 1 из 12 → график назад удаляет отметку', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const groupName = `e2e продлёнка дни ${suffix(testInfo)}`
  const pupil = `Днева ${suffix(testInfo)}`
  wipeFixtures([groupName], [pupil])
  const db = service()
  try {
    // ─── fixtures: Нургуль's new after-school group, Mon–Fri 13:00, from the Monday before the last
    // past Tuesday ───────────────────────────────────────────────────────────
    const { data: todayData } = await db.rpc('bishkek_today')
    const today = String(todayData)
    const tuesday = [1, 2, 3, 4, 5, 6, 7]
      .map((n) => addDays(today, -n))
      .find((d) => isoWeekday(d) === 2)
    if (!tuesday) throw new Error('no Tuesday in the last week')
    const monday = addDays(tuesday, -1)
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
        start_date: monday,
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
        valid_from: monday,
      })),
    )
    if (re) throw re
    const { error: le } = await db.rpc('generate_lessons', {
      p_group_id: group.id,
      p_until: addDays(today, 30),
    })
    if (le) throw le
    const { data: student, error: se } = await db
      .from('students')
      .insert({ full_name: pupil, grade: 3 })
      .select('id')
      .single()
    if (se) throw se
    const { data: lessons } = await db
      .from('lessons')
      .select('id, lesson_date')
      .eq('group_id', group.id)
    const lessonOn = (d: string) => {
      const l = (lessons ?? []).find((x) => x.lesson_date === d)
      if (!l) throw new Error(`no lesson on ${d} (a holiday?)`)
      return l.id
    }

    // ─── А6: «Зачислить в группу» — ВТ/СР/ЧТ, 12 days for 5 400 ─────────────
    await signIn(page, KANYKEI)
    await page.goto(`/admin/students/${student.id}`)
    await expect(page.getByRole('heading', { name: pupil })).toBeVisible()
    await page
      .getByRole('button', { name: /Зачислить в группу/ })
      .first()
      .click()
    const form = page.getByRole('form', { name: 'Зачислить в группу' })
    await form.getByLabel('Группа').selectOption(group.id)
    await form.getByLabel('Дата начала').fill(ru(monday))
    const plan = { ПН: '0', ВТ: '3', СР: '3', ЧТ: '3', ПТ: '0' } as const
    for (const [d, h] of Object.entries(plan)) {
      await form.getByLabel(`${d}, часов`).selectOption(h)
    }
    await form.getByRole('radiogroup', { name: 'Дней' }).getByRole('radio', { name: '12' }).click()
    await form.getByLabel('Цена, сом').fill('5400')
    const bill = form.getByRole('status', { name: 'Абонемент' })
    await expect(bill).toContainText(`12 дней · с ${formatDayMonth(monday)}`)
    await expect(bill).toContainText('Своя цена')
    await expect(bill).toContainText('5 400 сом')
    await shot(page, 'enroll')
    await form.getByRole('button', { name: 'Зачислить' }).click()
    await slow(page.getByText(`${pupil} зачислен(а) в группу`)).toBeVisible()

    const panel = page.getByLabel('График продлёнки').first()
    await slow(panel).toContainText('ВТ 3 · СР 3 · ЧТ 3 ч')
    await expect(panel).toContainText('на цену не влияет')
    const { data: sub } = await db
      .from('subscriptions')
      .select('id, lessons_total, price_full, hours_total, enrollment:enrollments!inner(student_id)')
      .eq('enrollment.student_id', student.id)
      .single()
    expect(sub).toMatchObject({ lessons_total: 12, price_full: 5400, hours_total: null })

    // ─── the teacher: Monday — not on the roster (0 h); Tuesday — «Был» ─────
    const teacherContext = await browser.newContext({
      ...(isDesktop(page) ? devices['Desktop Safari'] : devices['iPhone 13']),
      viewport: page.viewportSize(),
      baseURL: new URL(page.url()).origin,
      serviceWorkers: 'block',
    })
    const teacher = await teacherContext.newPage()
    await signIn(teacher, NURGUL)
    // the post-login redirect lands on «Сегодня» — a goto before it is interrupted by it (#104)
    await slow(teacher).toHaveURL(/\/today$/)
    await teacher.goto(`/lessons/${lessonOn(monday)}`)
    await slow(teacher.getByText(groupName).first()).toBeVisible()
    await expect(teacher.getByText(pupil)).toHaveCount(0)

    await teacher.goto(`/lessons/${lessonOn(tuesday)}`)
    const students = teacher.getByRole('list', { name: 'Ученики' }).getByRole('listitem')
    await slow(students).toHaveCount(1)
    await expect(students.first()).toContainText(pupil)
    await students.first().getByRole('button', { name: 'Был', exact: true }).click()
    await teacher.getByRole('button', { name: 'Подтвердить занятие' }).click()
    await slow(teacher).not.toHaveURL(new RegExp(`/lessons/${lessonOn(tuesday)}$`))
    await teacherContext.close()
    const { data: mark } = await db
      .from('attendance')
      .select('subscription_id, status, consumes_credit')
      .eq('lesson_id', lessonOn(tuesday))
      .single()
    expect(mark).toEqual({ subscription_id: sub?.id, status: 'present', consumes_credit: true })

    // ─── А6: «1 из 12» ──────────────────────────────────────────────────────
    await page.goto(`/admin/students/${student.id}`)
    const card = page.getByRole('region', { name: `Продлёнка · ${groupName}` }).first()
    await slow(card).toContainText('1 из 12')
    await expect(card).toContainText('12 дней')
    await shot(page, 'a6', true)

    // ─── «Изменить с даты» back to that Tuesday without ВТ: the mark goes ───
    await page.getByRole('button', { name: 'Изменить с даты' }).first().click()
    const planForm = page.getByRole('form', { name: 'График продлёнки' })
    await planForm.getByLabel('Действует с').fill(ru(tuesday))
    await planForm.getByLabel('ВТ, часов').selectOption('0')
    const warning = planForm.getByRole('alert')
    await slow(warning).toContainText(
      `Удалится 1 отметка за ВТ с ${formatDayMonth(tuesday)} — в эти дни по графику 0 ч`,
    )
    await expect(warning).toContainText(/Нургуль Токтоева −20[23] сом за /)
    await planForm.getByLabel('Причина (в журнал)').fill('e2e: ВТ не ходит')
    await shot(page, 'plan-past')
    await planForm.getByRole('button', { name: 'Сохранить график' }).click()
    await slow(page.getByText(`График изменён с ${formatDayMonth(tuesday)}`)).toBeVisible()
    const { data: left } = await db
      .from('attendance')
      .select('id')
      .eq('lesson_id', lessonOn(tuesday))
    expect(left).toEqual([])
    await slow(card).toContainText('0 из 12')
  } finally {
    wipeFixtures([groupName], [pupil])
  }
})
