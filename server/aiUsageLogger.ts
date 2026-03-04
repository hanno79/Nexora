import { db } from "./db";
import { aiUsage, type InsertAiUsage } from "@shared/schema";
import { eq, desc, gte, and, count, sum, sql } from "drizzle-orm";
import { fetchOpenRouterModels } from "./openrouter";
import { logger } from "./logger";
import { normalizeTokenCount } from "./tokenMath";

// Hardcoded fallback pricing (per token) for common models when OpenRouter API is unavailable.
// Prices in USD per token (prompt / completion). Updated as of 2025-05.
// ÄNDERUNG 03.03.2026: Groq und Cerebras Preise hinzugefügt
const FALLBACK_PRICING: Record<string, { prompt: number; completion: number }> = {
  // OpenRouter Modelle
  "anthropic/claude-sonnet-4": { prompt: 3e-6, completion: 15e-6 },
  "anthropic/claude-haiku-4": { prompt: 0.8e-6, completion: 4e-6 },
  "anthropic/claude-3.5-sonnet": { prompt: 3e-6, completion: 15e-6 },
  "google/gemini-2.5-flash": { prompt: 0.15e-6, completion: 0.6e-6 },
  "google/gemini-2.0-flash-exp:free": { prompt: 0, completion: 0 },
  "openai/gpt-4o": { prompt: 2.5e-6, completion: 10e-6 },
  "openai/gpt-4o-mini": { prompt: 0.15e-6, completion: 0.6e-6 },
  "deepseek/deepseek-r1-0528:free": { prompt: 0, completion: 0 },
  "meta-llama/llama-3.3-70b-instruct:free": { prompt: 0, completion: 0 },
  
  // Groq Modelle (Preise pro 1M Tokens -> pro Token)
  "llama-3.1-8b-instant": { prompt: 0.05e-6, completion: 0.08e-6 },
  "gemma2-9b-it": { prompt: 0.20e-6, completion: 0.20e-6 },
  "llama-3.3-70b-versatile": { prompt: 0.59e-6, completion: 0.79e-6 },
  "mixtral-8x7b-32768": { prompt: 0.24e-6, completion: 0.24e-6 },
  "llama3-70b-8192": { prompt: 0.59e-6, completion: 0.79e-6 },
  "llama3-8b-8192": { prompt: 0.05e-6, completion: 0.08e-6 },
  
  // Cerebras Modelle (Preise pro 1M Tokens -> pro Token)
  "llama3.1-8b": { prompt: 0.10e-6, completion: 0.10e-6 },
  "llama-3.3-70b": { prompt: 0.85e-6, completion: 1.20e-6 },
};

/**
 * Ermittelt die Token-Preise eines Modells aus der gecachten OpenRouter-Modellliste.
 * Falls die API nicht verfügbar ist, wird eine hardcodierte Preisliste als Fallback genutzt.
 */
async function getModelPricing(modelId: string): Promise<{ prompt: number; completion: number }> {
  try {
    const models = await fetchOpenRouterModels();
    const match = models.find(m => m.id === modelId);
    if (match) {
      return {
        prompt: parseFloat(match.pricing.prompt) || 0,
        completion: parseFloat(match.pricing.completion) || 0,
      };
    }
  } catch {
    // API unavailable — fall through to hardcoded pricing
  }
  return FALLBACK_PRICING[modelId] || { prompt: 0, completion: 0 };
}

/**
 * Protokolliert die KI-Nutzung in der Datenbank für Kostenverfolgung und Auswertung.
 * Die Kosten werden über getModelPricing anhand der OpenRouter-Preise berechnet;
 * bei nicht verfügbaren Preisen greift der Fallback { prompt: 0, completion: 0 }.
 */
