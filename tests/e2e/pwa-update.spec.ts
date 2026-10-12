import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { GULZAT, login } from './support/auth'

// #56: after a deploy an open tab must not sit on a stale bundle or a white screen.

test.describe('service worker update', () => {
  test('open tab gets «Доступна новая версия» and reloads onto the new bundle', async ({
    page,
  }, testInfo) => {
    // Edits dist/sw.js: one project only, so two workers never race on the file.
    test.skip(testInfo.project.name !== 'webkit', 'phone project only')
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      await navigator.serviceWorker.ready
      return true
    })
    test.skip(!registered, 'no service worker support in this browser build')

    // «Deploy»: sw.js on the server changes and the open tab checks for it. WebKit doesn't route
    // service worker requests through page.route, so edit the served file for a moment — same
    // length (`vite preview` keeps file sizes from startup), one precache revision differs.
    const swFile = join(process.cwd(), 'dist', 'sw.js')
    const original = readFileSync(swFile, 'utf8')
    const at = original.indexOf('revision:"') + 'revision:"'.length
    const flipped = original[at] === '0' ? '1' : '0'
    writeFileSync(swFile, original.slice(0, at) + flipped + original.slice(at + 1))
    try {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
      })
    } finally {
      writeFileSync(swFile, original)
    }

    await expect(page.getByText('Доступна новая версия')).toBeVisible()
    const refresh = page.getByRole('button', { name: 'Обновить' })
    expect((await refresh.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    // sonner slides the toast in: wait for the enter transition before the screenshot
    await expect(page.locator('[data-sonner-toast]')).toHaveCSS('opacity', '1')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('update-toast.png') })

    await Promise.all([page.waitForEvent('load'), refresh.click()])
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    await expect(page.getByText('Доступна новая версия')).toHaveCount(0)
  })
})

test.describe('stale bundle', () => {
  // Without a service worker every request goes through page.route.
  test.use({ serviceWorkers: 'block' })

  test('a chunk the deploy no longer has ends on «Обновить приложение», not a white screen', async ({
    page,
  }, testInfo) => {
    let attempts = 0
    await page.route('**/assets/login-*.js', (route) => {
      attempts += 1
      return route.abort()
    })
    await page.goto('/login')

    // TanStack Router reloads once by itself, then the error screen.
    await expect.poll(() => attempts).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('heading', { name: 'Что-то пошло не так' })).toBeVisible()
    const reset = page.getByRole('button', { name: 'Обновить приложение' })
    await expect(reset).toBeVisible()
    expect((await reset.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: testInfo.outputPath('error-screen.png') })

    // The button drops service workers + caches and reloads. (WebKit remembers a failed module URL
    // for the page, so the restored chunk can't be checked here; the cleanup is in app-reset.test.ts.)
    await page.evaluate(() => {
      ;(window as unknown as { beforeReset?: boolean }).beforeReset = true
    })
    await Promise.all([page.waitForEvent('load'), reset.click()])
    expect(
      await page.evaluate(() => (window as unknown as { beforeReset?: boolean }).beforeReset),
    ).toBeUndefined()
  })
})

test('profile shows the build version', async ({ page }, testInfo) => {
  await login(page, GULZAT)
  await page.goto('/profile')
  await expect(page.getByText(/^Версия \S+$/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('profile-version.png'), fullPage: true })
})
