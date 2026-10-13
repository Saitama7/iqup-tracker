/// <reference lib="dom" />
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// #62: calendar in the period titles and in the ДД.ММ.ГГГГ fields. The clock is pinned to
// Thursday 8 October 14:24 (as admin-dashboard.spec.ts); the group test makes its own group.
test.use({ serviceWorkers: 'block' })
lockSeed('write')

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
const size = (page: Page) => (isDesktop(page) ? 1280 : 390)
const shot = (testInfo: TestInfo, name: string) => testInfo.outputPath(`${name}.png`)
/** Screenshot once the sheet has slid in / the popover has faded in. */
async function snap(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: shot(testInfo, name) })
}

async function pinClock(page: Page, iso: string) {
  await page.clock.setSystemTime(new Date(iso))
  await page.route('**/rest/v1/rpc/server_now', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(iso) }),
  )
}

/** A day of the month shown — not an outside day of the neighbouring months. */
const day = (picker: Locator, n: number) =>
  picker.locator('td:not([data-outside]) button').getByText(String(n), { exact: true })

const serviceClient = () => {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test('расписание: с недели 5–10 октября на 1 сентября через календарь в 3 тапа', async ({
  page,
}, testInfo) => {
  await pinClock(page, '2026-10-08T08:24:00Z')
  await login(page, KANYKEI)
  await page.goto('/admin/schedule?date=2026-10-05')

  const title = isDesktop(page) ? '5 – 10 октября' : 'Понедельник, 5 октября'
  const pickerName = isDesktop(page) ? 'Перейти к неделе' : 'Перейти к дню'
  // tap 1: the title
  await page.getByRole('heading', { name: title }).getByRole('button').click()
  const picker = page.getByRole('dialog', { name: pickerName })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('combobox', { name: 'Выберите месяц' })).toHaveValue('9')
  await snap(page, testInfo, `date-picker-schedule-${size(page)}`)
  // tap 2: the month; tap 3: the day
  await picker.getByRole('combobox', { name: 'Выберите месяц' }).selectOption({ label: 'Сентябрь' })
  await day(picker, 1).click()

  await expect(picker).toBeHidden()
  await expect(page).toHaveURL(/date=2026-09-01/)
  await expect(
    page.getByRole('heading', {
      name: isDesktop(page) ? '31 августа – 5 сентября' : 'Вторник, 1 сентября',
    }),
  ).toBeVisible()
  // arrows still work from there
  await page
    .getByRole('button', { name: isDesktop(page) ? 'Следующая неделя' : 'Следующий день' })
    .click()
  await expect(page).toHaveURL(isDesktop(page) ? /date=2026-09-08/ : /date=2026-09-02/)
})

test('расчёт ЗП: месяц выбирается из заголовка, будущие месяцы выключены', async ({
  page,
}, testInfo) => {
  await pinClock(page, '2026-10-08T08:24:00Z')
  await login(page, KANYKEI)
  await page.goto('/payroll?month=2026-10')
  await page
    .getByRole('heading', { name: isDesktop(page) ? 'Октябрь 2026' : 'Октябрь' })
    .getByRole('button')
    .click()
  const picker = page.getByRole('dialog', { name: 'Выберите месяц' })
  await expect(picker.getByRole('button', { name: 'Ноябрь' })).toBeDisabled()
  await snap(page, testInfo, `month-picker-payroll-${size(page)}`)
  await picker.getByRole('button', { name: 'Сентябрь' }).click()
  await expect(page).toHaveURL(/month=2026-09/)
  await expect(
    page.getByRole('heading', { name: isDesktop(page) ? 'Сентябрь 2026' : 'Сентябрь' }),
  ).toBeVisible()
})

