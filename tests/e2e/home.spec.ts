import { expect, test } from '@playwright/test'

test('home shows title on iPhone 13 (WebKit 390×844)', async ({ page }, testInfo) => {
  await page.goto('/')
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { level: 1, name: 'IQ UP Tracker' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home-390.png'), fullPage: true })
})
