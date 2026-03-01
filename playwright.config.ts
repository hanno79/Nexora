import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'api',
      testMatch: [
        '**/guided-prd-compiler.e2e.spec.ts',
        '**/smoke-12-combos.e2e.spec.ts',
      ],
    },
    {
      name: 'browser',
      testMatch: '**/gui-*.e2e.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        screenshot: 'only-on-failure',
      },
    },
  ],
});
