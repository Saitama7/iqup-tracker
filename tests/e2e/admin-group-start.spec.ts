import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import type { Database } from '../../src/lib/supabase/types.gen'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'

// #60: a group created with start 18.09 is moved back to 01.09 from «Изменить группу», its student's
// enrollment too (А6 «Изменить дату зачисления»); both moves are in the journal.
// Needs the local stack + `pnpm seed:users`.

// September lessons of a new group change the months other specs count for a while (И23).
lockSeed('write')

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

// One group and student per project, so the two viewports never touch the same rows.
const fixture = (testInfo: TestInfo) =>
  testInfo.project.name === 'webkit-desktop'
    ? { group: 'e2e старт десктоп', student: 'Е2е Старт Десктоп', teacher: 'Айпери%', size: 1280 }
    : {
        group: 'e2e старт мобильный',
        student: 'Е2е Старт Мобильный',
        teacher: 'Бекзат%',
        size: 390,
      }

const serviceClient = () => {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function cleanup(groupName: string, studentName: string) {
  const service = serviceClient()
  const { data: students } = await service
    .from('students')
    .select('id')
    .eq('full_name', studentName)
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
  const { data: groups } = await service.from('groups').select('id').eq('name', groupName)
  for (const { id } of groups ?? []) {
    await service.from('lessons').delete().eq('group_id', id)
    await service.from('schedule_rules').delete().eq('group_id', id)
    await service.from('groups').delete().eq('id', id)
  }
}

test('старт группы и дата зачисления задним числом: 18.09 → 01.09', async ({ page }, testInfo) => {
  const f = fixture(testInfo)
  await cleanup(f.group, f.student)
  const service = serviceClient()
  try {
    // ВТ/ЧТ 19:00 from Friday 18 Sep 2026 — as Каныкей created the real groups on prod
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
    const { data: student } = await service
      .from('students')
      .insert({ full_name: f.student, grade: 11 })
      .select('id')
      .single()
    const studentId = student?.id ?? ''
    const { data: tariff } = await service
      .from('tariffs')
      .select('id')
      .eq('group_type', 'mini')
      .lte('valid_from', '2026-09-18')
      .order('valid_from', { ascending: false })
      .limit(1)
      .single()
    const { data: enrollment } = await service
      .from('enrollments')
      .insert({ student_id: studentId, group_id: groupId, start_date: '2026-09-18' })
      .select('id')
      .single()
    await service.from('subscriptions').insert({
      enrollment_id: enrollment?.id ?? '',
      tariff_id: tariff?.id ?? '',
      lessons_total: 12,
      price_full: 3800,
      price_final: 3800,
      started_at: '2026-09-18',
    })

    await login(page, KANYKEI)
    await page.goto(`/admin/groups/${groupId}`)
    await expect(page.getByRole('heading', { name: `Математика · ${f.group}` })).toBeVisible()
    await expect(page.getByText('старт 18 сентября', { exact: false })).toBeVisible()

    // A later start is refused while a student is enrolled before it.
    await page.getByRole('button', { name: 'Изменить' }).click()
    const edit = page.getByRole('form', { name: 'Изменить группу' })
    const start = edit.getByLabel('Старт группы')
    await expect(start).toHaveValue('18.09.2026')
    await expect(edit.getByLabel('Действует с')).toBeVisible()
    await expect(edit.getByText('Можно задним числом — занятия достроятся')).toBeVisible()
    await expect(edit.getByText(/^Не раньше сегодня — /)).toBeVisible()
    await start.fill('')
    await start.pressSequentially('25092026')
    await expect(start).toHaveValue('25.09.2026')
    await edit.getByRole('button', { name: 'Сохранить' }).click()
    await expect(edit.getByRole('alert')).toHaveText(
      'Раньше этой даты есть зачисления — сначала измените даты зачисления учеников',
    )

    // Digits only, as on the iPhone keypad: the dots are put in by the field.
    await start.fill('')
    await start.pressSequentially('01092026')
    await expect(start).toHaveValue('01.09.2026')
    await expect(edit.getByRole('alert')).toHaveCount(0)
    // ВТ/ЧТ 1–17 Sep: 1, 3, 8, 10, 15, 17
    await expect(edit.getByRole('status')).toHaveText(
      'Занятия с 1 сентября по 17 сентября достроятся по расписанию старта: 6 занятий, праздники пропущены.',
    )
    await page.screenshot({ path: testInfo.outputPath(`edit-group-${f.size}.png`) })
    await edit.getByRole('button', { name: 'Сохранить' }).click()
    await expect(edit).toBeHidden()
    await expect(page.getByText('старт 1 сентября', { exact: false })).toBeVisible()

    await page.getByRole('tab', { name: 'Занятия' }).click()
    const past = page.getByRole('list', { name: 'Прошедшие занятия' })
    for (const day of ['1 сен, вт', '3 сен, чт', '15 сен, вт', '17 сен, чт', '22 сен, вт']) {
      await expect(past.getByRole('listitem').filter({ hasText: day })).toHaveCount(1)
    }
    // the old lessons from 18 Sep are kept, nothing doubled
    const { count } = await service
      .from('lessons')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .lt('lesson_date', '2026-10-01')
    expect(count).toBe(9)

    // А6: the enrollment follows — «зачислен 1 сентября».
    await page.goto(`/admin/students/${studentId}`)
    await expect(page.getByText('зачислен 18 сентября', { exact: false }).first()).toBeVisible()
    await page
      .getByRole('button', { name: `Изменить дату зачисления: Математика · ${f.group}` })
      .click()
    const dialog = page.getByRole('form', { name: 'Дата зачисления' })
    const date = dialog.getByLabel('Зачислен с')
    await date.fill('')
    await date.pressSequentially('25082026')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'Дата — вне дат группы (раньше старта группы)',
    )
    await date.fill('')
    await date.pressSequentially('01092026')
    await page.screenshot({ path: testInfo.outputPath(`enrollment-start-${f.size}.png`) })
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('зачислен 1 сентября', { exact: false }).first()).toBeVisible()
    const { data: sub } = await service
      .from('subscriptions')
      .select('started_at')
      .eq('enrollment_id', enrollment?.id ?? '')
      .single()
    expect(sub?.started_at).toBe('2026-09-01')

    // А10: both moves in the journal.
    await page.goto('/admin/audit')
    await expect(
      page.getByText(`Математика · ${f.group} — старт группы перенесён с 18.09 на 01.09`).first(),
    ).toBeVisible()
    await expect(
      page
        .getByText(
          `${f.student} — зачисление в Математика · ${f.group} перенесено с 18.09 на 01.09`,
        )
        .first(),
    ).toBeVisible()
    if (isDesktop(page)) await page.screenshot({ path: testInfo.outputPath('audit.png') })
  } finally {
    await cleanup(f.group, f.student)
  }
})
