/**
 * Debug test: verify signInViaBrowser works end-to-end.
 */
import { test } from '@playwright/test';
import { initClerkTesting, signInViaBrowser } from './helpers/clerk-browser-auth';
import fs from 'fs';

test('debug: signInViaBrowser end-to-end', async ({ browser }) => {
  test.setTimeout(120_000);
  await initClerkTesting();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    console.log('Calling signInViaBrowser...');
    await signInViaBrowser(page);
    console.log('signInViaBrowser completed!');

    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/debug-dashboard.png', fullPage: true });
    console.log('URL:', page.url());

    const stats = await page.locator('[data-testid="value-total-prds"]').isVisible().catch(() => false);
    const onboarding = await page.locator('[data-testid="button-skip-onboarding"]').isVisible().catch(() => false);
    console.log('Dashboard stats:', stats, 'Onboarding:', onboarding);
  } catch (err: any) {
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/debug-signin-error.png', fullPage: true }).catch(() => {});
    console.log('Error:', err.message);
    throw err;
  } finally {
    await context.close();
  }
});
