/**
 * Smoke test: 12 combinations of 4 templates × 3 methods.
 *
 * Calls the live API (localhost:5000) with free-tier models,
 * then validates each result through compilePrdDocument().
 *
 * Run: npx playwright test e2e/smoke-12-combos.e2e.spec.ts
 */
import { test, expect, request } from '@playwright/test';
import { compilePrdDocument } from '../server/prdCompiler';
import { qualityScore } from '../server/prdCompilerFinalizer';
import { getAuthHeader } from './helpers/clerk-auth';
import { persistSmokeReport } from './helpers/smoke-report-persistence';
import fs from 'fs';
import path from 'path';

const ALL_TEMPLATES = ['feature', 'epic', 'technical', 'product-launch'] as const;
const ALL_METHODS = ['simple', 'iterative', 'guided'] as const;

type Template = (typeof ALL_TEMPLATES)[number];
type Method = (typeof ALL_METHODS)[number];

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

interface TemplateApiRecord {
  id: string;
  name: string;
  category: string;
  isDefault?: string | null;
  isMeta?: string | null;
}

const BASE_URL = 'http://localhost:5000';
const INITIAL_SMOKE_CONTENT = 'SMOKE-TEST-INITIALINHALT: Wird im Lauf durch das generierte PRD ersetzt.';
const AI_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const results: ComboResult[] = [];

// ÄNDERUNG 06.03.2026: Einzelne Smoke-Kombinationen via Umgebungsvariablen steuerbar machen.
function readTemplateSelection(): Template[] {
  const raw = process.env.SMOKE_TEMPLATE?.trim();
  if (!raw) return [...ALL_TEMPLATES];
  if (!(ALL_TEMPLATES as readonly string[]).includes(raw)) {
    throw new Error(`Ungültiger SMOKE_TEMPLATE-Wert: ${raw}`);
  }
  return [raw as Template];
}

function readMethodSelection(): Method[] {
  const raw = process.env.SMOKE_METHOD?.trim();
  if (!raw) return [...ALL_METHODS];
  if (!(ALL_METHODS as readonly string[]).includes(raw)) {
    throw new Error(`Ungültiger SMOKE_METHOD-Wert: ${raw}`);
  }
  return [raw as Method];
}

const SELECTED_TEMPLATES = readTemplateSelection();
const SELECTED_METHODS = readMethodSelection();
const EXPECTED_RESULT_COUNT = SELECTED_TEMPLATES.length * SELECTED_METHODS.length;

async function authHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthHeader();
  return { ...auth, 'Content-Type': 'application/json' };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type ApiResult = { content: string; modelsUsed: string[]; tokens: number };

// ÄNDERUNG 06.03.2026: Langläufer-Requests mit explizitem Timeout über
// Playwright-API-Context senden, damit generate-dual nicht in Node-fetch scheitert.
async function postJsonWithLongTimeout<TResponse>(
  apiPath: string,
  requestBody: unknown,
  errorLabel: string,
): Promise<TResponse> {
  const headers = await authHeaders();
  const apiContext = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: headers,
  });

  try {
    const res = await apiContext.post(apiPath, {
      data: requestBody,
      timeout: AI_REQUEST_TIMEOUT_MS,
    });
    if (!res.ok()) {
      const text = await res.text();
      throw new Error(`${errorLabel} failed (${res.status()}): ${text.substring(0, 200)}`);
    }
    return await res.json() as TResponse;
  } finally {
    await apiContext.dispose();
  }
}

async function fetchTemplates(): Promise<TemplateApiRecord[]> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/api/templates`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`templates fetch failed (${res.status}): ${text.substring(0, 200)}`);
  }
  return await res.json();
}

function resolveTemplateRecord(templates: TemplateApiRecord[], template: Template): TemplateApiRecord {
  const candidates = templates.filter(item => item.category === template);
  const preferred = candidates.find(item => item.isDefault === 'true' && item.isMeta !== 'true')
    ?? candidates.find(item => item.isMeta !== 'true')
    ?? candidates[0];

  if (!preferred) {
    throw new Error(`Kein Template mit Kategorie "${template}" gefunden`);
  }

  return preferred;
}

async function createPrdForTemplate(template: Template, templateId: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/api/prds`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `Smoke ${template} ${new Date().toISOString()}`,
      description: `Automatisch erzeugtes Smoke-Test-PRD für das Template ${template}.`,
      content: INITIAL_SMOKE_CONTENT,
      templateId,
      language: 'en',
      status: 'draft',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create prd failed (${res.status}): ${text.substring(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.id) {
    throw new Error(`create prd returned no id for template ${template}`);
  }
  return data.id;
}

