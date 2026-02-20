import { db } from "./db";
import { aiUsage, type InsertAiUsage } from "@shared/schema";
import { eq, desc, gte, and, count, sum, sql } from "drizzle-orm";
import { fetchOpenRouterModels } from "./openrouter";

/**
 * Look up per-token pricing for a model from OpenRouter's cached model list.
 * Returns { prompt: 0, completion: 0 } when pricing is unavailable.
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
    // Cache miss or API error — fall back to zero cost
  }
  return { prompt: 0, completion: 0 };
}

/**
 * Logs AI usage to the database for cost tracking and analytics.
 * Cost is calculated from the model's actual OpenRouter pricing.
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
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;

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

    console.log(`[AI Usage] ${modelType}: ${model} (${tier}) — ${inputTokens}in/${outputTokens}out — $${totalCost.toFixed(6)}`);
  } catch (error) {
    console.error('[AI Usage] Failed to log usage:', error);
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
    console.error('[AI Usage] Failed to get stats:', error);
    return null;
  }
}
