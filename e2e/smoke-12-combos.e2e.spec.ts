/**
 * Smoke test: 12 combinations of 4 templates × 3 methods.
 *
 * Calls the live API (localhost:5000) with free-tier models,
 * then validates each result through compilePrdDocument().
 *
 * Run: npx playwright test e2e/smoke-12-combos.e2e.spec.ts
 */
import { test, expect } from '@playwright/test';
import { compilePrdDocument } from '../server/prdCompiler';
import { qualityScore } from '../server/prdCompilerFinalizer';
import { getAuthHeader } from './helpers/clerk-auth';
import fs from 'fs';
import path from 'path';

const TEMPLATES = ['feature', 'epic', 'technical', 'product-launch'] as const;
const METHODS = ['simple', 'iterative', 'guided'] as const;

type Template = (typeof TEMPLATES)[number];
type Method = (typeof METHODS)[number];

const PROJECT_IDEAS: Record<Template, string> = {
  feature:
    'Build a user authentication system with email and password login, password reset via email link, multi-factor authentication using TOTP, session management with configurable expiry, and an admin audit log for all auth events.',
  epic:
    'Build a complete e-commerce platform with a browsable product catalogue supporting categories and filters, a persistent shopping cart, a multi-step checkout flow with address and payment entry, Stripe payment processing, real-time order tracking with status updates, and warehouse inventory management with low-stock alerts.',
  technical:
    'Build an API gateway service with dynamic request routing based on path and header rules, sliding-window rate limiting per API key, JWT-based authentication with key rotation, response caching with configurable TTL, a circuit breaker pattern for downstream services, and a Prometheus-compatible observability dashboard.',
  'product-launch':
    'Launch a SaaS analytics dashboard with an interactive onboarding wizard for new organisations, Stripe-based subscription billing with free trial support, drag-and-drop data visualization widgets including charts and tables, a shareable public dashboard feature, and a go-to-market readiness checklist with milestone tracking.',
};

interface ComboResult {
  template: Template;
  method: Method;
  valid: boolean;
  featureCount: number;
  qualityScore: number;
  errorIssues: string[];
  warningIssues: string[];
  modelsUsed: string[];
  tokensUsed: number;
  durationMs: number;
  truncatedLikely: boolean;
  error?: string;
}

const BASE_URL = 'http://localhost:5000';
const results: ComboResult[] = [];

async function authHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthHeader();
  return { ...auth, 'Content-Type': 'application/json' };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type ApiResult = { content: string; modelsUsed: string[]; tokens: number };

/** Retry wrapper: retries a call up to `retries` times with delay between attempts. */
async function withRetry(
  fn: () => Promise<ApiResult>,
  label: string,
  retries = 2,
  retryDelay = 15_000,
): Promise<ApiResult> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.log(`    ↻ Retry ${attempt}/${retries} for ${label} after ${retryDelay / 1000}s pause...`);
      await delay(retryDelay);
    }
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const isRetryable = /500|502|503|429|rate limit|empty response|fetch failed|ECONNRESET/i.test(e.message || '');
      if (!isRetryable || attempt === retries) throw e;
    }
  }
  throw lastError;
}

async function callSimple(template: Template): Promise<ApiResult> {
  return withRetry(async () => {
    const headers = await authHeaders(); // fresh JWT per attempt
    const res = await fetch(`${BASE_URL}/api/ai/generate-dual`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userInput: PROJECT_IDEAS[template],
        mode: 'generate',
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`generate-dual failed (${res.status}): ${text.substring(0, 200)}`);
    }
    const data = await res.json();
    return {
      content: data.finalContent || '',
      modelsUsed: data.modelsUsed || [],
      tokens: data.totalTokens || 0,
    };
  }, `simple/${template}`);
}

async function callIterative(template: Template): Promise<ApiResult> {
  return withRetry(async () => {
    const headers = await authHeaders(); // fresh JWT per attempt
    const res = await fetch(`${BASE_URL}/api/ai/generate-iterative`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        additionalRequirements: PROJECT_IDEAS[template],
        mode: 'generate',
        iterationCount: 2,
        useFinalReview: false,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`generate-iterative failed (${res.status}): ${text.substring(0, 200)}`);
    }
    const data = await res.json();
    return {
      content: data.finalContent || data.mergedPRD || '',
      modelsUsed: data.modelsUsed || [],
      tokens: data.totalTokens || 0,
    };
  }, `iterative/${template}`);
}

async function callGuided(template: Template): Promise<ApiResult> {
  return withRetry(async () => {
    const headers = await authHeaders(); // fresh JWT per attempt
    const res = await fetch(`${BASE_URL}/api/ai/guided-skip`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectIdea: PROJECT_IDEAS[template],
        mode: 'generate',
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`guided-skip failed (${res.status}): ${text.substring(0, 200)}`);
    }
    const data = await res.json();
    return {
      content: data.prdContent || '',
      modelsUsed: data.modelsUsed || [],
      tokens: data.tokensUsed || 0,
    };
  }, `guided/${template}`);
}

