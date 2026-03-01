/**
 * Quality-based model fallback: when compiler quality gates fail after all
 * repair passes, retry generation with the next model in the fallback chain
 * instead of throwing an exception.
 */
import type { OpenRouterClient } from './openrouter';
import {
  PrdCompilerQualityError,
  qualityScore,
  type FinalizeWithCompilerGatesResult,
} from './prdCompilerFinalizer';

/**
 * Pick the next fallback model that differs from the primary and any models
 * already attempted during repairs.
 */
export function pickNextFallbackModel(
  client: OpenRouterClient,
  primaryModel: string,
  triedRepairModels: string[],
): string | null {
  const chain = client.getFallbackChain();
  const tried = new Set([primaryModel, ...triedRepairModels].map(m => m.toLowerCase()));

  for (const candidate of chain) {
    if (!tried.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

export interface DegradedResult extends FinalizeWithCompilerGatesResult {
  degraded: true;
  fallbackModel?: string;
}

/**
 * Compare two quality-gate failures and return the best content as a degraded
 * result (HTTP 200 with warning) instead of throwing.
 */
export function pickBestDegradedResult(
  primaryError: PrdCompilerQualityError,
  fallbackError: unknown,
): DegradedResult | null {
  // Extract the best repair attempt from primary (highest score heuristic: last attempt)
  const primaryAttempts = primaryError.repairAttempts;
  const primaryScore = qualityScore(primaryError.quality);

  let fallbackScore = -Infinity;
  let fallbackQuality: PrdCompilerQualityError['quality'] | null = null;
  let fallbackAttempts: PrdCompilerQualityError['repairAttempts'] = [];

  if (fallbackError instanceof PrdCompilerQualityError) {
    fallbackScore = qualityScore(fallbackError.quality);
    fallbackQuality = fallbackError.quality;
    fallbackAttempts = fallbackError.repairAttempts;
  }

  // Pick the error with the higher quality score
  const bestError = fallbackScore > primaryScore && fallbackQuality
    ? fallbackError as PrdCompilerQualityError
    : primaryError;
  const bestAttempts = fallbackScore > primaryScore ? fallbackAttempts : primaryAttempts;
  const bestScore = Math.max(primaryScore, fallbackScore);

  // We need content to return. Take the best repair attempt or the initial
  // content that was compiled (stored in the error's quality report indirectly).
  // The last repair attempt is typically the best we have.
  const bestAttempt = bestAttempts.length > 0
    ? bestAttempts[bestAttempts.length - 1]
    : null;

  if (!bestAttempt) return null;

  // We don't have the compiled structure from the error (it's thrown away).
  // Return a minimal degraded result — the caller will need to re-compile.
  return {
    content: bestAttempt.content,
    structure: { features: [] } as any, // Will be re-compiled by caller if needed
    quality: bestError.quality,
    qualityScore: bestScore,
    repairAttempts: [...primaryAttempts, ...fallbackAttempts],
    degraded: true,
  };
}
