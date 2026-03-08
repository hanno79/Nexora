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

export function shouldRejectDegradedResult(
  result: Pick<FinalizeWithCompilerGatesResult, 'quality'> | null | undefined,
  blockedIssueCodes: string[]
): boolean {
  if (!result || blockedIssueCodes.length === 0) return false;
  const blockedCodes = new Set(blockedIssueCodes.map(code => code.toLowerCase()));
  return result.quality.issues.some(issue => blockedCodes.has(String(issue.code || '').toLowerCase()));
}

/**
 * Compare two quality-gate failures and return the best content as a degraded
 * result (HTTP 200 with warning) instead of throwing.
 */
export function pickBestDegradedResult(
  primaryError: PrdCompilerQualityError,
  fallbackError: unknown,
): DegradedResult | null {
  if (primaryError.failureStage === 'semantic_verifier') {
    return null;
  }

  // ÄNDERUNG 07.03.2026: Degradierter Fallback muss den kompilierten Beststand
  // zurückgeben. Der rohe letzte Repair-Text kann später erneut starke
  // Compiler-Fallbacks auslösen und passt nicht zuverlässig zur gespeicherten Quality.
  const primaryAttempts = primaryError.repairAttempts;
  const primaryScore = qualityScore(primaryError.quality);

  let fallbackScore = -Infinity;
  let fallbackQuality: PrdCompilerQualityError['quality'] | null = null;
  let fallbackAttempts: PrdCompilerQualityError['repairAttempts'] = [];

  if (fallbackError instanceof PrdCompilerQualityError) {
    if (fallbackError.failureStage === 'semantic_verifier') {
      return null;
    }
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

  // Bevorzugt den echten kompilierten Fehlstand. Nur wenn dieser nicht vorhanden
  // ist, fällt der Code auf den letzten Repair-Entwurf zurück.
  const bestAttempt = bestAttempts.length > 0
    ? bestAttempts[bestAttempts.length - 1]
    : null;
  const bestContent = bestError.compiledContent || bestAttempt?.content || null;

  if (!bestContent) return null;

  return {
    content: bestContent,
    structure: bestError.compiledStructure || ({ features: [] } as any),
    quality: bestError.quality,
    qualityScore: bestScore,
    repairAttempts: [...primaryAttempts, ...fallbackAttempts],
    reviewerAttempts: [
      ...(primaryError.reviewerAttempts || []),
      ...(fallbackError instanceof PrdCompilerQualityError ? fallbackError.reviewerAttempts || [] : []),
    ],
    semanticVerification: bestError.semanticVerification,
    semanticVerificationHistory: bestError.semanticVerification ? [bestError.semanticVerification] : [],
    semanticRepairApplied: bestError.semanticRepairApplied,
    degraded: true,
  };
}
