import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// #54 · Пробный задним числом: a former pupil came to Гульзат's lesson without a booking. The admin
// books them on А11 with «Уже был(а)» on a lesson that already took place → the trial is marked
// «Был(а)» at once («Прошли, ждут решения»), the journal shows it as «задним числом» (retro), and
// «Оплатил → зачислить» on А4 offers the former pupil's 15 % (В5) and enrolls the existing student —
// no duplicate. Needs the local stack + `pnpm seed:users`. The trial sits on Гульзат's 8 класс А
// lessons that teacher-attendance marks — a write lock, like admin-trials.spec.

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

const person = (testInfo: TestInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const n = testInfo.repeatEachIndex + 1
  return {
    name: `${desktop ? 'Деска' : 'Мобиля'} Вернулась ${n}`,
    phone: desktop ? `05555454${10 + n}` : `05555454${50 + n}`,
  }
}

async function cleanup(fullName: string) {
  const db = service()
  await db.from('trials').delete().eq('full_name', fullName)
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

/** Гульзат's latest lesson that took place before today (planned or held, not cancelled). */
async function gulzatPastLesson() {
  const { data, error } = await service()
    .from('lessons')
    .select('id, group_id, lesson_date, group:groups!inner(teacher_id, name)')
    .eq('group.teacher_id', GULZAT_TEACHER)
    .eq('group.name', '8 класс А')
    .in('status', ['planned', 'held'])
    .lt('lesson_date', await bishkekToday())
    .order('lesson_date', { ascending: false })
    .limit(1)
  if (error) throw error
  const l = data.at(0)
  if (!l) throw new Error('seed: 8 класс А has lessons before today')
  return l
}

async function bishkekToday(): Promise<string> {
  const { data, error } = await service().rpc('bishkek_today')
  if (error) throw error
  return data
}

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

test('«Уже был(а)»: запись задним числом → ждут решения → журнал → зачисление бывшего ученика', async ({
  page,
}, testInfo) => {
  const { name, phone } = person(testInfo)
  const normalized = `996${phone.slice(1)}`
  const lesson = await gulzatPastLesson()
  await cleanup(name)
  try {
    // a former pupil (15 % on the first subscription, В5)
    const { error } = await service()
      .from('students')
      .insert({ full_name: name, grade: 8, parent_phone: normalized, is_returning: true })
    expect(error).toBeNull()

    await login(page, KANYKEI)
    // «?group=» opens the form with the group (on the phone — the sheet over the page)
    await page.goto(`/admin/trials?group=${lesson.group_id}`)
    if (!isDesktop(page)) {
      await expect(page.getByRole('dialog', { name: 'Записать на пробное' })).toBeVisible()
    }
    const form = page.getByRole('form', { name: 'Записать на пробное' })
    await form.getByLabel('Имя ученика').fill(name)
    await form.getByLabel('Телефон родителя').fill(phone)
    await expect(form).toContainText(`Этот телефон уже есть в учениках: ${name}`)
    await form.getByLabel('Класс').selectOption('8')
    await expect(form.getByLabel('Группа')).toHaveValue(lesson.group_id)

    const toggle = form.getByRole('switch', { name: /Уже был\(а\) на занятии/ })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(form).toContainText('в журнале — правка задним числом')
    await form.getByLabel('Занятие').selectOption(lesson.id)
    await page.screenshot({
      path: shot(testInfo, 'trials-backdated-form'),
      fullPage: true,
      animations: 'disabled',
    })
    await form.getByRole('button', { name: 'Записать на пробное' }).click()
    await expect(page.getByText(`Записали задним числом, был(а): ${name}`)).toBeVisible()

    // straight to «Прошли, ждут решения» as «Был(а)»
    await expect(page).toHaveURL(/tab=waiting/)
    const waiting = page.getByRole('region', { name: 'Прошли пробное — ждут решения' })
    await expect(
      waiting.getByRole('button', { name: `Оплатил → зачислить: ${name}` }),
    ).toBeVisible()
    await page.screenshot({ path: shot(testInfo, 'trials-backdated-waiting'), fullPage: true })

    const { data: trial } = await service()
      .from('trials')
      .select('status, came, marked_by, lesson_id')
      .eq('full_name', name)
      .single()
    expect(trial).toMatchObject({ status: 'attended', came: true, lesson_id: lesson.id })
    expect(trial?.marked_by).not.toBeNull()

    // А10: «Правки задним числом»
    await page.goto('/admin/audit?kind=retro')
    await expect(page.getByText(`${name} — записан(а) задним числом`).first()).toBeVisible()

    // А4: «Оплатил → зачислить» — the former pupil's 15 % is available, the student is reused
    await page.goto(`/admin/groups/${lesson.group_id}`)
    await page.getByRole('button', { name: `Оплатил → зачислить: ${name}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Зачислить в группу' })
    const returning = dialog.getByRole('button', { name: /^15 %/ })
    await expect(returning).toBeEnabled()
    await returning.click()
    await expect(returning).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: shot(testInfo, 'group-enroll-returning') })
    await dialog.getByRole('button', { name: 'Зачислить' }).click()
    await expect(page.getByText(`${name} зачислен(а) в группу`)).toBeVisible()

    const { data: students } = await service()
      .from('students')
      .select('id, enrollments(subscriptions(discount_percent))')
      .eq('full_name', name)
    expect(students).toHaveLength(1)
    expect(students?.[0]?.enrollments[0]?.subscriptions[0]?.discount_percent).toBe(15)
  } finally {
    await cleanup(name)
  }
})
