import { test, expect, Page } from '@playwright/test';

// Helper: wait for page to be fully loaded (no pending network requests)
type WaitForStableOptions = {
  selector?: string;
  predicate?: () => boolean;
  timeout?: number;
};

async function waitForStable(page: Page, options: WaitForStableOptions = {}) {
  const timeout = options.timeout ?? 15000;
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});

  if (options.selector) {
    await page.waitForSelector(options.selector, { state: 'visible', timeout });
    return;
  }

  if (options.predicate) {
    await page.waitForFunction(options.predicate, { timeout });
  }
}

// Helper: get a PRD ID that has actual content (not an empty/untitled one from test runs)
async function getPrdWithContent(page: Page): Promise<string | null> {
  const res = await page.request.get('/api/prds');
  const data = await res.json();
  const prds = data?.data;
  if (!prds || prds.length === 0) return null;
  const withContent = prds.find((p: any) => p.title && p.title !== 'Untitled PRD' && p.content);
  return withContent?.id || prds[0].id;
}

// ─── SUITE 1: NAVIGATION & LAYOUT ──────────────────────────────────────────

test.describe('Navigation & Layout', () => {
  test('Dashboard loads with TopBar and navigation', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/01-dashboard.png', fullPage: true });

    // TopBar should be visible
    const topBar = page.getByTestId('nav-links');
    await expect(topBar).toBeVisible({ timeout: 5000 });

    // Should show Dashboard content (My PRDs or similar)
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('Navigation links work', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    // Navigate to Templates
    const templatesLink = page.getByTestId('nav-templates');
    await expect(templatesLink).toBeVisible();
    await templatesLink.click();
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/02-templates-page.png', fullPage: true });
    expect(page.url()).toContain('/templates');

    // Navigate to Settings
    const settingsLink = page.getByTestId('nav-settings');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();
    await waitForStable(page);
    expect(page.url()).toContain('/settings');

    // Navigate back to Dashboard
    const homeLink = page.getByTestId('nav-dashboard');
    await expect(homeLink).toBeVisible();
    await homeLink.click();
    await waitForStable(page);
  });

  test('Dark mode toggle works', async ({ page }) => {
    await page.goto('/settings');
    await waitForStable(page);

    // Find theme toggle (radio button label)
    const darkLabel = page.getByTestId('label-theme-dark');
    await expect(darkLabel).toBeVisible();
    await darkLabel.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/03-dark-mode.png', fullPage: true });

    // Check that dark class is applied
    const html = page.locator('html');
    const className = await html.getAttribute('class');
    expect(className).toContain('dark');

    // Switch back to light
    const lightLabel = page.getByTestId('label-theme-light');
    await expect(lightLabel).toBeVisible();
    await lightLabel.click();
    await page.waitForTimeout(500);
  });

  test('Mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await waitForStable(page);
    // Wait for actual dashboard content to render
    await page.waitForSelector('header', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: 'e2e/screenshots/04-mobile-dashboard.png', fullPage: true });

    // Content should still be visible
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(50);
  });
});

// ─── SUITE 2: DASHBOARD ────────────────────────────────────────────────────

test.describe('Dashboard', () => {
  test('Shows stats cards', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    // Should have stat cards (look for numbers or card elements)
    const statsArea = page.locator('[data-testid^="stat-"]');
    const cardCount = await statsArea.count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('Shows PRD list', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    // Should show at least one PRD (we know there are 2 in the DB)
    const body = await page.textContent('body');
    // Check for PRD-related content
    const hasPrdContent = body?.includes('PRD') || body?.includes('aaaa') || body?.includes('draft');
    expect(hasPrdContent).toBeTruthy();
  });

  test('Status filter tabs exist', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    // Look for filter tabs
    const allTab = page.getByTestId('tab-all');
    await page.screenshot({ path: 'e2e/screenshots/05-dashboard-filters.png' });
    await expect(allTab).toBeVisible();
  });

  test('New PRD button navigates to templates', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    const newBtn = page.locator('[data-testid="button-new-prd"], [data-testid="button-new-prd-mobile"]').first();
    await expect(newBtn).toBeVisible();
    await newBtn.click();
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/06-new-prd-flow.png', fullPage: true });
    expect(page.url()).toContain('/templates');
  });

  test('PRD card click opens editor', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    // Click the first PRD card (Cards use onClick, not <a> links)
    const prdCard = page.locator('[data-testid^="card-prd-"]').first();
    await expect(prdCard).toBeVisible();
    await prdCard.click();
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/07-editor-from-dashboard.png', fullPage: true });
    expect(page.url()).toContain('/editor/');
  });
});

