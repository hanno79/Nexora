import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) continue;

    const key = line.slice(0, equalIndex).trim();
    const rawValue = line.slice(equalIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (!key) continue;
    if (/<[^>]+>/.test(value)) continue;

    env[key] = value;
  }

  return env;
}

const envFromFile = loadEnvFile(path.resolve(process.cwd(), '.env'));
const fallbackDatabaseUrl = 'postgresql://nexora:nexora_password@localhost:5432/nexora';
const webServerEnv = {
  ...envFromFile,
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || envFromFile.DATABASE_URL || fallbackDatabaseUrl,
  LOCAL_DEMO_AUTH: 'true',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5000',
    reuseExistingServer: process.env.PW_REUSE_SERVER === 'true',
    timeout: 120000,
    env: webServerEnv,
  },
  use: {
    baseURL: 'http://localhost:5000',
    screenshot: 'on',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