test('старт группы и дата зачисления — выбор в календаре и сохранение', async ({
  page,
}, testInfo) => {
  const f = isDesktop(page)
    ? { group: 'e2e календарь десктоп', student: 'Е2е Календарь Десктоп', teacher: 'Айпери%' }
    : { group: 'e2e календарь мобильный', student: 'Е2е Календарь Мобильный', teacher: 'Бекзат%' }
  const service = serviceClient()
  async function cleanup() {
    const { data: students } = await service
      .from('students')
      .select('id')
      .eq('full_name', f.student)
    for (const { id } of students ?? []) {
      const { data: enrollments } = await service
        .from('enrollments')
        .select('id')
        .eq('student_id', id)
      for (const e of enrollments ?? []) {
        await service.from('subscriptions').delete().eq('enrollment_id', e.id)
        await service.from('enrollments').delete().eq('id', e.id)
      }
      await service.from('students').delete().eq('id', id)
    }
    const { data: groups } = await service.from('groups').select('id').eq('name', f.group)
    for (const { id } of groups ?? []) {
      await service.from('lessons').delete().eq('group_id', id)
      await service.from('schedule_rules').delete().eq('group_id', id)
      await service.from('groups').delete().eq('id', id)
    }
  }

  await cleanup()
  try {
    const { data: teacher } = await service
      .from('teachers')
      .select('id')
      .like('full_name', f.teacher)
      .single()
    const { data: subject } = await service
      .from('subjects')
      .select('id')
      .eq('name', 'Математика')
      .single()
    const { data: created, error } = await service.rpc('create_group', {
      p_name: f.group,
      p_subject_id: subject?.id ?? '',
      p_grade: 11,
      p_group_type: 'mini',
      p_teacher_id: teacher?.id ?? '',
      p_weekdays: [2, 4],
      p_start_time: '19:00',
      p_start_date: '2026-09-18',
      p_room: '2',
      p_until: '2026-10-31',
    })
    expect(error).toBeNull()
    const groupId = created?.[0]?.group_id ?? ''

    await login(page, KANYKEI)
    await page.goto(`/admin/groups/${groupId}`)
    await expect(page.getByText('старт 18 сентября', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Изменить' }).click()
    const edit = page.getByRole('form', { name: 'Изменить группу' })
    const start = edit.getByLabel('Старт группы')
    // phone: a tap on the field opens the calendar; desktop: the icon in the field
    if (isDesktop(page)) {
      await edit.getByRole('button', { name: 'Открыть календарь' }).first().click()
    } else {
      await start.click()
    }
    const picker = page.getByRole('dialog', { name: 'Выберите дату' })
    await expect(picker).toBeVisible()
    await snap(page, testInfo, `date-picker-field-${size(page)}`)
    await day(picker, 1).click()
    await expect(picker).toBeHidden()
    await expect(start).toHaveValue('01.09.2026')
    await edit.getByRole('button', { name: 'Сохранить' }).click()
    await expect(edit).toBeHidden()
    await expect(page.getByText('старт 1 сентября', { exact: false })).toBeVisible()

    const { data: student } = await service
      .from('students')
      .insert({ full_name: f.student, grade: 11 })
      .select('id')
      .single()
    const studentId = student?.id ?? ''
    const { data: enrollment } = await service
      .from('enrollments')
      .insert({
        student_id: studentId,
        group_id: groupId,
        start_date: '2026-09-18',
        end_date: '2026-10-31',
      })
      .select('id')
      .single()

    await page.goto(`/admin/students/${studentId}`)
    await page
      .getByRole('button', { name: `Изменить дату зачисления: Математика · ${f.group}` })
      .click()
    const dialog = page.getByRole('form', { name: 'Дата зачисления' })
    // the enrollment ends on 31 October: the hint names both bounds (#66)
    await expect(
      dialog.getByText(
        'Можно задним числом, не раньше старта группы — 01.09.2026 и не позже 31.10.2026',
      ),
    ).toBeVisible()
    await snap(page, testInfo, `enrollment-hint-${size(page)}`)
    await dialog.getByRole('button', { name: 'Открыть календарь' }).click()
    const enrollPicker = page.getByRole('dialog', { name: 'Выберите дату' })
    // the group starts on 1 September: no way back to August
    await expect(
      enrollPicker.getByRole('button', { name: 'Перейти к предыдущему месяцу' }),
    ).toBeDisabled()
    await expect(day(enrollPicker, 1)).toBeEnabled()
    await day(enrollPicker, 2).click()
    await expect(dialog.getByLabel('Зачислен с')).toHaveValue('02.09.2026')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(dialog).toBeHidden()
    const { data: saved } = await service
      .from('enrollments')
      .select('start_date')
      .eq('id', enrollment?.id ?? '')
      .single()
    expect(saved?.start_date).toBe('2026-09-02')
  } finally {
    await cleanup()
  }
})

test('телефон: тап по полю — шторка, «Закрыть» без клавиатуры, «Ввести вручную» — фокус', async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(page), 'шторка и ручной ввод через неё — только на телефоне (#64)')
  await pinClock(page, '2026-10-08T08:24:00Z')
  await login(page, KANYKEI)
  await page.goto('/admin/settings')
  await page
    .getByRole('region', { name: 'Праздники и выходные центра' })
    .getByRole('button', { name: 'Добавить', exact: true })
    .click()
  const add = page.getByRole('dialog', { name: 'Новый праздник' })
  // by id: under the open sheet the holiday dialog is aria-hidden, out of role queries
  const fieldId = await add.getByLabel('Дата').getAttribute('id')
  const field = page.locator(`[id="${fieldId ?? ''}"]`)
  const picker = page.getByRole('dialog', { name: 'Выберите дату' })
  const focused = () => field.evaluate((el) => el === document.activeElement)

  // a tap on the field opens the calendar, not the keyboard
  await field.tap()
  await expect(picker).toBeVisible()
  expect(await focused()).toBe(false)
  await snap(page, testInfo, 'date-picker-manual-390')

  // «Закрыть»: the field stays unfocused (no keyboard popping up on Android)
  await picker.getByRole('button', { name: 'Закрыть' }).tap()
  await expect(picker).toBeHidden()
  expect(await focused()).toBe(false)

  // the next tap opens the calendar again
  await field.tap()
  await expect(picker).toBeVisible()

  // «Ввести вручную»: the sheet closes and the field takes the keyboard
  await picker.getByRole('button', { name: 'Ввести вручную' }).tap()
  await expect(picker).toBeHidden()
  expect(await focused()).toBe(true)
  await page.keyboard.type('25122026')
  await expect(field).toHaveValue('25.12.2026')
  // typing in progress: a tap moves the caret instead of reopening the calendar
  await field.tap()
  await expect(picker).toBeHidden()

  // a tap on another field ends typing: the next tap on the date opens the sheet again (#66)
  await add.getByLabel('Название').tap()
  expect(await focused()).toBe(false)
  await field.tap()
  await expect(picker).toBeVisible()
  expect(await focused()).toBe(false)
  await snap(page, testInfo, 'date-picker-retap-390')
})