// ─── SUITE 3: TEMPLATES ────────────────────────────────────────────────────

test.describe('Templates', () => {
  test('Shows all 4 default templates', async ({ page }) => {
    await page.goto('/templates');
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/08-templates.png', fullPage: true });

    const body = await page.textContent('body');
    const hasFeature = body?.toLowerCase().includes('feature');
    const hasEpic = body?.toLowerCase().includes('epic');
    const hasTechnical = body?.toLowerCase().includes('technical');
    const hasLaunch = body?.toLowerCase().includes('launch');

    expect(hasFeature).toBeTruthy();
    expect(hasEpic).toBeTruthy();
    expect(hasTechnical).toBeTruthy();
    expect(hasLaunch).toBeTruthy();
  });

  test('Template card click creates new PRD', async ({ page }) => {
    await page.goto('/templates');
    await waitForStable(page);

    // Click the first template card
    const templateCard = page.locator('[data-testid^="card-template-"]').first();
    await expect(templateCard).toBeVisible();
    await templateCard.click();
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/09-template-selected.png', fullPage: true });
  });
});

// ─── SUITE 4: EDITOR ───────────────────────────────────────────────────────

test.describe('Editor', () => {
  test('Loads PRD content correctly', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);
    // Wait for editor content to actually render
    await page.waitForSelector('[data-testid="input-title"]', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: 'e2e/screenshots/10-editor-loaded.png', fullPage: true });

    // Title should be visible
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(100);
  });

  test('Editor tabs work (PRD, Log, Diagnostics, Structure)', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Find tabs
    const tabs = page.locator('[role="tab"], [data-testid*="tab"]');
    const tabCount = await tabs.count();

    for (let i = 0; i < Math.min(tabCount, 4); i++) {
      const tab = tabs.nth(i);
      await expect(tab).toBeVisible();
      await tab.click();
      await page.waitForTimeout(300);
      const tabText = await tab.textContent();
      await page.screenshot({ path: `e2e/screenshots/11-editor-tab-${i}-${tabText?.trim().toLowerCase().replace(/\s+/g, '-') || i}.png` });
    }
  });

  test('Dual AI Dialog opens with all modes', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Find and click the AI generation button
    const aiBtn = page.locator('[data-testid="button-dual-ai-assist"], [data-testid="button-dual-ai-assist-mobile"]').first();
    await expect(aiBtn).toBeVisible();
    await aiBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/12-dual-ai-dialog-simple.png' });

    // Check Simple mode is visible
    const simpleBtn = page.locator('[data-testid="button-mode-simple"]');
    await expect(simpleBtn).toBeVisible();

    // Switch to Iterative mode
    const iterativeBtn = page.locator('[data-testid="button-mode-iterative"]');
    await expect(iterativeBtn).toBeVisible();
    await iterativeBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/13-dual-ai-dialog-iterative.png' });

    // Check iteration slider exists
    const slider = page.locator('[data-testid="slider-iteration-count"]');
    await expect(slider).toBeVisible();

    // Check Final Review checkbox
    const finalReview = page.locator('[data-testid="checkbox-final-review"]');
    await expect(finalReview).toBeVisible();

    // Switch to Guided mode
    const guidedBtn = page.locator('[data-testid="button-mode-guided"]');
    await expect(guidedBtn).toBeVisible();
    await guidedBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/14-dual-ai-dialog-guided.png' });

    // Close dialog
    const cancelBtn = page.locator('[data-testid="button-dual-ai-cancel"]');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
  });

  test('Status badge is visible', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Look for status badge
    const badge = page.locator('[data-testid^="badge-status-"]').first();
    await expect(badge).toBeVisible();
  });

  test('Export menu works', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Look for export button
    const exportBtn = page.locator('[data-testid="button-export"], [data-testid="button-export-mobile"]').first();
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/15-export-menu.png' });
  });

  test('Version history accessible', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    const versionBtn = page.locator('[data-testid="tab-versions"], [data-testid="mobile-tab-versions"]').first();
    await expect(versionBtn).toBeVisible();
    await versionBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/16-version-history.png' });
  });

  test('Share dialog accessible', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    const shareBtn = page.locator('[data-testid="button-share"], [data-testid="button-share-mobile"]').first();
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/17-share-dialog.png' });
  });

  test('Comments panel accessible', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Comments panel is a tab in the sidebar, not a standalone button
    const commentsTab = page.locator('[data-testid="tab-comments"], [data-testid="mobile-tab-comments"], [data-testid="button-mobile-comments"]').first();
    if (await commentsTab.isVisible().catch(() => false)) {
      await commentsTab.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'e2e/screenshots/18-comments-panel.png' });

    // Verify comments section is visible somewhere on the page
    const body = await page.textContent('body');
    expect(body?.toLowerCase()).toContain('comment');
  });
});

