/**
 * GUI Smoke Test: 12 PRD combinations via Playwright browser automation.
 *
 * Drives the full Nexora GUI workflow for all 4 templates × 3 methods.
 * Creates PRD records through the UI, triggers AI generation, and verifies
 * the resulting PRDs appear on the dashboard.
 *
 * Prerequisites:
 *   - Nexora server running at http://localhost:5000 (Docker)
 *   - Free-tier models configured (development tier = default)
 *   - Playwright Chromium browser installed
 *
 * Run: npx playwright test e2e/gui-12-combos.e2e.spec.ts --project=browser
 */
import { test, expect, Browser, Page } from '@playwright/test';
import { signInViaBrowser, initClerkTesting } from './helpers/clerk-browser-auth';
import fs from 'fs';
import path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEMPLATES = ['feature', 'epic', 'technical', 'product-launch'] as const;
const METHODS = ['simple', 'iterative', 'guided'] as const;
type Template = (typeof TEMPLATES)[number];
type Method = (typeof METHODS)[number];

const GERMAN_PROMPT =
  'Erstelle eine umfassende Todoliste Webapp für mich in welcher ich Code Bugs und ' +
  'neue Ideen erfassen kann. Die App sollte einfach und gut durchdacht sein. Sie soll ein ' +
  'tolles Farbschema haben und Primärfarben verwenden, zum Beispiel dunkelblau weiss mit ' +
  'dezenten Akzenten. Nutze shadcn als Design System.';

const AI_TIMEOUT: Record<Method, number> = {
  simple: 15 * 60_000,
  iterative: 45 * 60_000,
  guided: 25 * 60_000,
};

const INTER_COMBO_DELAY_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ComboResult {
  template: Template;
  method: Method;
  prdId: string;
  title: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Sign in and create a page ready for authenticated navigation. */
async function createAuthenticatedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signInViaBrowser(page);
  return page;
}

/** Dismiss onboarding banner if it appears. */
async function dismissOnboarding(page: Page): Promise<void> {
  const skipBtn = page.locator('[data-testid="button-skip-onboarding"]');
  if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipBtn.click();
    await delay(500);
  }
}