test('десктоп: клик в соседнее поле при открытом календаре — текст печатается туда (#66)', async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(page), 'popover и возврат фокуса в поле — десктоп (#66)')
  await pinClock(page, '2026-10-08T08:24:00Z')
  await login(page, KANYKEI)
  await page.goto('/admin/settings')
  await page
    .getByRole('region', { name: 'Праздники и выходные центра' })
    .getByRole('button', { name: 'Добавить', exact: true })
    .click()
  const add = page.getByRole('form', { name: 'Новый праздник' })
  const date = add.getByLabel('Дата')
  const name = add.getByLabel('Название')
  const picker = page.getByRole('dialog', { name: 'Выберите дату' })

  await add.getByRole('button', { name: 'Открыть календарь' }).click()
  await expect(picker).toBeVisible()
  // the popover covers the left of the field below — click its uncovered right end
  const box = await name.boundingBox()
  await name.click({ position: { x: (box?.width ?? 0) - 16, y: (box?.height ?? 0) / 2 } })
  await expect(picker).toBeHidden()
  // past the popover's fade-out, when the focus used to jump back into the date
  await page.waitForTimeout(400)
  await page.keyboard.type('Нооруз')
  await expect(name).toHaveValue('Нооруз')
  await expect(date).toHaveValue('')
  await expect(name).toBeFocused()

  // a click into the date field itself closes the popover too, the caret stays there
  await add.getByRole('button', { name: 'Открыть календарь' }).click()
  await expect(picker).toBeVisible()
  await date.click()
  await expect(picker).toBeHidden()
  await expect(date).toBeFocused()
  await page.keyboard.type('21032027')
  await expect(date).toHaveValue('21.03.2027')
  await snap(page, testInfo, 'date-picker-focus-1280')
})

test('десктоп: повторный клик по заголовку закрывает календарь, неделя подсвечена', async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(page), 'popover и неделя в заголовке — десктоп (#64)')
  await pinClock(page, '2026-10-08T08:24:00Z')
  await login(page, KANYKEI)
  await page.goto('/admin/schedule?date=2026-10-07')

  const title = page.getByRole('heading', { name: '5 – 10 октября' }).getByRole('button')
  const picker = page.getByRole('dialog', { name: 'Перейти к неделе' })
  await title.click()
  await expect(picker).toBeVisible()
  await expect(picker.locator('td.bg-stone')).toHaveText(['5', '6', '7', '8', '9', '10', '11'])
  await snap(page, testInfo, 'date-picker-week-1280')
  await title.click()
  await expect(picker).toBeHidden()
  await title.click()
  await expect(picker).toBeVisible()
})