export async function logAiUsage(
  userId: string,
  modelType: 'generator' | 'reviewer',
  model: string,
  tier: 'development' | 'production' | 'premium',
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  },
  prdId?: string
): Promise<void> {
  try {
    const inputTokens = normalizeTokenCount(usage.prompt_tokens);
    const outputTokens = normalizeTokenCount(usage.completion_tokens);

    const pricing = await getModelPricing(model);
    const totalCost = inputTokens * pricing.prompt + outputTokens * pricing.completion;

    const usageData: InsertAiUsage = {
      userId,
      prdId: prdId || null,
      modelType,
      model,
      tier,
      inputTokens,
      outputTokens,
      totalCost: totalCost.toFixed(6),
    };

    await db.insert(aiUsage).values(usageData);

    logger.info('AI usage logged', {
      modelType, model, tier,
      inputTokens, outputTokens,
      cost: totalCost.toFixed(6),
    });
  } catch (error) {
    logger.error('Failed to log AI usage', { error: (error as Error).message });
  }
}

/**
 * Get comprehensive AI usage statistics for a user using SQL aggregation.
 */
export async function getUserAiUsageStats(userId: string, since?: string) {
  try {
    let sinceDate: Date | null = null;
    if (since) {
      const parsed = new Date(since);
      if (!Number.isNaN(parsed.getTime())) {
        sinceDate = parsed;
      }
    }

    const whereClause = sinceDate
      ? and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, sinceDate))
      : eq(aiUsage.userId, userId);

    // 1. Totals — single aggregate query
    const [totals] = await db.select({
      totalCalls: count(),
      totalInput: sum(aiUsage.inputTokens),
      totalOutput: sum(aiUsage.outputTokens),
      totalCost: sum(aiUsage.totalCost),
    }).from(aiUsage).where(whereClause);

    const totalInputTokens = Number(totals?.totalInput ?? 0);
    const totalOutputTokens = Number(totals?.totalOutput ?? 0);
    const totalCost = Number(totals?.totalCost ?? 0);
    const totalCalls = Number(totals?.totalCalls ?? 0);

    // 2. Breakdown by tier — GROUP BY
    const byTierRows = await db.select({
      tier: aiUsage.tier,
      calls: count(),
      tokens: sql<string>`sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens})`,
      cost: sum(aiUsage.totalCost),
    }).from(aiUsage).where(whereClause).groupBy(aiUsage.tier);

    const byTier: Record<string, { calls: number; tokens: number; cost: number }> = {};
    for (const row of byTierRows) {
      byTier[row.tier] = {
        calls: Number(row.calls),
        tokens: Number(row.tokens ?? 0),
        cost: parseFloat(Number(row.cost ?? 0).toFixed(4)),
      };
    }

    // 3. Breakdown by model — GROUP BY
    const byModelRows = await db.select({
      model: aiUsage.model,
      calls: count(),
      tokens: sql<string>`sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens})`,
      cost: sum(aiUsage.totalCost),
    }).from(aiUsage).where(whereClause).groupBy(aiUsage.model);

    const byModel: Record<string, { calls: number; tokens: number; cost: number }> = {};
    for (const row of byModelRows) {
      byModel[row.model] = {
        calls: Number(row.calls),
        tokens: Number(row.tokens ?? 0),
        cost: parseFloat(Number(row.cost ?? 0).toFixed(4)),
      };
    }

    // 4. Recent calls — limited query (already efficient)
    const recentCallRecords = await db
      .select()
      .from(aiUsage)
      .where(whereClause)
      .orderBy(desc(aiUsage.createdAt))
      .limit(20);

    type UsageRecord = typeof aiUsage.$inferSelect;
    const recentCalls = recentCallRecords.map((r: UsageRecord) => ({
      id: r.id,
      model: r.model,
      modelType: r.modelType,
      tier: r.tier,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalCost: r.totalCost,
      prdId: r.prdId,
      createdAt: r.createdAt,
    }));

    return {
      totalCost: totalCost.toFixed(4),
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      byTier,
      byModel,
      recentCalls,
    };
  } catch (error) {
    logger.error('Failed to get AI usage stats', { error: (error as Error).message });
    return null;
  }
}