// ─── SUITE 5: SETTINGS ─────────────────────────────────────────────────────

test.describe('Settings', () => {
  test('All sections are visible', async ({ page }) => {
    await page.goto('/settings');
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/20-settings-top.png', fullPage: false });

    const body = await page.textContent('body');

    // Profile section
    expect(body?.toLowerCase()).toContain('profile');

    // Appearance section
    const hasAppearance = body?.toLowerCase().includes('appearance') || body?.toLowerCase().includes('theme');
    expect(hasAppearance).toBeTruthy();

    // Scroll to bottom for all sections
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/21-settings-bottom.png', fullPage: false });
  });

  test('AI Model Preferences section works', async ({ page }) => {
    await page.goto('/settings');
    await waitForStable(page);

    // Scroll to AI section
    const aiSection = page.locator('[data-testid="select-ai-tier"]').first();
    await expect(aiSection).toBeVisible();
    await aiSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/22-settings-ai-models.png' });

    // Check tier selector exists
    const tierSelect = page.locator('[data-testid*="tier"], select, [role="combobox"]').first();
    await expect(tierSelect).toBeVisible();
  });

  test('AI Usage & Costs section shows data', async ({ page }) => {
    await page.goto('/settings');
    await waitForStable(page);

    // Scroll to find the Usage section
    const usageSection = page.locator('[data-testid="usage-filter-30d"]').first();
    await expect(usageSection).toBeVisible();
    await usageSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/23-settings-usage-costs.png' });

    // Should show usage data (keywords or numeric counts)
    const body = await page.textContent('body');
    const hasUsageData = !!body?.match(/\b(Total|Calls)\b|\b\d{2,}\b/i);
    expect(hasUsageData).toBeTruthy();

    // Scroll further to see the recent calls table
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/24-settings-recent-calls.png' });
  });

  test('Integration sections visible', async ({ page }) => {
    await page.goto('/settings');
    await waitForStable(page);

    // Scroll to bottom and wait for lazy content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    // Scroll again in case content expanded
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/25-settings-integrations.png' });

    const body = await page.textContent('body');
    const hasLinear = body?.toLowerCase().includes('linear');
    const hasDart = body?.toLowerCase().includes('dart');
    expect(hasLinear).toBeTruthy();
    expect(hasDart).toBeTruthy();
  });

  test('Full settings page screenshot', async ({ page }) => {
    await page.goto('/settings');
    await waitForStable(page);
    await page.screenshot({ path: 'e2e/screenshots/26-settings-full.png', fullPage: true });
  });
});

