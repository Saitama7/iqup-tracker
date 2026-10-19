import { createClient } from '@supabase/supabase-js'
import { expect, test, type TestInfo } from '@playwright/test'
import { localSupabase } from '../../scripts/local-supabase'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import type { Database } from '../../src/lib/supabase/types.gen'
import { GULZAT, KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import {
  cleanup,
  holdLessons,
  makeEnrollment,
  makeGroup,
  service,
  teacherId,
} from './support/undo-fixtures'

// #94 «админ может всё»: edit a held lesson (preview of the payroll first) and delete a teacher's
// correction request. Own group of Гульзат from 1 October; a held October lesson moves her month
// while the spec runs, hence the write lock.

lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const names = (testInfo: TestInfo) => ({
  group: `e2e суперюзер ${size(testInfo)}`,
  student: `Е2е Суперюзер ${size(testInfo)}`,
})

// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.student])
})
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => {
  const n = names(testInfo)
  await cleanup([n.group], [n.student])
})

async function heldLesson(testInfo: TestInfo) {
  const n = names(testInfo)
  const groupId = await makeGroup(n.group, await teacherId('Гульзат%'), '2026-10-01')
  const e = await makeEnrollment(n.student, groupId, '2026-10-01')
  await holdLessons(groupId, e.studentId, 1, 'present')
  const { data } = await service()
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'held')
    .single()
  return { lessonId: data?.id ?? '', studentId: e.studentId }
}

test('карточка занятия: «Изменить занятие» — предпросмотр ЗП, смена учителя и времени с причиной', async ({
  page,
}, testInfo) => {
  const { lessonId } = await heldLesson(testInfo)
  const other = await teacherId('Айпери%')

  await login(page, KANYKEI)
  await page.goto(`/lessons/${lessonId}`)
  await page.getByRole('button', { name: 'Действия с занятием' }).click()
  await page.getByRole('button', { name: 'Изменить занятие', exact: true }).click()

  const form = page.getByRole('form', { name: 'Изменить занятие' })
  await expect(form.getByTestId('edit-lesson-impact')).toContainText(/ЗП/)
  await form.getByLabel('Учитель (получает ЗП)').selectOption(other)
  await expect(form.getByTestId('edit-lesson-impact')).toContainText(/^ЗП: /)
  await form.getByLabel('Начало').fill('18:30')
  await form.getByRole('button', { name: 'Изменить занятие' }).click()
  await expect(form.getByRole('alert')).toHaveText('Укажите причину')
  await form.getByLabel('Причина').fill('e2e: ошиблись учителем')
  await form.getByRole('button', { name: 'Изменить занятие' }).click()
  await expect(page.getByText('Занятие изменено')).toBeVisible()

  const { data } = await service()
    .from('lessons')
    .select('teacher_id, planned_start, status')
    .eq('id', lessonId)
    .single()
  expect(data).toMatchObject({ teacher_id: other, planned_start: '18:30:00', status: 'held' })
})

test('карточка занятия: админ удаляет запрос учителя на исправление с причиной', async ({
  page,
}, testInfo) => {
  const { lessonId, studentId } = await heldLesson(testInfo)
  const env = localSupabase()
  const teacher = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signIn = await teacher.auth.signInWithPassword({
    email: phoneToEmail(`0${GULZAT.phone}`),
    password: GULZAT.password,
  })
  if (signIn.error) throw signIn.error
  const created = await teacher.from('attendance_correction_requests').insert({
    lesson_id: lessonId,
    marks: [{ student_id: studentId, status: 'absent_burned' }],
    comment: 'e2e: запрос по ошибке',
  })
  if (created.error) throw created.error

  await login(page, KANYKEI)
  await page.goto(`/lessons/${lessonId}`)
  const review = page.getByRole('region', { name: 'Запрос учителя' })
  await expect(review).toContainText('e2e: запрос по ошибке')
  await review.getByRole('button', { name: 'Действия с запросом' }).click()
  await page.getByRole('button', { name: 'Удалить запрос', exact: true }).click()

  const dialog = page.getByRole('form', { name: 'Удалить запрос' })
  await dialog.getByRole('button', { name: 'Удалить запрос' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Укажите причину')
  await dialog.getByLabel('Причина').fill('e2e: дубль')
  await dialog.getByRole('button', { name: 'Удалить запрос' }).click()
  await expect(page.getByText('Запрос удалён')).toBeVisible()
  await expect(review).toHaveCount(0)

  const { data } = await service()
    .from('attendance_correction_requests')
    .select('id')
    .eq('lesson_id', lessonId)
  expect(data).toEqual([])
})
