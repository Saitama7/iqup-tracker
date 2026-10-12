/// <reference lib="dom" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import type { Database } from '../../src/lib/supabase/types.gen'
import { AIGERIM, GULZAT, KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// А10 «Журнал изменений» (#45). Needs the local stack + `pnpm seed:users`. Each project works on its
// own 20:00 extra lesson of «Математика · 6 класс» (no other spec touches the group) on a September
// day: Гульзат confirms it late, Каныкей corrects a mark, both show up in the journal. The lesson
// changes September's sums while the test runs, so the test holds the seed lock (#27). The database
// clock is real: the journal's rows are «Сегодня».
const GROUP_6 = '00000000-0000-4000-b000-000000000002'

test.use({ serviceWorkers: 'block' })
lockSeed('write')

type Db = SupabaseClient<Database>

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const noTabBar = 'nav[aria-label="Основное меню"] { visibility: hidden !important; }'

function service(): Db {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** supabase-js signed in as a seed user — the journal's author is auth.uid(). */
async function signedIn(phone: string): Promise<Db> {
  const env = localSupabase()
  const db = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await db.auth.signInWithPassword({
    email: phoneToEmail(phone),
    password: 'iqup-demo',
  })
  if (error) throw error
  return db
}

async function removeLesson(db: Db, day: string) {
  const { data } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', GROUP_6)
    .eq('lesson_date', day)
    .eq('planned_start', '20:00')
  for (const { id } of data ?? []) {
    await db.from('attendance').delete().eq('lesson_id', id)
    await db.from('lessons').delete().eq('id', id)
  }
}

/** Students enrolled in 6 класс on `day` — confirm_lesson wants a mark for each. */
async function roster(db: Db, day: string) {
  const { data, error } = await db
    .from('enrollments')
    .select('student_id, start_date, end_date, status, student:students(full_name)')
    .eq('group_id', GROUP_6)
    .lte('start_date', day)
  if (error) throw error
  return data
    .filter((e) => (e.end_date ? e.end_date >= day : e.status === 'active'))
    .map((e) => ({ id: e.student_id, name: e.student.full_name }))
}

const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)

test('А10: late confirmation and a mark corrected by the admin, filters, «Показать ещё»', async ({
  page,
}, testInfo) => {
  const desktop = testInfo.project.name === 'webkit-desktop'
  const day = desktop ? '2026-09-19' : '2026-09-26'
  const dm = `${day.slice(8, 10)}.${day.slice(5, 7)}`
  const tag = `${desktop ? 'деск' : 'моб'} ${Date.now() % 1_000_000}`
  const db = service()
  let subjectId: string | null = null

  await removeLesson(db, day)
  try {
    // ─── Data: Гульзат confirms a past lesson, Каныкей changes a mark ───────
    const { data: lesson, error } = await db
      .from('lessons')
      .insert({
        group_id: GROUP_6,
        lesson_date: day,
        planned_start: '20:00',
        duration_min: 60,
        is_extra: true,
      })
      .select('id')
      .single()
    if (error) throw error
    const students = await roster(db, day)
    expect(students.length).toBeGreaterThan(0)
    const [first] = students

    const gulzat = await signedIn('996555123456')
    const confirm = await gulzat.rpc('confirm_lesson', {
      p_lesson_id: lesson.id,
      p_marks: students.map((s) => ({ student_id: s.id, status: 'present' })),
    })
    if (confirm.error) throw confirm.error

    const kanykei = await signedIn('996552775771')
    const edit = await kanykei
      .from('attendance')
      .update({ status: 'absent_burned' })
      .eq('lesson_id', lesson.id)
      .eq('student_id', first.id)
    if (edit.error) throw edit.error

    // ─── Screen ─────────────────────────────────────────────────────────────
    await login(page, KANYKEI)
    await expect(page).toHaveURL(/\/admin$/)
    if (desktop) {
      await page
        .getByRole('navigation', { name: 'Основное меню' })
        .getByRole('link', { name: 'Журнал изменений' })
        .click()
    } else {
      await page
        .getByRole('navigation', { name: 'Основное меню' })
        .getByRole('button', { name: 'Ещё' })
        .click()
      await page
        .getByRole('dialog', { name: 'Ещё' })
        .getByRole('link', { name: 'Журнал изменений' })
        .click()
    }
    await expect(page).toHaveURL(/\/admin\/audit$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Журнал изменений')

    const feed = page.getByRole('feed', { name: 'Изменения' })
    const where = `Математика · 6 класс, ${dm} в 20:00`
    // the journal keeps earlier runs' rows of the same lesson: ours is the newest (the first)
    const lateRow = feed.getByRole('article').filter({
      hasText: `Занятие ${where} подтверждено с опозданием`,
    })
    const editRow = feed.getByRole('article').filter({
      hasText: `Отметка ${first.name}: Был → Не был · ${where}`,
    })
    // other specs write the journal too: narrow it to the table first (the screenshot shows it all)
    await expect(feed.getByRole('heading', { level: 2 }).first()).toContainText('Сегодня')
    await page.addStyleTag({ content: noTabBar })
    // the first screen only: the feed of a busy day is long
    await page.screenshot({ path: shot(testInfo, isDesktop(page) ? 'audit-1280' : 'audit-390') })

    await page.getByLabel('Таблица').selectOption({ label: 'Занятия' })
    await expect(page).toHaveURL(/entity=lessons/)
    await expect(lateRow.first()).toBeVisible()
    await expect(lateRow.first()).toContainText('Поздно')
    await expect(lateRow.first()).toContainText('Гульзат')
    await expect(lateRow.first()).toContainText(`был ${students.length}`)

    // chips: the kind goes to the URL
    const chips = page.getByRole('group', { name: 'Тип изменений' })
    await chips.getByRole('button', { name: /^Поздние подтверждения · \d+$/ }).click()
    await expect(page).toHaveURL(/kind=late/)
    await expect(lateRow.first()).toBeVisible()
    await chips.getByRole('button', { name: /^Правки задним числом · \d+$/ }).click()
    await expect(page).toHaveURL(/kind=retro/)
    await expect(lateRow).toHaveCount(0)

    await page.getByLabel('Таблица').selectOption({ label: 'Посещаемость' })
    await expect(page).toHaveURL(/entity=attendance/)
    await expect(editRow.first()).toBeVisible()
    await expect(editRow.first()).toContainText('Правка')
    await expect(editRow.first()).toContainText('Каныкей')
    await expect(editRow.first().getByRole('link', { name: 'Группа →' })).toHaveAttribute(
      'href',
      `/admin/groups/${GROUP_6}`,
    )
    await chips.getByRole('button', { name: /^Все · \d+$/ }).click()
    await expect(page).not.toHaveURL(/kind=/)
    await expect(editRow.first()).toBeVisible()
    // the marks of «Провести» are folded into the lesson's row, not one row per student
    await expect(
      feed.getByRole('article').filter({ hasText: `Отметка ${first.name} добавлена` }),
    ).toHaveCount(0)

    // «Показать ещё»: 51 renames of a subject of this test → more than one page of Каныкей's «Предметы»
    const added = await kanykei
      .from('subjects')
      .insert({ name: `Аудит ${tag} 0` })
      .select('id')
      .single()
    if (added.error) throw added.error
    subjectId = added.data.id
    for (let i = 1; i <= 51; i++) {
      const r = await kanykei
        .from('subjects')
        .update({ name: `Аудит ${tag} ${i}` })
        .eq('id', subjectId)
      if (r.error) throw r.error
    }

    await page.getByLabel('Таблица').selectOption({ label: 'Предметы' })
    await page.getByLabel('Кто').selectOption({ label: 'Каныкей' })
    await expect(page).toHaveURL(/entity=subjects/)
    await expect(page).toHaveURL(/actor=/)
    const articles = feed.getByRole('article')
    await expect(articles).toHaveCount(50)
    await expect(
      articles.filter({ hasText: `Предмет: Аудит ${tag} 50 → Аудит ${tag} 51` }),
    ).toHaveCount(1)
    await page.getByRole('button', { name: 'Показать ещё' }).click()
    await expect(articles.filter({ hasText: `Предмет добавлен: Аудит ${tag} 0` })).toHaveCount(1)
    expect(await articles.count()).toBeGreaterThan(50)
  } finally {
    await removeLesson(db, day)
    if (subjectId) await db.from('subjects').delete().eq('id', subjectId)
  }
})

test('А10: the accountant reads the journal without links', async ({ page }) => {
  await login(page, AIGERIM)
  await page.goto('/admin/audit')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Журнал изменений')
  await expect(page.getByRole('group', { name: 'Тип изменений' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Все · \d+$/ })).toBeVisible()
  await expect(page.getByRole('feed', { name: 'Изменения' }).getByRole('link')).toHaveCount(0)
  // the rest of /admin is still admin-only
  await page.goto('/admin/groups')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
})

test('А10: a teacher gets 403', async ({ page }) => {
  await login(page, GULZAT)
  await page.goto('/admin/audit')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
})
