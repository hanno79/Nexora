/**
 * Centralized token budget constants for all AI calls.
 *
 * Each budget has a sensible default that can be overridden via
 * an environment variable named TOKEN_BUDGET_{CONSTANT_NAME}.
 *
 * Example: TOKEN_BUDGET_REPAIR_PASS=16000 overrides the default 12000.
 */

// ÄNDERUNG 01.03.2026: Obergrenze fuer Token-Budgets hinzugefuegt
// Verhindert unerwuenschte Konsequenzen bei falsch gesetzten Umgebungsvariablen
const MAX_REASONABLE_BUDGET = 100000;

function budget(name: string, defaultValue: number): number {
  const envVal = process.env[`TOKEN_BUDGET_${name}`];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= MAX_REASONABLE_BUDGET) return parsed;
  }
  return defaultValue;
}

// === PRD Generation (primary draft creation) ===
export const PRD_GENERATION = budget('PRD_GENERATION', 8000);
export const PRD_IMPROVEMENT = budget('PRD_IMPROVEMENT', 10000);
export const PRD_FINAL_GENERATION = budget('PRD_FINAL_GENERATION', 10000);

// === Review & Analysis ===
export const REVIEW_STANDARD = budget('REVIEW_STANDARD', 3000);
export const REVIEW_FINAL = budget('REVIEW_FINAL', 6000);
export const FEATURE_ANALYSIS = budget('FEATURE_ANALYSIS', 3000);

// === Guided Workflow ===
export const GUIDED_QUESTIONS = budget('GUIDED_QUESTIONS', 2500);
export const GUIDED_REFINEMENT = budget('GUIDED_REFINEMENT', 4000);
export const GUIDED_FOLLOWUP = budget('GUIDED_FOLLOWUP', 2000);

// === Iterative Workflow ===
export const ITERATIVE_ANSWERER = budget('ITERATIVE_ANSWERER', 5500);
export const ITERATIVE_ANSWERER_RETRY = budget('ITERATIVE_ANSWERER_RETRY', 7000);
export const ITERATIVE_CLARIFYING_Q = budget('ITERATIVE_CLARIFYING_Q', 1500);
export const ITERATIVE_STRUCTURED_DELTA = budget('ITERATIVE_STRUCTURED_DELTA', 1200);

// === Compiler & Repair ===
export const REPAIR_PASS = budget('REPAIR_PASS', 12000);

// === Section Operations ===
export const SECTION_REGENERATION = budget('SECTION_REGENERATION', 2000);

// === Feature Operations ===
export const FEATURE_LIST_GENERATION = budget('FEATURE_LIST_GENERATION', 4000);
export const FEATURE_EXPANSION = budget('FEATURE_EXPANSION', 4200);
export const FEATURE_REPAIR = budget('FEATURE_REPAIR', 3000);

// === Direct Anthropic ===
export const ANTHROPIC_PRD_GENERATION = budget('ANTHROPIC_PRD_GENERATION', 4000);
