import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('tokenBudgets', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('TOKEN_BUDGET_')) {
        delete process.env[key];
      }
    }
    vi.resetModules();
  });

  it('exports all expected budget constants with positive default values', async () => {
    const budgets = await import('../server/tokenBudgets');

    expect(budgets.PRD_GENERATION).toBe(8000);
    expect(budgets.PRD_IMPROVEMENT).toBe(10000);
    expect(budgets.PRD_FINAL_GENERATION).toBe(10000);
    expect(budgets.REVIEW_STANDARD).toBe(3000);
    expect(budgets.REVIEW_FINAL).toBe(6000);
    expect(budgets.FEATURE_ANALYSIS).toBe(3000);
    expect(budgets.GUIDED_QUESTIONS).toBe(2500);
    expect(budgets.GUIDED_REFINEMENT).toBe(4000);
    expect(budgets.GUIDED_FOLLOWUP).toBe(2000);
    expect(budgets.ITERATIVE_ANSWERER).toBe(5500);
    expect(budgets.ITERATIVE_ANSWERER_RETRY).toBe(7000);
    expect(budgets.ITERATIVE_CLARIFYING_Q).toBe(1500);
    expect(budgets.ITERATIVE_STRUCTURED_DELTA).toBe(1200);
    expect(budgets.REPAIR_PASS).toBe(12000);
    expect(budgets.SECTION_REGENERATION).toBe(2000);
    expect(budgets.FEATURE_LIST_GENERATION).toBe(4000);
    expect(budgets.FEATURE_EXPANSION).toBe(4200);
    expect(budgets.FEATURE_REPAIR).toBe(3000);
    expect(budgets.ANTHROPIC_PRD_GENERATION).toBe(4000);
  });

  it('respects environment variable overrides', async () => {
    process.env.TOKEN_BUDGET_REPAIR_PASS = '16000';
    process.env.TOKEN_BUDGET_PRD_GENERATION = '14000';
    vi.resetModules();

    const budgets = await import('../server/tokenBudgets');
    expect(budgets.REPAIR_PASS).toBe(16000);
    expect(budgets.PRD_GENERATION).toBe(14000);
  });

  it('ignores non-numeric environment variable values', async () => {
    process.env.TOKEN_BUDGET_PRD_GENERATION = 'not_a_number';
    vi.resetModules();

    const budgets = await import('../server/tokenBudgets');
    expect(budgets.PRD_GENERATION).toBe(8000);
  });

  it('ignores negative and zero values', async () => {
    process.env.TOKEN_BUDGET_PRD_GENERATION = '-100';
    process.env.TOKEN_BUDGET_REVIEW_STANDARD = '0';
    vi.resetModules();

    const budgets = await import('../server/tokenBudgets');
    expect(budgets.PRD_GENERATION).toBe(8000);
    expect(budgets.REVIEW_STANDARD).toBe(3000);
  });

  it('ignores empty string values', async () => {
    process.env.TOKEN_BUDGET_PRD_GENERATION = '';
    vi.resetModules();

    const budgets = await import('../server/tokenBudgets');
    expect(budgets.PRD_GENERATION).toBe(8000);
  });
});
