import { createClient } from '@supabase/supabase-js'
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// #46 · Пробные занятия, the whole Ж1–Ж8 flow on the phone and on the desktop:
// А11 «Записать на пробное» on Гульзат's lesson tomorrow → Гульзат sees it in «Завтра» (Ж3) →
// the next day (the trial is moved to her lesson today by the service role: the database books and
// marks by its own date, no clock pinning) she marks «Был» on У3 / УД2 → А11 «Прошли, ждут
// решения» → «Оплатил → зачислить» (Ж5) → the lead is a student with a subscription.
// Needs the local stack + `pnpm seed:users`. No lessons or marks are changed, but the trial sits on
// Гульзат's 8 класс А lessons (Вт/Чт/Сб) that teacher-attendance marks — a write lock.

test.use({ serviceWorkers: 'block' })

lockSeed('write')

const GULZAT_TEACHER = '00000000-0000-4000-a000-000000000001'
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

function service() {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// One lead per project and per --repeat-each copy (#38): «Мобиля Пробная 1» → «Мобиля П.»
const leadName = (testInfo: TestInfo) =>
  `${testInfo.project.name === 'webkit-desktop' ? 'Деска' : 'Мобиля'} Пробная ${testInfo.repeatEachIndex + 1}`

async function cleanup(fullName: string) {
  const db = service()
  const { data: trials } = await db.from('trials').select('id').eq('full_name', fullName)
  if (trials?.length)
    await db
      .from('trials')
      .delete()
      .in(
        'id',
        trials.map((t) => t.id),
      )
  const { data: students } = await db.from('students').select('id').eq('full_name', fullName)
  for (const { id } of students ?? []) {
    const { data: enrollments } = await db.from('enrollments').select('id').eq('student_id', id)
    const ids = (enrollments ?? []).map((e) => e.id)
    if (ids.length > 0) {
      await db.from('subscriptions').delete().in('enrollment_id', ids)
      await db.from('enrollments').delete().in('id', ids)
    }
    await db.from('students').delete().eq('id', id)
  }
}

interface LessonRef {
  id: string
  group_id: string
  lesson_date: string
  planned_start: string
  /** «Математика · 8 класс А» */
  group_label: string
}

/** Гульзат's first planned lesson on `day` (from the given hour on), or null. */
async function gulzatLesson(day: string, fromHour = '00:00'): Promise<LessonRef | null> {
  const { data, error } = await service()
    .from('lessons')
    .select(
      'id, group_id, lesson_date, planned_start, group:groups!inner(teacher_id, name, subject:subjects(name))',
    )
    .eq('group.teacher_id', GULZAT_TEACHER)
    .eq('lesson_date', day)
    .eq('status', 'planned')
    .gte('planned_start', fromHour)
    .order('planned_start')
    .limit(1)
  if (error) throw error
  const l = data.at(0)
  return l
    ? {
        id: l.id,
        group_id: l.group_id,
        lesson_date: l.lesson_date,
        planned_start: l.planned_start,
        group_label: `${l.group.subject.name} · ${l.group.name}`,
      }
    : null
}

async function bishkekToday(): Promise<string> {
  const { data, error } = await service().rpc('bishkek_today')
  if (error) throw error
  return data
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

async function openTrials(page: Page) {
  if (isDesktop(page)) {
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('link', { name: 'Пробные занятия' })
      .click()
  } else {
    await page
      .getByRole('navigation', { name: 'Основное меню' })
      .getByRole('button', { name: 'Ещё' })
      .click()
    await page.getByRole('dialog', { name: 'Ещё' }).getByRole('link', { name: 'Пробные' }).click()
  }
  await expect(page).toHaveURL(/\/admin\/trials/)
  await expect(page.getByRole('heading', { name: 'Пробные занятия' })).toBeVisible()
}

async function newPage(browser: Browser, testInfo: TestInfo) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } =
    testInfo.project.use
  const context = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    baseURL,
    serviceWorkers: 'block',
  })
  return context.newPage()
}

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

