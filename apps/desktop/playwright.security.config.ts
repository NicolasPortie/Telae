import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'renderer-security.spec.ts',
  timeout: 30_000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: 'test-results/security',
  reporter: 'line',
  use: { trace: 'retain-on-failure' },
})