async function preparePrdIdsByTemplate(): Promise<Record<Template, string>> {
  const templates = await fetchTemplates();
  const prdEntries = await Promise.all(SELECTED_TEMPLATES.map(async (template) => {
    const templateRecord = resolveTemplateRecord(templates, template);
    const prdId = await createPrdForTemplate(template, templateRecord.id);
    console.log(`  [SETUP] ${template} → Template "${templateRecord.name}" (${templateRecord.id}) | PRD ${prdId}`);
    return [template, prdId] as const;
  }));

  return Object.fromEntries(prdEntries) as Record<Template, string>;
}

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
      const isRetryable = /500|502|503|429|rate limit|empty response|fetch failed|ECONNRESET|timed out|timeout/i.test(e.message || '');
      if (!isRetryable || attempt === retries) throw e;
    }
  }
  throw lastError;
}

async function callSimple(template: Template, prdId: string): Promise<ApiResult> {
  return withRetry(async () => {
    const data = await postJsonWithLongTimeout<{
      finalContent?: string;
      modelsUsed?: string[];
      totalTokens?: number;
    }>('/api/ai/generate-dual', {
      userInput: PROJECT_IDEAS[template],
      mode: 'generate',
      prdId,
    }, 'generate-dual');
    return {
      content: data.finalContent || '',
      modelsUsed: data.modelsUsed || [],
      tokens: data.totalTokens || 0,
    };
  }, `simple/${template}`);
}

async function callIterative(template: Template, prdId: string): Promise<ApiResult> {
  return withRetry(async () => {
    const data = await postJsonWithLongTimeout<{
      finalContent?: string;
      mergedPRD?: string;
      modelsUsed?: string[];
      totalTokens?: number;
    }>('/api/ai/generate-iterative', {
      additionalRequirements: PROJECT_IDEAS[template],
      mode: 'generate',
      iterationCount: 2,
      useFinalReview: false,
      prdId,
    }, 'generate-iterative');
    return {
      content: data.finalContent || data.mergedPRD || '',
      modelsUsed: data.modelsUsed || [],
      tokens: data.totalTokens || 0,
    };
  }, `iterative/${template}`);
}

async function callGuided(template: Template, prdId: string): Promise<ApiResult> {
  return withRetry(async () => {
    const data = await postJsonWithLongTimeout<{
      prdContent?: string;
      modelsUsed?: string[];
      tokensUsed?: number;
    }>('/api/ai/guided-skip', {
      projectIdea: PROJECT_IDEAS[template],
      mode: 'generate',
      prdId,
    }, 'guided-skip');
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
 * Single test that runs all selected combinations sequentially.
 * This avoids serial-mode skip-on-failure while keeping rate-limit-safe ordering.
 */
test('Smoke: all 12 PRD combinations (4 templates × 3 methods)', async () => {
  test.setTimeout(1_800_000); // 30 minutes for all 12 combos (free models are slow + retries)
  results.length = 0;
  console.log(`  [FILTER] Templates: ${SELECTED_TEMPLATES.join(', ')} | Methoden: ${SELECTED_METHODS.join(', ')}`);
  const prdIdsByTemplate = await preparePrdIdsByTemplate();

  for (const template of SELECTED_TEMPLATES) {
    const prdId = prdIdsByTemplate[template];
    for (const method of SELECTED_METHODS) {
      const start = Date.now();

      let content = '';
      let modelsUsed: string[] = [];
      let tokens = 0;
      let error: string | undefined;

      try {
        const callFn = method === 'simple' ? callSimple
          : method === 'iterative' ? callIterative
          : callGuided;
        const result = await callFn(template, prdId);
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

  // ÄNDERUNG 07.03.2026: Smoke-Artefakte dauerhaft unter documentation/smoke_results ablegen,
  // damit Einzel- und Vollruns spaeter reproduzierbar ausgewertet werden koennen.
  const persistedReport = persistSmokeReport({
    baseDir: process.cwd(),
    templates: [...SELECTED_TEMPLATES],
    methods: [...SELECTED_METHODS],
    results,
  });

  // Print summary table
  console.log('\n' + '='.repeat(90));
  console.log(`  SMOKE TEST SUMMARY (${EXPECTED_RESULT_COUNT} Kombinationen)`);
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
  console.log(`\n  Results saved to: ${persistedReport.timestampedReportPath}`);
  console.log(`  Latest selection snapshot: ${persistedReport.latestReportPath}\n`);

  // Final assertions — alle angeforderten Kombinationen müssen ein Ergebnis haben
  expect(results.length, `Alle ${EXPECTED_RESULT_COUNT} angeforderten Kombinationen sollten Ergebnisse haben`).toBe(EXPECTED_RESULT_COUNT);

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
