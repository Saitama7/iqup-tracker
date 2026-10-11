import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Integration tests against the local Supabase stack (see tests/integration/*).
// `@` — same alias as vite.config.ts: payroll.test.ts imports calc.ts from src.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
})