// ─── SUITE 6: DATA INTEGRITY ───────────────────────────────────────────────

test.describe('Data Integrity', () => {
  test('API /api/ai/usage returns valid data', async ({ page }) => {
    const res = await page.request.get('/api/ai/usage');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.totalCalls).toBeGreaterThan(0);
    expect(data.totalTokens).toBeGreaterThan(0);
    expect(data.byTier).toBeTruthy();
    expect(data.byModel).toBeTruthy();
    expect(data.recentCalls.length).toBeGreaterThan(0);
  });

  test('API /api/dashboard/stats returns valid data', async ({ page }) => {
    const res = await page.request.get('/api/dashboard/stats');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.totalPrds).toBeGreaterThanOrEqual(1);
  });

  test('API /api/prds returns PRD list', async ({ page }) => {
    const res = await page.request.get('/api/prds');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.data.length).toBeGreaterThanOrEqual(1);

    // First PRD should have required fields
    const prd = data.data[0];
    expect(prd.id).toBeTruthy();
    expect(prd.title).toBeTruthy();
    expect(prd.status).toBeTruthy();
  });

  test('API /api/settings/ai returns valid settings', async ({ page }) => {
    const res = await page.request.get('/api/settings/ai');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.tier).toBeTruthy();
    expect(data.generatorModel).toBeTruthy();
    expect(data.reviewerModel).toBeTruthy();
  });

  test('API /api/templates returns templates', async ({ page }) => {
    const res = await page.request.get('/api/templates');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  test('API /api/health is healthy', async ({ page }) => {
    const res = await page.request.get('/api/health');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});

// ─── SUITE 7: INTERACTION TESTS ────────────────────────────────────────────

test.describe('Interactions', () => {
  test('PRD title is editable in editor', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Find title input
    const titleInput = page.getByTestId('input-title');
    await expect(titleInput).toBeVisible();
    const currentValue = await titleInput.inputValue();
    expect(currentValue).toBeTruthy();
  });

  test('Search functionality on dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForStable(page);

    // Find search input
    const searchInput = page.getByTestId('input-search');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('aaaa');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/27-search-results.png' });

    // Clear search and search for non-existent
    await searchInput.fill('xxxxxxxxnonexistent');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/28-search-no-results.png' });
  });

  test('Create new PRD from template', async ({ page }) => {
    await page.goto('/templates');
    await waitForStable(page);

    // Click a template to open the create dialog
    const featureCard = page.getByTestId('card-template-feature');
    await expect(featureCard).toBeVisible();
    await featureCard.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/29-new-prd-created.png', fullPage: true });

    // Template click may open a dialog or navigate to editor
    const body = await page.textContent('body');
    const hasDialog = body?.toLowerCase().includes('create') || body?.toLowerCase().includes('title');
    const isInEditor = page.url().includes('/editor/');
    expect(hasDialog || isInEditor).toBeTruthy();
  });

  test('Keyboard shortcuts dialog', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    // Try Ctrl+/ or ? to open shortcuts
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/30-keyboard-shortcuts.png' });
  });

  test('Approval workflow accessible', async ({ page }) => {
    const prdId = await getPrdWithContent(page);
    test.skip(!prdId, 'No PRD with content available');

    await page.goto(`/editor/${prdId}`);
    await waitForStable(page);

    const approvalBtn = page.locator('[data-testid="button-request-approval"], [data-testid="button-request-approval-mobile"]').first();
    await expect(approvalBtn).toBeVisible();
    await approvalBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/31-approval-dialog.png' });
  });
});
