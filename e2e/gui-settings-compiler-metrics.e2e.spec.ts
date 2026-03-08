import { test, expect, type Page } from "@playwright/test";
import { initClerkTesting, signInViaBrowser } from "./helpers/clerk-browser-auth";

async function installSettingsApiMocks(page: Page) {
  await page.route("**/api/auth/user", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_test",
        email: "hanno.rahn@gmail.com",
        firstName: "Hanno",
        lastName: "Rahn",
        profileImageUrl: null,
        company: "Nexora",
        role: "Developer",
      }),
    });
  });

  await page.route("**/api/settings/ai", async route => {
    if (route.request().method() === "PATCH" || route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatorModel: "google/gemini-2.5-flash",
        reviewerModel: "anthropic/claude-haiku-4",
        verifierModel: "mistralai/mistral-small-3.1-24b-instruct",
        fallbackChain: ["google/gemma-3-27b-it:free"],
        tier: "development",
        tierModels: {
          development: {
            generatorModel: "google/gemini-2.5-flash",
            reviewerModel: "anthropic/claude-haiku-4",
            verifierModel: "mistralai/mistral-small-3.1-24b-instruct",
            fallbackChain: ["google/gemma-3-27b-it:free"],
          },
        },
        tierDefaults: {
          development: {
            generator: "google/gemini-2.5-flash",
            reviewer: "anthropic/claude-haiku-4",
            verifier: "mistralai/mistral-small-3.1-24b-instruct",
          },
        },
        iterativeMode: false,
        iterationCount: 3,
        iterativeTimeoutMinutes: 30,
        useFinalReview: false,
        guidedQuestionRounds: 3,
      }),
    });
  });

  await page.route("**/api/providers", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          { id: "openrouter", displayName: "OpenRouter", color: "#2563eb", configured: true },
          { id: "groq", displayName: "Groq", color: "#16a34a", configured: true },
        ],
      }),
    });
  });

  await page.route("**/api/models**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            id: "google/gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: "openrouter",
            contextLength: 128000,
            isFree: false,
            pricing: { input: 0.15, output: 0.6 },
            capabilities: ["chat"],
          },
          {
            id: "anthropic/claude-haiku-4",
            name: "Claude Haiku 4",
            provider: "openrouter",
            contextLength: 200000,
            isFree: false,
            pricing: { input: 0.8, output: 4 },
            capabilities: ["chat"],
          },
        ],
        providers: ["openrouter", "groq"],
        totalCount: 2,
        freeCount: 0,
      }),
    });
  });

  await page.route("**/api/openrouter/model-status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modelStatus: {} }),
    });
  });

  await page.route("**/api/linear/status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false }),
    });
  });

  await page.route("**/api/dart/status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false }),
    });
  });

  await page.route("**/api/ai/usage**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalCost: "0.0123",
        totalCalls: 12,
        totalTokens: 12345,
        totalInputTokens: 5678,
        totalOutputTokens: 6667,
        byTier: {},
        byModel: {},
        recentCalls: [],
      }),
    });
  });

  await page.route("**/api/ai/compiler-run-metrics**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        counts: {
          totalRuns: 8,
          passedRuns: 5,
          degradedRuns: 0,
          failedQualityRuns: 2,
          failedRuntimeRuns: 1,
          cancelledRuns: 0,
          acceptedRuns: 5,
        },
        rates: {
          acceptanceRate: 0.625,
          firstPassPassRate: 0.25,
          reviewerRepairRate: 0.5,
          semanticBlockRate: 0.25,
          hardFailRate: 0.375,
        },
        quality: {
          topRootCauses: [
            { code: "semantic_verifier_blocked", count: 3 },
            { code: "feature_near_duplicates_unmerged", count: 2 },
          ],
        },
        latency: {
          stages: {
            totalDurationMs: { p95: 125000 },
            routeDurationMs: { p95: 127000 },
            compilerFinalizationDurationMs: { p95: 34000 },
          },
        },
        costEstimate: {
          averageEstimatedCostUsdPerAcceptedRun: 0.0184,
          acceptedRunCoverageRate: 0.8,
        },
        alerts: [
          {
            code: "low_acceptance_rate",
            severity: "critical",
            title: "Compiler acceptance rate is below target",
            message: "Only 63% of recent runs were accepted.",
            recommendation: "Stabilize the highest-volume root cause before changing prompts.",
          },
          {
            code: "semantic_block_rate_high",
            severity: "critical",
            title: "Semantic verifier is blocking too many runs",
            message: "25% of recent runs failed at semantic verification.",
            recommendation: "Add or tighten deterministic semantic lints for the top blocker.",
          },
        ],
        healthState: "critical",
        recentRuns: [
          {
            timestamp: "2026-03-08T09:30:00.000Z",
            workflow: "guided",
            routeKey: "guided-finalize",
            qualityStatus: "passed",
            repairAttempts: 1,
            totalTokens: 4200,
            totalDurationMs: 118000,
          },
          {
            timestamp: "2026-03-08T09:10:00.000Z",
            workflow: "dual",
            routeKey: "dual-generate",
            qualityStatus: "failed_quality",
            repairAttempts: 2,
            totalTokens: 3900,
            totalDurationMs: 132000,
          },
        ],
      }),
    });
  });
}

test.describe("Settings compiler metrics", () => {
  test.beforeAll(async () => {
    await initClerkTesting();
  });

  test("renders compiler run health, alerts, and recent run signals in settings", async ({ page }) => {
    test.setTimeout(120_000);
    await installSettingsApiMocks(page);
    await signInViaBrowser(page);

    await page.goto("http://localhost:5000/settings", { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const body = page.locator("body");
    await expect(body).toContainText("Compiler Run Health", { timeout: 30_000 });
    await expect(body).toContainText("Critical");
    await expect(body).toContainText("Compiler acceptance rate is below target");
    await expect(body).toContainText("Semantic verifier is blocking too many runs");
    await expect(body).toContainText("semantic_verifier_blocked");
    await expect(body).toContainText("guided-finalize");
    await expect(body).toContainText("dual-generate");
  });
});