async function getDashboardPrdCount(browser: Browser): Promise<number> {
  const page = await createAuthenticatedPage(browser);
  try {
    await page.goto('http://localhost:5000/', { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(page);
    await page.waitForSelector('[data-testid="value-total-prds"]', { timeout: 15_000 });
    const text = await page.locator('[data-testid="value-total-prds"]').textContent();
    return parseInt(text?.trim() || '0', 10);
  } finally {
    await page.context().close();
  }
}

// ─── Core Combo Runner ────────────────────────────────────────────────────────

async function runCombo(
  browser: Browser,
  template: Template,
  method: Method,
  comboIndex: number,
): Promise<ComboResult> {
  const start = Date.now();
  const title = `[GUI:${comboIndex}] ${template}/${method} - Todo Webapp`;
  let prdId = 'none';

  // Each combo gets its own authenticated browser context
  const page = await createAuthenticatedPage(browser);

  try {
    // ── Step 1: Navigate to /templates ───────────────────────────────────
    await page.goto('http://localhost:5000/templates', { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(page);
    await page.waitForSelector(`[data-testid="card-template-${template}"]`, { timeout: 30_000 });

    // ── Step 2: Click template card ──────────────────────────────────────
    await page.click(`[data-testid="card-template-${template}"]`);
    await page.waitForSelector('[data-testid="input-prd-title"]', { state: 'visible', timeout: 10_000 });

    // ── Step 3: Fill PRD metadata ─────────────────────────────────────────
    await page.fill('[data-testid="input-prd-title"]', title);
    await page.fill('[data-testid="input-prd-description"]', `GUI smoke test: ${template}/${method}`);

    // ── Step 4: Create PRD → navigate to /editor/{id} ─────────────────────
    // waitForFunction instead of waitForURL: wouter uses history.pushState
    // which Playwright's waitForURL does not reliably detect
    await page.click('[data-testid="button-create-prd"]');
    await page.waitForFunction(
      () => /\/editor\/\d+/.test(window.location.pathname),
      { timeout: 90_000 },
    );
    prdId = page.url().match(/\/editor\/(\d+)/)?.[1] || 'unknown';

    // ── Step 5: Open Dual-AI Dialog ───────────────────────────────────────
    await page.waitForSelector('[data-testid="button-dual-ai-assist"]', { state: 'visible', timeout: 15_000 });
    await page.click('[data-testid="button-dual-ai-assist"]');
    await page.waitForSelector('[data-testid="dialog-dual-ai"]', { state: 'visible', timeout: 15_000 });

    // ── Step 6: Select method mode ────────────────────────────────────────
    if (method === 'iterative') {
      await page.click('[data-testid="button-mode-iterative"]');
      // Wait for slider, then reduce to 2 iterations (ArrowLeft from default 3)
      const sliderThumb = page.locator('[data-testid="slider-iteration-count"] [role="slider"]');
      await sliderThumb.waitFor({ state: 'visible', timeout: 3_000 });
      await sliderThumb.focus();
      await page.keyboard.press('ArrowLeft');
    } else if (method === 'guided') {
      await page.click('[data-testid="button-mode-guided"]');
    }
    // simple is the default — no click needed

    // ── Step 7: Enter prompt ──────────────────────────────────────────────
    await page.fill('[data-testid="textarea-dual-ai-input"]', GERMAN_PROMPT);

    // ── Step 8: Trigger generation ────────────────────────────────────────
    const aiTimeout = AI_TIMEOUT[method];

    if (method === 'guided') {
      // Click "Start Guided Session" → GuidedAiDialog opens & auto-starts
      await page.click('[data-testid="button-dual-ai-guided"]');
      await page.waitForSelector('[data-testid="dialog-guided-ai"]', { state: 'visible', timeout: 10_000 });

      // Wait for questions step (button-skip-questions becomes visible)
      try {
        await page.waitForSelector('[data-testid="button-skip-questions"]', {
          state: 'visible',
          timeout: aiTimeout,
        });
        // Skip questions → triggers finalize
        await page.click('[data-testid="button-skip-questions"]');
      } catch {
        // If skip-questions never appeared, dialog may have errored
        const guidedVisible = await page.locator('[data-testid="dialog-guided-ai"]').isVisible();
        if (guidedVisible) {
          // Check for error message
          const errorText = await page.locator('[data-testid="dialog-guided-ai"] .text-destructive').textContent().catch(() => null);
          if (errorText) throw new Error(`Guided AI error: ${errorText.trim()}`);
        }
      }

      // Wait for both dialogs to close (guided closes → dual-ai closes via chain)
      await page.waitForSelector('[data-testid="dialog-dual-ai"]', {
        state: 'hidden',
        timeout: aiTimeout,
      });
    } else {
      // Simple or Iterative: click generate, wait for dialog to close
      await page.click('[data-testid="button-dual-ai-generate"]');

      // Race between success (dialog auto-closes) and error (error div appears)
      const dialogHidden = page.waitForSelector('[data-testid="dialog-dual-ai"]', {
        state: 'hidden',
        timeout: aiTimeout,
      });
      const errorVisible = page.waitForSelector(
        '[data-testid="dialog-dual-ai"] [role="alert"], [data-testid="dialog-dual-ai"] .text-destructive',
        { state: 'visible', timeout: aiTimeout },
      );

      const raceResult = await Promise.race([
        dialogHidden.then(() => 'success' as const),
        errorVisible.then(() => 'error' as const),
      ]);

      if (raceResult === 'error') {
        const alertEl = page.locator('[data-testid="dialog-dual-ai"] [role="alert"], [data-testid="dialog-dual-ai"] .text-destructive');
        const errMsg = await alertEl.textContent().catch(() => 'Unknown error');
        throw new Error(`AI generation failed: ${errMsg?.trim()}`);
      }
    }

    // ── Step 9: Wait for auto-save ────────────────────────────────────────
    // handleDualAiContentGenerated fires PATCH automatically
    await delay(3_000);

    return {
      template,
      method,
      prdId,
      title,
      success: true,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    // Take screenshot for debugging
    const screenshotDir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(screenshotDir, `combo-${template}-${method}-error.png`),
      fullPage: true,
    }).catch(() => {});

    return {
      template,
      method,
      prdId,
      title,
      success: false,
      error: err.message || String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    await page.context().close();
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test('GUI smoke: all 12 PRD combinations (4 templates × 3 methods)', async ({ browser }) => {
  // 10 Minuten in CI, 4 Stunden lokal (free models are slow)
  const CI_TIMEOUT = process.env.CI ? 600_000 : 14_400_000;
  test.setTimeout(CI_TIMEOUT);

  // Initialize Clerk testing mode (once)
  await initClerkTesting();

  // Record baseline PRD count
  const initialCount = await getDashboardPrdCount(browser);
  console.log(`\n  Dashboard baseline: ${initialCount} PRDs\n`);

  const results: ComboResult[] = [];
  let comboIndex = 0;

  for (const template of TEMPLATES) {
    for (const method of METHODS) {
      comboIndex++;
      console.log(`  [${comboIndex}/12] Starting: ${template}/${method}...`);

      const result = await runCombo(browser, template, method, comboIndex);
      results.push(result);

      const status = result.success ? 'PASS' : 'FAIL';
      const duration = (result.durationMs / 1000).toFixed(1);
      const suffix = result.error ? ` | ${result.error.substring(0, 80)}` : '';
      console.log(`  [${comboIndex}/12] ${status}: ${template}/${method} — ${duration}s, prdId=${result.prdId}${suffix}`);

      // Rate-limit cooldown between combos
      if (comboIndex < 12) {
        console.log(`  Cooling down ${INTER_COMBO_DELAY_MS / 1000}s...`);
        await delay(INTER_COMBO_DELAY_MS);
      }
    }
  }

  // ── Results Report ──────────────────────────────────────────────────────────
  const reportDir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'gui-smoke-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), initialCount, results }, null, 2));

  const passCount = results.filter(r => r.success).length;
  const failCount = results.length - passCount;

  // Verify dashboard
  let finalCount = initialCount;
  try {
    finalCount = await getDashboardPrdCount(browser);
  } catch {
    console.log('  Warning: Could not read final dashboard count');
  }

  // Print summary
  console.log('\n' + '='.repeat(75));
  console.log('  GUI SMOKE TEST SUMMARY (12 Combinations)');
  console.log('='.repeat(75));
  console.log('  Template'.padEnd(20) + 'Method'.padEnd(14) + 'Status'.padEnd(8) + 'PRD ID'.padEnd(10) + 'Time');
  console.log('-'.repeat(75));
  for (const r of results) {
    console.log(
      `  ${r.template.padEnd(18)}${r.method.padEnd(14)}${(r.success ? 'PASS' : 'FAIL').padEnd(8)}${r.prdId.padEnd(10)}${(r.durationMs / 1000).toFixed(0)}s` +
      (r.error ? ` | ${r.error.substring(0, 40)}` : ''),
    );
  }
  console.log('-'.repeat(75));
  console.log(`  Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
  console.log(`  Dashboard PRDs: ${initialCount} → ${finalCount} (+${finalCount - initialCount})`);
  console.log('='.repeat(75));
  console.log(`\n  Results saved to: ${reportPath}\n`);

  // ── Assertions ───────────────────────────────────────────────────────────────
  expect(results.length, 'All 12 combinations should have results').toBe(12);

  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      console.log(`    ${f.template}/${f.method}: ${f.error}`);
    }
  }

  // Soft assert — we want the full report even if some fail
  expect.soft(
    failures.length,
    `${failures.length}/12 GUI combos failed — see report above`,
  ).toBe(0);

  expect.soft(
    finalCount - initialCount,
    `Expected ${passCount} new PRDs on dashboard, got ${finalCount - initialCount}`,
  ).toBe(passCount);
});
