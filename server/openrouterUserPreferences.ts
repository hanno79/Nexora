/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Anwenden von benutzerspezifischen OpenRouter-Praeferenzen auf einen Client.
*/

// ÄNDERUNG 08.03.2026: User-Praeferenzlogik aus `server/openrouter.ts` extrahiert,
// damit die Hauptdatei kleiner wird und die Aufrufer ueber die bestehende Factory stabil bleiben.

import { resolveIndependentVerifierModel } from './modelFamily';
import {
  getDefaultFallbackChainForTier,
  getDefaultFallbackModelForTier,
  MODEL_TIERS,
  resolveModelTier,
  sanitizeConfiguredModel,
  type ModelConfig,
} from './openrouterModelConfig';

export type UserPreferenceClient = {
  setPreferredModel(type: 'generator' | 'reviewer' | 'verifier' | 'semantic_repair' | 'fallback', model: string | undefined): void;
  setFallbackChain(models: string[]): void;
  setPreferredTier(tier: keyof ModelConfig): void;
};

export async function applyUserPreferencesToClient(
  client: UserPreferenceClient,
  userId: string | undefined,
  log?: (msg: string, data?: any) => void,
): Promise<string | null> {
  const { db } = await import('./db');
  const { users } = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');

  let contentLanguage: string | null = null;
  if (!userId) {
    return contentLanguage;
  }

  const userPrefs = await db.select({
    aiPreferences: users.aiPreferences,
    defaultContentLanguage: users.defaultContentLanguage,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userPrefs[0]) {
    return contentLanguage;
  }

  contentLanguage = userPrefs[0].defaultContentLanguage || null;
  if (!userPrefs[0].aiPreferences) {
    return contentLanguage;
  }

  const prefs = userPrefs[0].aiPreferences as any;
  const tier = resolveModelTier(prefs.tier);
  const activeTierModels = prefs.tierModels?.[tier] || {};
  const tierDefaults = MODEL_TIERS[tier] || MODEL_TIERS.development;
  const resolvedGeneratorModel =
    sanitizeConfiguredModel(activeTierModels.generatorModel || prefs.generatorModel) ||
    tierDefaults.generator;
  const resolvedReviewerModel =
    sanitizeConfiguredModel(activeTierModels.reviewerModel || prefs.reviewerModel) ||
    tierDefaults.reviewer;
  const resolvedFallbackModel =
    sanitizeConfiguredModel(activeTierModels.fallbackModel || prefs.fallbackModel) ||
    getDefaultFallbackModelForTier(tier);
  // ÄNDERUNG 13.03.2026: Tier-spezifische Chain hat immer Vorrang.
  // Legacy prefs.fallbackChain nur noch fuer Development-Tier, damit alte
  // Free-Model-Chains nicht versehentlich Premium-Tiers ueberschreiben.
  const hasTierSpecificChain = Array.isArray(activeTierModels.fallbackChain)
    && activeTierModels.fallbackChain.length > 0;
  const hasLegacyGlobalChain = Array.isArray(prefs.fallbackChain)
    && prefs.fallbackChain.length > 0;
  const resolvedFallbackChain: string[] =
    hasTierSpecificChain
      ? activeTierModels.fallbackChain
      : (tier === 'development' && hasLegacyGlobalChain)
        ? prefs.fallbackChain
        : [...getDefaultFallbackChainForTier(tier)];
  const verifierResolution = resolveIndependentVerifierModel({
    generatorModel: resolvedGeneratorModel,
    reviewerModel: resolvedReviewerModel,
    verifierModel: sanitizeConfiguredModel(activeTierModels.verifierModel || prefs.verifierModel) || tierDefaults.verifier,
    fallbackChain: resolvedFallbackChain,
    tierDefaults,
  });
  const resolvedVerifierModel =
    sanitizeConfiguredModel(verifierResolution.resolvedModel) ||
    tierDefaults.verifier;
  const resolvedSemanticRepairModel =
    sanitizeConfiguredModel(activeTierModels.semanticRepairModel || prefs.semanticRepairModel) ||
    tierDefaults.semanticRepair ||
    resolvedReviewerModel;

  if (log) {
    log('🤖 User AI preferences loaded:', {
      tier,
      tierGenerator: activeTierModels.generatorModel || '(not set)',
      tierReviewer: activeTierModels.reviewerModel || '(not set)',
      tierVerifier: activeTierModels.verifierModel || '(not set)',
      tierSemanticRepair: activeTierModels.semanticRepairModel || '(not set)',
      globalGenerator: prefs.generatorModel || '(not set)',
      globalReviewer: prefs.reviewerModel || '(not set)',
      globalVerifier: prefs.verifierModel || '(not set)',
      globalSemanticRepair: prefs.semanticRepairModel || '(not set)',
      resolvedGenerator: resolvedGeneratorModel,
      resolvedReviewer: resolvedReviewerModel,
      resolvedVerifier: resolvedVerifierModel,
      resolvedSemanticRepair: resolvedSemanticRepairModel,
      verifierBlockedFamilies: verifierResolution.blockedFamilies,
      verifierOverrideApplied: verifierResolution.overrideApplied,
      verifierSameFamilyFallbackOnly: verifierResolution.sameFamilyFallbackOnly,
      resolvedFallback: resolvedFallbackModel || '(none)',
      fallbackChainLength: resolvedFallbackChain.length,
    });
  }

  client.setPreferredModel('generator', resolvedGeneratorModel);
  client.setPreferredModel('reviewer', resolvedReviewerModel);
  client.setPreferredModel('verifier', resolvedVerifierModel);
  client.setPreferredModel('semantic_repair', resolvedSemanticRepairModel);
  client.setPreferredModel('fallback', resolvedFallbackChain[0] ?? resolvedFallbackModel);
  client.setFallbackChain(resolvedFallbackChain);
  client.setPreferredTier(tier);

  if (verifierResolution.overrideApplied) {
    console.warn(
      `Verifier independence override applied: ${verifierResolution.requestedModel || '(unset)'} -> ` +
      `${resolvedVerifierModel} (blocked families: ${verifierResolution.blockedFamilies.join(', ') || 'none'})`
    );
  } else if (verifierResolution.sameFamilyFallbackOnly) {
    console.warn(
      `Verifier independence could not be guaranteed for tier ${tier}. ` +
      `Using same-family fallback verifier ${resolvedVerifierModel}.`
    );
  }

  return contentLanguage;
}
