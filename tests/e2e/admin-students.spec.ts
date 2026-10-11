import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'

// Needs the local stack + `pnpm seed:users` (seed: 8 класс А as on А4 / А5).
const KANYKEI = { phone: '552 775 771', password: 'iqup-demo' } // admin + teacher
const GULZAT = { phone: '555 123 456', password: 'iqup-demo' } // teacher

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Номер телефона').fill(user.phone)
  await page.getByLabel('Пароль', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

// One student per project, so the two viewports never touch the same rows.
const testName = (testInfo: TestInfo) =>
  testInfo.project.name === 'webkit-desktop' ? 'Тестовый Десктопов' : 'Тестовый Мобильный'

async function removeStudent(fullName: string) {
  const env = localSupabase()
  const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: students } = await service.from('students').select('id').eq('full_name', fullName)
  for (const { id } of students ?? []) {
    const { data: enrollments } = await service
      .from('enrollments')
      .select('id')
      .eq('student_id', id)
    const ids = (enrollments ?? []).map((e) => e.id)
    if (ids.length > 0) {
      await service.from('subscriptions').delete().in('enrollment_id', ids)
      await service.from('enrollments').delete().in('id', ids)
    }
    await service.from('students').delete().eq('id', id)
  }
}

const studentRow = (page: Page, name: string) =>
  isDesktop(page)
    ? page.getByRole('table', { name: 'Ученики' }).getByRole('row').filter({ hasText: name })
    : page.getByRole('list', { name: 'Ученики' }).getByRole('listitem').filter({ hasText: name })

