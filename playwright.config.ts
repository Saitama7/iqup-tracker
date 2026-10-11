import { defineConfig, devices } from '@playwright/test'
import { localSupabase } from './scripts/local-supabase.ts'

// Separate port per checkout: `reuseExistingServer` would otherwise pick up another worktree's build.
const PORT = Number(process.env.E2E_PORT ?? 4173)

// Auth e2e runs against the local stack (`supabase start` + `pnpm seed:users`).
// process.env beats .env.local in Vite, so a remote URL there is never used by tests.
function supabaseEnv(): Record<string, string> {
  try {
    const { apiUrl, anonKey } = localSupabase()
    return { VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_ANON_KEY: anonKey }
  } catch {
    return {}
  }
}

const PAYROLL = /payroll\.spec\.ts$/
const PHONE = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }
const DESKTOP = { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } }

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'webkit',
      testIgnore: PAYROLL,
      // Device descriptor reports 390×664 (minus Safari UI); issue asks for full 390×844 screen.
      use: PHONE,
    },
    {
      name: 'webkit-desktop',
      testIgnore: PAYROLL,
      use: DESKTOP,
    },
    // payroll.spec sums the seed's held September, and teacher-attendance.spec holds (and then
    // removes) an extra September lesson while it runs — so the payroll checks go after the rest.
    {
      name: 'webkit-payroll',
      testMatch: PAYROLL,
      dependencies: ['webkit', 'webkit-desktop'],
      use: PHONE,
    },
    {
      name: 'webkit-desktop-payroll',
      testMatch: PAYROLL,
      dependencies: ['webkit', 'webkit-desktop'],
      use: DESKTOP,
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: supabaseEnv(),
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