test('Ж1–Ж8: записать → учитель видит завтра → «Был» → «Оплатил → зачислить»', async ({
  page,
  browser,
}, testInfo) => {
  const today = await bishkekToday()
  const tomorrow = await gulzatLesson(addDays(today, 1))
  // the lesson Гульзат marks: today and not over yet in most runs; any planned lesson of today works
  const todayLesson = await gulzatLesson(today)
  test.skip(
    !tomorrow || !todayLesson,
    'Гульзат has no lessons today or tomorrow (Sunday / Saturday)',
  )
  if (!tomorrow || !todayLesson) return

  const name = leadName(testInfo)
  const short = `${name.split(' ')[0]} П.`
  await cleanup(name)
  try {
    // ── А11: book the lead on tomorrow's lesson ─────────────────────────────
    await login(page, KANYKEI)
    await openTrials(page)
    await expect(page.getByRole('tab', { name: /^Предстоящие · \d+$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Seed: Бакай did not come — «Позвонить» (Ж8)
    await page.getByRole('tab', { name: /^Прошли, ждут решения · \d+$/ }).click()
    await expect(page).toHaveURL(/tab=waiting/)
    const waiting = page.getByRole('region', { name: 'Прошли пробное — ждут решения' })
    await expect(waiting).toContainText('позвонить — ждать ли на следующий?')
    await expect(waiting.getByRole('link', { name: '0555 303 303' })).toHaveAttribute(
      'href',
      'tel:+996555303303',
    )
    await expect(
      waiting.getByRole('button', { name: 'Записать заново: Бакай Осмонов' }),
    ).toBeVisible()
    await expect(waiting.getByRole('button', { name: 'Закрыть: Бакай Осмонов' })).toBeVisible()
    await page.getByRole('tab', { name: /^Предстоящие/ }).click()

    if (!isDesktop(page)) await page.getByRole('button', { name: '+ Записать на пробное' }).click()
    const form = page.getByRole('form', { name: 'Записать на пробное' })
    await form.getByLabel('Имя ученика').fill(name)
    await form.getByLabel('Телефон родителя').fill('0555 46 46 46')
    await form.getByLabel('Класс').selectOption('8')
    await form.getByLabel('Группа').selectOption(tomorrow.group_id)
    await form.getByLabel('Занятие').selectOption(tomorrow.id)
    await expect(form.getByLabel('Занятие')).toContainText('завтра')
    await form.getByLabel('Откуда узнали').selectOption({ label: 'Instagram' })
    await expect(form).toContainText('Гульзат увидит пробного в списке на это занятие')
    await form.getByRole('button', { name: 'Записать на пробное' }).click()
    await expect(page.getByText(`Записали на пробное: ${name}`)).toBeVisible()

    // One row per lesson: with Адема (seed) or the other project on the same lesson the row is
    // folded to «N учеников» — unfold it (06-design: групповая запись свёрнута).
    const upcoming = page.getByRole('region', { name: 'Предстоящие' })
    const when = `Завтра ${tomorrow.planned_start.slice(0, 5)}`
    const row = upcoming
      .getByRole(isDesktop(page) ? 'row' : 'listitem')
      .filter({ hasText: when })
      .filter({ hasText: tomorrow.group_label })
    await expect(row).toContainText('пробный')
    const unfold = row.getByRole('button', { name: 'развернуть ▾' })
    if ((await unfold.count()) > 0) {
      await unfold.click()
      await expect(upcoming).toContainText(`${name} · 0555 464 646`)
    } else {
      await expect(row).toContainText(isDesktop(page) ? short : name)
      await expect(row).toContainText('0555 464 646')
    }
    await page.screenshot({ path: shot(testInfo, 'trials'), fullPage: true })

    // ── Гульзат sees tomorrow's trial in advance (Ж3) ──────────────────────
    const teacher = await newPage(browser, testInfo)
    await login(teacher, GULZAT)
    await expect(teacher).toHaveURL(/\/today$/)
    const tomorrowBlock = isDesktop(teacher)
      ? teacher.getByRole('region', { name: 'Завтра пробные' })
      : teacher.getByRole('list', { name: 'Завтра' })
    await expect(tomorrowBlock).toContainText(short)
    await expect(tomorrowBlock).toContainText('пробный')
    await teacher.screenshot({ path: shot(testInfo, 'teacher-tomorrow'), fullPage: true })

    // ── next day: the trial is on her lesson today, she marks «Был» ────────
    const { error } = await service()
      .from('trials')
      .update({ lesson_id: todayLesson.id })
      .eq('full_name', name)
    expect(error).toBeNull()
    await teacher.goto(`/lessons/${todayLesson.id}`)
    const section = teacher.getByRole('region', { name: /^Пробные · \d+$/ })
    await expect(section).toContainText('не списывается')
    const item = section.getByRole('listitem', { name: `Пробный: ${name}` })
    await expect(item).toContainText('пробное занятие · первый раз')
    await item.getByRole('button', { name: 'Был' }).click()
    await expect(item.getByRole('button', { name: 'Был' })).toHaveAttribute('aria-pressed', 'true')
    await expect(teacher.getByText(/· \+\d+ пробн(ый|ых)$/).first()).toBeVisible()
    await teacher.screenshot({ path: shot(testInfo, 'teacher-lesson'), fullPage: true })
    await teacher.context().close()

    // ── А11: «Прошли, ждут решения» → «Оплатил → зачислить» (Ж5) ──────────
    await page.getByRole('tab', { name: /^Прошли, ждут решения/ }).click()
    await expect(waiting).toContainText(isDesktop(page) ? short : name)
    await expect(waiting).toContainText('Был(а)')
    await waiting.getByRole('button', { name: `Оплатил → зачислить: ${name}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Зачислить в группу' })
    await expect(dialog).toContainText(`${name} · был(а) на пробном`)
    await expect(dialog.getByRole('status', { name: 'Абонемент' })).toContainText('Цена абонемента')
    await page.screenshot({ path: shot(testInfo, 'trials-enroll') })
    await dialog.getByRole('button', { name: 'Зачислить' }).click()
    await expect(page.getByText(`${name} зачислен(а) в группу`)).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(waiting.getByRole('button', { name: `Оплатил → зачислить: ${name}` })).toHaveCount(
      0,
    )

    await page.getByRole('tab', { name: 'Конверсия за месяц' }).click()
    const month = page.getByRole('list', { name: 'Пробные месяца' })
    await expect(month.getByRole('listitem').filter({ hasText: name })).toContainText(
      'Оплатил · зачислен(а)',
    )

    // the lead became a student with an enrollment from the next lesson and a subscription
    const { data } = await service()
      .from('trials')
      .select(
        'status, student:students!trials_student_id_fkey(full_name, parent_phone, enrollments(start_date, group_id, subscriptions(id)))',
      )
      .eq('full_name', name)
      .single()
    expect(data?.status).toBe('enrolled')
    expect(data?.student?.parent_phone).toBe('996555464646')
    const enrollment = data?.student?.enrollments[0]
    expect(enrollment?.group_id).toBe(todayLesson.group_id)
    expect(enrollment && enrollment.start_date > today).toBe(true)
    expect(enrollment?.subscriptions).toHaveLength(1)
  } finally {
    await cleanup(name)
  }
})

test('А1 «Пробные», А4 trials of the group and «+ На пробное» → А11 with the group', async ({
  page,
}, testInfo) => {
  const today = await bishkekToday()
  const { data: adema } = await service()
    .from('trials')
    .select('group_id, lesson:lessons!inner(lesson_date, planned_start)')
    .eq('full_name', 'Адема Кадырова')
    .single()
  if (!adema) throw new Error('seed: Адема Кадырова is booked on 8 класс А')

  await login(page, KANYKEI)
  const widget = page.getByRole('region', { name: 'Пробные' })
  await expect(widget).toBeVisible()
  if (adema.lesson.lesson_date === addDays(today, 1)) {
    await expect(widget).toContainText(
      `Завтра ${adema.lesson.planned_start.slice(0, 5)} · Адема К.`,
    )
  }
  await page.screenshot({ path: shot(testInfo, 'dashboard'), fullPage: true })

  // А4: «8 / 10 + 2 пробных», the trial rows with their decisions; trials never join the roster
  await page.goto(`/admin/groups/${adema.group_id}`)
  await expect(page.getByRole('heading', { name: 'Математика · 8 класс А' })).toBeVisible()
  await expect(page.getByText(/^\+ \d+ пробн(ый|ых)$/).first()).toBeVisible()
  if (isDesktop(page)) {
    await expect(page.getByTestId('trial-separator')).toContainText(/Пробные · \d+ · не входят в/)
    await expect(page.getByTestId('trial-row').filter({ hasText: 'Адема Кадырова' })).toContainText(
      'ещё не был',
    )
    await expect(
      page.getByRole('button', { name: 'Оплатил → зачислить: Бермет Токтогулова' }),
    ).toBeVisible()
  } else {
    const cards = page.getByRole('list', { name: 'Пробные группы' })
    await expect(cards).toContainText('Адема Кадырова')
    await expect(cards).toContainText('Бермет Токтогулова')
  }
  await page.screenshot({ path: shot(testInfo, 'group'), fullPage: true })

  await page.getByRole('link', { name: '+ На пробное' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/trials\\?group=${adema.group_id}`))
  if (!isDesktop(page)) {
    await expect(page.getByRole('dialog', { name: 'Записать на пробное' })).toBeVisible()
  }
  await expect(
    page.getByRole('form', { name: 'Записать на пробное' }).getByLabel('Группа'),
  ).toHaveValue(adema.group_id)
})
