import { db } from "./db";
import { aiUsage, type InsertAiUsage } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Logs AI usage to the database for cost tracking and analytics
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
    // Calculate tokens from usage object
    const inputTokens = String(usage.prompt_tokens || 0);
    const outputTokens = String(usage.completion_tokens || 0);
    
    // Simple cost calculation (placeholder - should be model-specific)
    // Development tier: free
    // Production tier: approximate costs
    // Premium tier: higher costs
    let totalCost = '0.00';
    
    if (tier === 'production') {
      // Approximate: $0.01 per 1000 tokens
      const totalTokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      totalCost = (totalTokens / 1000 * 0.01).toFixed(4);
    } else if (tier === 'premium') {
      // Approximate: $0.05 per 1000 tokens
      const totalTokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      totalCost = (totalTokens / 1000 * 0.05).toFixed(4);
    }
    
    const usageData: InsertAiUsage = {
      userId,
      prdId: prdId || null,
      modelType,
      model,
      tier,
      inputTokens,
      outputTokens,
      totalCost,
    };
    
    await db.insert(aiUsage).values(usageData);
    
    console.log(`[AI Usage] Logged ${modelType} usage: ${model} (${tier}) - ${inputTokens}in/${outputTokens}out - $${totalCost}`);
  } catch (error) {
    // Log error but don't fail the request
    console.error('[AI Usage] Failed to log usage:', error);
  }
}

/**
 * Get AI usage statistics for a user
 */
export async function getUserAiUsageStats(userId: string) {
  try {
    const usageRecords = await db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.userId, userId));
    
    const totalCost = usageRecords.reduce((sum: number, record: typeof usageRecords[number]) => {
      return sum + parseFloat(record.totalCost);
    }, 0);
    
    const totalCalls = usageRecords.length;
    
    const byTier = usageRecords.reduce((acc: Record<string, number>, record: typeof usageRecords[number]) => {
      acc[record.tier] = (acc[record.tier] || 0) + 1;
      return acc;
    }, {});
    
    return {
      totalCost: totalCost.toFixed(4),
      totalCalls,
      byTier,
      recentCalls: usageRecords.slice(-10),
    };
  } catch (error) {
    console.error('[AI Usage] Failed to get stats:', error);
    return null;
  }
}
