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
  // payroll.spec and the specs that change the seed's months share a lock, not an order (#27):
  // tests/e2e/support/seed-lock.ts.
  projects: [
    { name: 'webkit', use: PHONE },
    { name: 'webkit-desktop', use: DESKTOP },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // a shell NODE_ENV=test (for vitest) would build dev React with StrictMode — not what CI tests (#68)
    env: { ...supabaseEnv(), NODE_ENV: 'production' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
