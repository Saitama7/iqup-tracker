import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { GULZAT, KANYKEI, login, switchUser } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { cleanup, makeEnrollment, makeGroup, service, teacherId } from './support/undo-fixtures'

// #126 · А4 «Ученики» showed lessons_total − used («−8» with the money paid). Now debt / available,
// the same number as the teacher's «Мои группы». Own group of Гульзат from 1 October, ПН–ПТ (the
// seed's September is never touched). Needs the local stack + `pnpm seed:users`.

// Held October lessons change Гульзат's month while the spec runs (И23).
lockSeed('write')
test.use({ serviceWorkers: 'block' })

const size = (testInfo: TestInfo) => (testInfo.project.name === 'webkit-desktop' ? 1280 : 390)
const isDesktop = (testInfo: TestInfo) => size(testInfo) === 1280

const names = (testInfo: TestInfo) => {
  const w = size(testInfo)
  return {
    group: `e2e остаток ${w}`,
    over: `Е2е Переплата ${w}`,
    debt: `Е2е Должник ${w}`,
    partial: `Е2е Частичная ${w}`,
  }
}

const wipe = (testInfo: TestInfo) => {
  const n = names(testInfo)
  return cleanup([n.group], [n.over, n.debt, n.partial])
}
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.beforeEach(async ({}, testInfo) => wipe(testInfo))
// eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
test.afterEach(async ({}, testInfo) => wipe(testInfo))

/** Holds the group's first lessons: a pupil present on his first `lessons`, frozen after (К9 — no limit). */
async function hold(groupId: string, wants: { studentId: string; lessons: number }[]) {
  const db = service()
  const max = Math.max(...wants.map((w) => w.lessons))
  const { data: lessons } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .order('lesson_date')
    .limit(max)
  expect(lessons).toHaveLength(max)
  for (const [i, l] of (lessons ?? []).entries()) {
    const { error } = await db.rpc('confirm_lesson', {
      p_lesson_id: l.id,
      p_marks: wants.map((w) => ({
        student_id: w.studentId,
        status: i < w.lessons ? 'present' : 'absent_frozen',
      })),
    })
    if (error) throw error
  }
}

const roster = (page: Page, testInfo: TestInfo) =>
  page.getByRole(isDesktop(testInfo) ? 'table' : 'list', { name: 'Ученики группы' })

test('А4: остаток — долг / доступно, как у учителя', async ({ page }, testInfo) => {
  const n = names(testInfo)
  const groupId = await makeGroup(
    n.group,
    await teacherId('Гульзат%'),
    '2026-10-01',
    'mini',
    [1, 2, 3, 4, 5],
  )
  const { data: tariff } = await service()
    .from('tariffs')
    .select('package_price')
    .eq('group_type', 'mini')
    .lte('valid_from', '2026-10-01')
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()
  const price = tariff?.package_price ?? 0
  // 12 lessons: 20 used, paid twice → 4 / 12; 14 used, paid once → −2; 2 used, half paid → 4 / 12
  const over = await makeEnrollment(n.over, groupId, '2026-10-01', price * 2)
  const debt = await makeEnrollment(n.debt, groupId, '2026-10-01', price)
  const partial = await makeEnrollment(n.partial, groupId, '2026-10-01', price / 2)
  await hold(groupId, [
    { studentId: over.studentId, lessons: 20 },
    { studentId: debt.studentId, lessons: 14 },
    { studentId: partial.studentId, lessons: 2 },
  ])

  const expected = [
    [n.over, 'доступно 4 из 12', '4 / 12'],
    [n.debt, 'долг 2 ур.', '−2'],
    [n.partial, 'доступно 4 из 12', '4 / 12'],
  ] as const

  await login(page, KANYKEI)
  await page.goto(`/admin/groups/${groupId}`)
  const list = roster(page, testInfo)
  for (const [name, label, text] of expected) {
    const row = list.locator(isDesktop(testInfo) ? 'tr' : 'li').filter({ hasText: name })
    await expect(row.getByLabel(label)).toHaveText(text)
  }
  await expect(list).not.toContainText('−8')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r126-group-${size(testInfo)}.png` })

  // «Мои группы» of Гульзат: the same numbers
  await switchUser(page, GULZAT)
  await page.goto(`/groups/${groupId}`)
  for (const [name, , text] of expected) {
    const row = isDesktop(testInfo)
      ? page.getByRole('row').filter({ hasText: name })
      : page.getByRole('listitem', { name })
    await expect(row).toContainText(text)
  }
  await page.waitForTimeout(600)
  await page.screenshot({ path: `docs/screenshots/r126-teacher-group-${size(testInfo)}.png` })
})
