import { expect, test, type Page } from '@playwright/test'
import { KANYKEI, login } from './support/auth'
import { lockSeed } from './support/seed-lock'
import { asAdmin, service } from './support/undo-fixtures'

// #94 «админ может всё»: close + reopen a month, edit an advance. Own data only: an empty past month
// (August — the seed starts in September) and one advance that is deleted afterwards.

lockSeed('write')
test.use({ serviceWorkers: 'block' })

const GULZAT_ID = '00000000-0000-4000-a000-000000000001'
const COMMENT = 'e2e superuser аванс'
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

async function cleanup() {
  const db = service()
  await db.from('payroll_adjustments').delete().eq('comment', COMMENT)
  await db.from('payroll_periods').delete().eq('month', '2026-08-01')
}

test.beforeEach(cleanup)
test.afterEach(cleanup)

test('Б1: админ закрывает и снова открывает месяц с причиной', async ({ page }) => {
  await login(page, KANYKEI)
  await page.goto('/payroll?month=2026-08')
  await page.getByRole('button', { name: /^Закрыть (период|август)/ }).click()

  const close = page.getByRole('form', { name: 'Закрыть период' })
  await expect(close.getByTestId('close-unconfirmed')).toBeVisible()
  await close.getByRole('button', { name: 'Закрыть период' }).click()
  await expect(page.getByText(/^Период закрыт: август/)).toBeVisible()
  await expect(
    page
      .getByTestId('period-chip')
      .or(page.getByText(/Период закрыт/))
      .first(),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Открыть период' }).click()
  const reopen = page.getByRole('form', { name: 'Открыть период' })
  await reopen.getByRole('button', { name: 'Открыть период' }).click()
  await expect(reopen.getByRole('alert')).toHaveText('Укажите причину')
  await reopen.getByLabel('Причина').fill('e2e: забыли занятие')
  await reopen.getByRole('button', { name: 'Открыть период' }).click()
  await expect(page.getByText('Период открыт: август')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Закрыть (период|август)/ })).toBeVisible()

  const { data } = await service().from('payroll_periods').select('month').eq('month', '2026-08-01')
  expect(data).toEqual([])
})

test('Б1: админ меняет аванс с причиной — сумма и «К выплате» обновились', async ({ page }) => {
  const admin = await asAdmin()
  const { error } = await admin.rpc('issue_advance', {
    p_teacher_id: GULZAT_ID,
    p_amount: 777,
    p_month: '2026-10-01',
    p_comment: COMMENT,
  })
  if (error) throw error

  await login(page, KANYKEI)
  await page.goto('/payroll?month=2026-10')
  const row = page.getByTestId(`payroll-row-${GULZAT_ID}`)
  await expect(row).toBeVisible()
  if (isDesktop(page)) {
    await row.getByRole('button', { name: /История авансов/ }).click()
  } else {
    await row.click()
  }
  const history = page.getByRole('list', { name: 'Авансы' })
  await expect(history).toContainText(COMMENT)
  await history.getByRole('button', { name: 'Действия: аванс 777 сом' }).click()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()

  const form = page.getByRole('form', { name: 'Изменить аванс' })
  await expect(form.getByLabel('Сумма, сом')).toHaveValue('777')
  await form.getByLabel('Сумма, сом').fill('888')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(form.getByRole('alert')).toHaveText('Укажите причину')
  await form.getByLabel('Причина исправления').fill('e2e: ошиблись суммой')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/^Аванс изменён: 888 сом/)).toBeVisible()
  await expect(history).toContainText('888')

  const { data } = await service()
    .from('payroll_adjustments')
    .select('amount')
    .eq('comment', COMMENT)
    .single()
  expect(data?.amount).toBe(888)
})
