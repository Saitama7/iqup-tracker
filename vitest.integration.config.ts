import { defineConfig } from 'vitest/config'

// Integration tests against the local Supabase stack (see tests/integration/*).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
})