function validateAndRecord(
  template: Template,
  method: Method,
  content: string,
  modelsUsed: string[],
  tokens: number,
  durationMs: number,
  error?: string,
): ComboResult {
  if (error || !content) {
    const result: ComboResult = {
      template,
      method,
      valid: false,
      featureCount: 0,
      qualityScore: 0,
      errorIssues: [error || 'Empty content'],
      warningIssues: [],
      modelsUsed,
      tokensUsed: tokens,
      durationMs,
      truncatedLikely: false,
      error,
    };
    results.push(result);
    return result;
  }

  const compiled = compilePrdDocument(content, {
    mode: 'generate',
    language: 'en',
    templateCategory: template,
    strictCanonical: true,
    strictLanguageConsistency: true,
    enableFeatureAggregation: true,
  });

  const score = qualityScore(compiled.quality);
  const errorIssues = compiled.quality.issues
    .filter(i => i.severity === 'error')
    .map(i => `[${i.code}] ${i.message}`);
  const warningIssues = compiled.quality.issues
    .filter(i => i.severity === 'warning')
    .map(i => `[${i.code}] ${i.message}`);

  const result: ComboResult = {
    template,
    method,
    valid: compiled.quality.valid,
    featureCount: compiled.quality.featureCount ?? 0,
    qualityScore: score,
    errorIssues,
    warningIssues,
    modelsUsed,
    tokensUsed: tokens,
    durationMs,
    truncatedLikely: compiled.quality.truncatedLikely ?? false,
  };
  results.push(result);
  return result;
}

/**
 * Single test that runs all 12 combinations sequentially.
 * This avoids serial-mode skip-on-failure while keeping rate-limit-safe ordering.
 */
test('Smoke: all 12 PRD combinations (4 templates × 3 methods)', async () => {
  test.setTimeout(1_800_000); // 30 minutes for all 12 combos (free models are slow + retries)

  for (const template of TEMPLATES) {
    for (const method of METHODS) {
      const start = Date.now();

      let content = '';
      let modelsUsed: string[] = [];
      let tokens = 0;
      let error: string | undefined;

      try {
        const callFn = method === 'simple' ? callSimple
          : method === 'iterative' ? callIterative
          : callGuided;
        const result = await callFn(template);
        content = result.content;
        modelsUsed = result.modelsUsed;
        tokens = result.tokens;
      } catch (e: any) {
        error = e.message || String(e);
      }

      const durationMs = Date.now() - start;
      const combo = validateAndRecord(template, method, content, modelsUsed, tokens, durationMs, error);

      // Log progress
      const status = combo.valid ? 'PASS' : 'FAIL';
      const issues = combo.errorIssues.length ? ` | ${combo.errorIssues.join('; ')}` : '';
      console.log(`  [${status}] ${template}/${method} — features: ${combo.featureCount}, score: ${combo.qualityScore}, ${(durationMs / 1000).toFixed(1)}s${issues}`);

      // Pause between API calls for rate limiting (free models need longer cooldown)
      await delay(10_000);
    }
  }

  // Write results to file
  const reportPath = path.join(process.cwd(), '.tmp_smoke_12_results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Print summary table
  console.log('\n' + '='.repeat(90));
  console.log('  SMOKE TEST SUMMARY (12 Combinations)');
  console.log('='.repeat(90));
  console.log(
    '  Template'.padEnd(18) +
    'Method'.padEnd(14) +
    'Valid'.padEnd(8) +
    'Features'.padEnd(10) +
    'Score'.padEnd(8) +
    'Time'.padEnd(10) +
    'Errors'
  );
  console.log('-'.repeat(90));

  let passCount = 0;
  for (const r of results) {
    const valid = r.valid ? 'PASS' : 'FAIL';
    console.log(
      `  ${r.template.padEnd(16)}${r.method.padEnd(14)}${valid.padEnd(8)}${String(r.featureCount).padEnd(10)}${String(r.qualityScore).padEnd(8)}${(r.durationMs / 1000).toFixed(1).padEnd(10)}${r.errorIssues.length ? r.errorIssues[0].substring(0, 40) : '-'}`
    );
    if (r.valid) passCount++;
  }

  console.log('-'.repeat(90));
  console.log(`  Total: ${results.length} | Passed: ${passCount} | Failed: ${results.length - passCount}`);
  console.log('='.repeat(90));
  console.log(`\n  Results saved to: ${reportPath}\n`);

  // Final assertions — all combos should have completed
  expect(results.length, 'All 12 combinations should have results').toBe(12);

  // Check for API failures (hard fail)
  const apiFailures = results.filter(r => r.error);
  expect(apiFailures.length, `${apiFailures.length} API calls failed: ${apiFailures.map(r => `${r.template}/${r.method}: ${r.error}`).join('; ')}`).toBe(0);

  // Check for free models (hard fail)
  for (const r of results) {
    for (const model of r.modelsUsed) {
      expect(model, `Non-free model in ${r.template}/${r.method}: ${model}`).toMatch(/:free$/);
    }
  }

  // Report quality gate results (soft — we want to see the full picture)
  const qualityFailures = results.filter(r => !r.valid && !r.error);
  if (qualityFailures.length > 0) {
    console.log(`\n  QUALITY GATE FAILURES (${qualityFailures.length}):`);
    for (const r of qualityFailures) {
      console.log(`    ${r.template}/${r.method}:`);
      for (const issue of r.errorIssues) {
        console.log(`      - ${issue}`);
      }
    }
  }

  // Soft check — ideally all pass, but we want the full report first
  expect.soft(
    qualityFailures.length,
    `${qualityFailures.length}/12 quality gate failures — see report above`
  ).toBe(0);
});