test('А5: list with balances, search by name and phone, group filter in the URL', async ({
  page,
}, testInfo) => {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(
    page.getByRole('heading', {
      name: /^(Центр сегодня|(Доброе утро|Добрый день|Добрый вечер), Каныкей)$/,
    }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Основное меню' })
    .getByRole('link', { name: 'Ученики' })
    .click()
  await expect(page).toHaveURL(/\/admin\/students$/)
  await expect(page.getByRole('heading', { name: 'Ученики', exact: true })).toBeVisible()
  await expect(page.getByText(/^\d+ активн(ый|ых)( · \d+ без группы)?$/)).toBeVisible()

  const kamila = studentRow(page, 'Камила Орозова')
  await expect(kamila).toContainText('Математика · 8 класс А · Химия · 9 класс')
  // Seed: September is held (#13) — 13 lessons in each group, the 13th already from the renewal
  await expect(kamila).toContainText('11 / 12 · 11 / 12')
  await expect(kamila).toContainText('0770 555 666')
  await expect(kamila).toContainText('Занимается')
  await page.screenshot({ path: testInfo.outputPath('students.png'), fullPage: true })

  const search = page.getByRole('searchbox', { name: 'Поиск ученика' })
  await search.fill('нурлан')
  await expect(page).toHaveURL(/q=/)
  await expect(studentRow(page, 'Нурлан Асанов')).toHaveCount(1)
  await expect(studentRow(page, 'Камила Орозова')).toHaveCount(0)

  await search.fill('0555 999 000')
  await expect(studentRow(page, 'Нурлан Асанов')).toHaveCount(1)
  await expect(studentRow(page, 'Айжан Бекова')).toHaveCount(0)
  await search.fill('')

  await page.getByRole('combobox', { name: 'Группа' }).selectOption({ label: 'Химия · 9 класс' })
  await expect(page).toHaveURL(/group=00000000-0000-4000-b000-000000000008/)
  await expect(studentRow(page, 'Камила Орозова')).toHaveCount(1)
  await expect(studentRow(page, 'Айжан Бекова')).toHaveCount(0)

  // The filter survives a reload — it lives in the URL.
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Группа' })).toHaveValue(
    '00000000-0000-4000-b000-000000000008',
  )
  await expect(studentRow(page, 'Айжан Бекова')).toHaveCount(0)
})

test('create a student → enroll into «8 класс А» with 15 % → in the group list with «12 / 12»', async ({
  page,
}, testInfo) => {
  const name = testName(testInfo)
  // Cleanup here, not in hooks: other tests of this file run in parallel workers.
  await removeStudent(name)
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(
    page.getByRole('heading', {
      name: /^(Центр сегодня|(Доброе утро|Добрый день|Добрый вечер), Каныкей)$/,
    }),
  ).toBeVisible()
  await page.goto('/admin/students')

  await page.getByRole('button', { name: '+ Новый ученик' }).click()
  const form = page.getByRole('form', { name: 'Новый ученик' })
  await form.getByRole('button', { name: 'Создать' }).click()
  await expect(form.getByRole('alert')).toHaveText('Введите имя и фамилию')
  await form.getByLabel('Имя и фамилия').fill(name)
  await form.getByLabel('Класс').fill('8')
  await form.getByLabel('Родитель').fill('Родитель Тестовый')
  await form.getByLabel('Телефон родителя').fill('0555 010 101')
  await form.getByLabel('Бывший ученик').check()
  await form.getByRole('button', { name: 'Создать' }).click()

  // Lands on А6 of the new student: not enrolled yet, no lessons.
  await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('Ещё не зачислен в группу', { exact: false })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Посещаемость' })).toContainText(
    'Занятий ещё не было',
  )

  await page
    .getByRole('button', { name: /Зачислить в группу/ })
    .first()
    .click()
  const enroll = page.getByRole('form', { name: 'Зачислить в группу' })
  await enroll.getByRole('button', { name: 'Зачислить' }).click()
  await expect(enroll.getByRole('alert')).toHaveText('Выберите группу')
  await enroll.getByLabel('Группа').selectOption({ label: 'Математика · 8 класс А · Гульзат' })
  // Returning student, first subscription: 15 % preselected, 5 % unavailable (nobody brought).
  await expect(enroll.getByRole('button', { name: /^15 %/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(enroll.getByRole('button', { name: /^5 %/ })).toBeDisabled()
  const summary = enroll.getByRole('status', { name: 'Абонемент' })
  await expect(summary).toContainText('12 уроков')
  await expect(summary).toContainText('3 200 сом')
  await expect(summary).toContainText('−480 сом')
  await expect(summary).toContainText('2 720 сом')
  await page.screenshot({ path: testInfo.outputPath('enroll.png') })
  await enroll.getByRole('button', { name: 'Зачислить' }).click()
  await expect(enroll).toBeHidden()

  const card = page.getByRole('region', { name: 'Математика · 8 класс А' })
  await expect(card).toContainText('Активен')
  await expect(card).toContainText('2 720 сом · скидка 15 %')
  await expect(card).toContainText(isDesktop(page) ? '0 из 12' : 'Использовано 0 из 12')

  // The second enrollment into the same group is not offered.
  await page
    .getByRole('button', { name: /Зачислить в группу/ })
    .first()
    .click()
  await expect(
    page
      .getByRole('form', { name: 'Зачислить в группу' })
      .getByRole('option', { name: 'Математика · 8 класс А · Гульзат' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.goto('/admin/students?group=00000000-0000-4000-b000-000000000001')
  const row = studentRow(page, name)
  await expect(row).toContainText('12 / 12')
  await expect(row).toContainText('Математика · 8 класс А')
  await removeStudent(name)
})

test('А6: student card with referrer, notes and empty attendance', async ({ page }, testInfo) => {
  await login(page, KANYKEI)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(
    page.getByRole('heading', {
      name: /^(Центр сегодня|(Доброе утро|Добрый день|Добрый вечер), Каныкей)$/,
    }),
  ).toBeVisible()
  await page.goto('/admin/students?q=Нурлан')
  await studentRow(page, 'Нурлан Асанов').getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: 'Нурлан Асанов' })).toBeVisible()

  const card = page.getByRole('region', { name: 'Математика · 8 класс А' })
  await expect(card).toContainText('3 200 сом · без скидки')
  await expect(card).toContainText('зачислен 1 октября')
  await expect(page.getByRole('region', { name: 'Посещаемость' })).toContainText(
    'Занятий ещё не было',
  )
  if (isDesktop(page)) {
    await expect(page.getByText('привёл Тимур М.', { exact: false })).toBeVisible()
    await expect(card).toContainText('Гульзат · ВТ ЧТ СБ 09:00')
    await expect(page.getByRole('region', { name: 'Заметки' })).toContainText('Тимуру скидка 5 %')
  } else {
    // АМ2: pushed screen — back button, no tab bar, call the parent.
    await expect(page.getByRole('navigation', { name: 'Основное меню' })).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: /Родитель · Асан Асанов · 0555 999 000/ }),
    ).toHaveAttribute('href', 'tel:0555999000')
  }
  await page.screenshot({ path: testInfo.outputPath('student.png'), fullPage: true })

  await page.getByRole('button', { name: 'Изменить' }).click()
  const form = page.getByRole('form', { name: 'Изменить ученика' })
  await expect(form.getByLabel('Имя и фамилия')).toHaveValue('Нурлан Асанов')
  await expect(form.getByLabel('Телефон родителя')).toHaveValue('555 999 000')
  await expect(form.getByLabel('Привёл')).toHaveValue(/[0-9a-f-]{36}/)
  await page.keyboard.press('Escape')

  if (isDesktop(page)) {
    await page.getByRole('link', { name: 'Ученики' }).first().click()
  } else {
    await page.getByRole('link', { name: 'Назад' }).click()
  }
  await expect(page).toHaveURL(/\/admin\/students(\?.*)?$/)
})

test('teacher opening /admin/students sees 403', async ({ page }) => {
  await login(page, GULZAT)
  await expect(page).toHaveURL(/\/today$/)
  // Wait for the post-login redirect to settle, otherwise it can interrupt goto.
  await expect(page.getByRole('heading', { name: 'Сегодня, Гульзат' })).toBeVisible()
  await page.goto('/admin/students')
  await expect(page.getByText('403')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
})
