import { db } from "./db";
import { aiUsage, type InsertAiUsage } from "@shared/schema";
import { eq, desc, gte, and, count, sum, sql } from "drizzle-orm";
import { logger } from "./logger";
import { normalizeTokenCount } from "./tokenMath";
import { getModelPricing } from "./modelPricing";

/**
 * Protokolliert die KI-Nutzung in der Datenbank für Kostenverfolgung und Auswertung.
 * Die Kosten werden über getModelPricing anhand der OpenRouter-Preise berechnet;
 * bei nicht verfügbaren Preisen greift der Fallback { prompt: 0, completion: 0 }.
 */
export async function logAiUsage(
  userId: string,
  modelType: 'generator' | 'reviewer',
  model: string,
  tier: InsertAiUsage['tier'],
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
