export type ClientLastModelAttempt = {
  role?: string | null;
  model?: string | null;
  phase?: string | null;
  status?: string | null;
  durationMs?: number | null;
  finishReason?: string | null;
};

export type ClientCompilerIssue = {
  code: string;
  sectionKey: string;
  message: string;
  suggestedAction?: string;
  targetFields?: string[];
  suggestedFix?: string;
};

export type ClientCompilerDiagnostics = {
  structuredFeatureCount?: number;
  totalFeatureCount?: number;
  jsonSectionUpdates?: number;
  markdownSectionRegens?: number;
  fullRegenerations?: number;
  featurePreservations?: number;
  featureIntegrityRestores?: number;
  driftEvents?: number;
  featureFreezeActive?: boolean;
  blockedRegenerationAttempts?: number;
  freezeSeedSource?: string | null;
  jsonRetryAttempts?: number;
  jsonRepairSuccesses?: number;
  errorCount?: number;
  warningCount?: number;
  repairAttempts?: number;
  topRootCauseCodes?: string[];
  qualityIssueCodes?: string[];
  failureStage?: string | null;
  semanticVerifierVerdict?: 'pass' | 'fail' | null;
  primaryGateReason?: string | null;
  structuralParseReason?: string | null;
  rawFeatureHeadingSamples?: string[];
  normalizationApplied?: boolean;
  normalizedFeatureCountRecovered?: number;
  primaryCapabilityAnchors?: string[];
  featurePriorityWindow?: string[];
  coreFeatureIds?: string[];
  supportFeatureIds?: string[];
  canonicalFeatureIds?: string[];
  timelineMismatchedFeatureIds?: string[];
  timelineRewrittenFromFeatureMap?: boolean;
  timelineRewriteAppliedLines?: number;
  semanticBlockingCodes?: string[];
  semanticBlockingIssues?: ClientCompilerIssue[];
  initialSemanticBlockingIssues?: ClientCompilerIssue[];
  postRepairSemanticBlockingIssues?: ClientCompilerIssue[];
  finalSemanticBlockingIssues?: ClientCompilerIssue[];
  semanticRepairApplied?: boolean;
  semanticRepairAttempted?: boolean;
  semanticRepairIssueCodes?: string[];
  semanticRepairSectionKeys?: string[];
  semanticRepairTruncated?: boolean;
  repairGapReason?: string | null;
  repairCycleCount?: number;
  compilerRepairTruncationCount?: number;
  compilerRepairFinishReasons?: string[];
  repairRejected?: boolean;
  repairRejectedReason?: string | null;
  repairDegradationSignals?: string[];
  degradedCandidateAvailable?: boolean;
  degradedCandidateSource?: 'pre_repair_best' | 'post_targeted_repair' | null;
  displayedCandidateSource?: 'passed' | 'pre_repair_best' | 'post_targeted_repair' | null;
  diagnosticsAlignedWithDisplayedCandidate?: boolean;
  collapsedFeatureNameIds?: string[];
  placeholderFeatureIds?: string[];
  acceptanceBoilerplateFeatureIds?: string[];
  featureQualityFloorFeatureIds?: string[];
  featureQualityFloorFailedFeatureIds?: string[];
  featureQualityFloorPassed?: boolean;
  primaryFeatureQualityReason?: string | null;
  emptyMainFlowFeatureIds?: string[];
  placeholderPurposeFeatureIds?: string[];
  placeholderAlternateFlowFeatureIds?: string[];
  thinAcceptanceCriteriaFeatureIds?: string[];
  semanticRepairChangedSections?: string[];
  semanticRepairStructuralChange?: boolean;
  earlyDriftDetected?: boolean;
  earlyDriftCodes?: string[];
  earlyDriftSections?: string[];
  blockedAddedFeatures?: string[];
  earlySemanticLintCodes?: string[];
  earlyRepairAttempted?: boolean;
  earlyRepairApplied?: boolean;
  primaryEarlyDriftReason?: string | null;
  runtimeFailureCode?: 'provider_exhaustion' | 'provider_auth' | 'provider_unavailable' | null;
  providerFailureSummary?: string | null;
  providerFailureCounts?: {
    rateLimited: number;
    timedOut: number;
    provider4xx: number;
    emptyResponse: number;
  } | null;
  providerFailedModels?: string[];
  providerFailureStage?: string | null;
  repairModelIds?: string[];
  reviewerModelIds?: string[];
  verifierModelIds?: string[];
  contentRefined?: boolean;
  contentReviewIssueCodes?: string[];
  semanticVerifierSameFamilyFallback?: boolean;
  semanticVerifierBlockedFamilies?: string[];
  activePhase?: string | null;
  lastProgressEvent?: string | null;
  lastModelAttempt?: ClientLastModelAttempt | null;
  boilerplateHits?: number;
  metaLeakHits?: number;
  languageFixRequired?: boolean;
  aggregatedFeatureCount?: number;
};

export type ClientCompilerRunRecord = {
  qualityStatus?: string | null;
  finalizationStage?: string | null;
  at?: string | null;
  message?: string | null;
  finalContent?: string | null;
  iterationLog?: string | null;
  compilerDiagnostics: ClientCompilerDiagnostics | null;
};

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function toCompilerIssueArray(value: unknown): ClientCompilerIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items = value
    .filter(isObject)
    .map((entry) => {
      const code = typeof entry.code === 'string' ? entry.code.trim() : '';
      const sectionKey = typeof entry.sectionKey === 'string' ? entry.sectionKey.trim() : '';
      const message = typeof entry.message === 'string' ? entry.message.trim() : '';
      if (!code || !sectionKey || !message) return null;

      const issue: ClientCompilerIssue = {
        code,
        sectionKey,
        message,
        suggestedAction: typeof entry.suggestedAction === 'string' ? entry.suggestedAction : undefined,
        targetFields: toStringArray(entry.targetFields),
        suggestedFix: typeof entry.suggestedFix === 'string' && entry.suggestedFix.trim().length > 0 ? entry.suggestedFix : undefined,
      };
      return issue;
    })
    .filter((entry): entry is ClientCompilerIssue => !!entry);

  return items.length > 0 ? items : undefined;
}

function toLastModelAttempt(value: unknown): ClientLastModelAttempt | null {
  if (!isObject(value)) return null;

  return {
    role: typeof value.role === 'string' ? value.role : null,
    model: typeof value.model === 'string' ? value.model : null,
    phase: typeof value.phase === 'string' ? value.phase : null,
    status: typeof value.status === 'string' ? value.status : null,
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : null,
    finishReason: typeof value.finishReason === 'string' ? value.finishReason : null,
  };
}

function mapCompilerCoreFields(value: Record<string, any>): Partial<ClientCompilerDiagnostics> {
  return {
    structuredFeatureCount: typeof value.structuredFeatureCount === 'number' ? value.structuredFeatureCount : undefined,
    totalFeatureCount: typeof value.totalFeatureCount === 'number' ? value.totalFeatureCount : undefined,
    jsonSectionUpdates: typeof value.jsonSectionUpdates === 'number' ? value.jsonSectionUpdates : undefined,
    markdownSectionRegens: typeof value.markdownSectionRegens === 'number' ? value.markdownSectionRegens : undefined,
    fullRegenerations: typeof value.fullRegenerations === 'number' ? value.fullRegenerations : undefined,
    featurePreservations: typeof value.featurePreservations === 'number' ? value.featurePreservations : undefined,
    featureIntegrityRestores: typeof value.featureIntegrityRestores === 'number' ? value.featureIntegrityRestores : undefined,
    driftEvents: typeof value.driftEvents === 'number' ? value.driftEvents : undefined,
    featureFreezeActive: typeof value.featureFreezeActive === 'boolean' ? value.featureFreezeActive : undefined,
    blockedRegenerationAttempts: typeof value.blockedRegenerationAttempts === 'number' ? value.blockedRegenerationAttempts : undefined,
    freezeSeedSource: typeof value.freezeSeedSource === 'string' ? value.freezeSeedSource : undefined,
    jsonRetryAttempts: typeof value.jsonRetryAttempts === 'number' ? value.jsonRetryAttempts : undefined,
    jsonRepairSuccesses: typeof value.jsonRepairSuccesses === 'number' ? value.jsonRepairSuccesses : undefined,
    errorCount: typeof value.errorCount === 'number' ? value.errorCount : undefined,
    warningCount: typeof value.warningCount === 'number' ? value.warningCount : undefined,
    repairAttempts: typeof value.repairAttempts === 'number' ? value.repairAttempts : undefined,
    topRootCauseCodes: toStringArray(value.topRootCauseCodes),
    qualityIssueCodes: toStringArray(value.qualityIssueCodes),
    failureStage: typeof value.failureStage === 'string' ? value.failureStage : undefined,
    semanticVerifierVerdict:
      value.semanticVerifierVerdict === 'pass' || value.semanticVerifierVerdict === 'fail'
        ? value.semanticVerifierVerdict
        : undefined,
    primaryGateReason: typeof value.primaryGateReason === 'string' ? value.primaryGateReason : undefined,
    structuralParseReason: typeof value.structuralParseReason === 'string' ? value.structuralParseReason : undefined,
    rawFeatureHeadingSamples: toStringArray(value.rawFeatureHeadingSamples),
    normalizationApplied: typeof value.normalizationApplied === 'boolean' ? value.normalizationApplied : undefined,
    normalizedFeatureCountRecovered:
      typeof value.normalizedFeatureCountRecovered === 'number'
        ? value.normalizedFeatureCountRecovered
        : undefined,
  };
}

function mapFeatureClassificationFields(value: Record<string, any>): Partial<ClientCompilerDiagnostics> {
  return {
    primaryCapabilityAnchors: toStringArray(value.primaryCapabilityAnchors),
    featurePriorityWindow: toStringArray(value.featurePriorityWindow),
    coreFeatureIds: toStringArray(value.coreFeatureIds),
    supportFeatureIds: toStringArray(value.supportFeatureIds),
    canonicalFeatureIds: toStringArray(value.canonicalFeatureIds),
    timelineMismatchedFeatureIds: toStringArray(value.timelineMismatchedFeatureIds),
    timelineRewrittenFromFeatureMap:
      typeof value.timelineRewrittenFromFeatureMap === 'boolean'
        ? value.timelineRewrittenFromFeatureMap
        : undefined,
    timelineRewriteAppliedLines:
      typeof value.timelineRewriteAppliedLines === 'number'
        ? value.timelineRewriteAppliedLines
        : undefined,
  };
}

function mapSemanticRepairFields(value: Record<string, any>): Partial<ClientCompilerDiagnostics> {
  return {
    semanticBlockingCodes: toStringArray(value.semanticBlockingCodes),
    semanticBlockingIssues: toCompilerIssueArray(value.semanticBlockingIssues),
    initialSemanticBlockingIssues: toCompilerIssueArray(value.initialSemanticBlockingIssues),
    postRepairSemanticBlockingIssues: toCompilerIssueArray(value.postRepairSemanticBlockingIssues),
    finalSemanticBlockingIssues: toCompilerIssueArray(value.finalSemanticBlockingIssues),
    semanticRepairApplied: typeof value.semanticRepairApplied === 'boolean' ? value.semanticRepairApplied : undefined,
    semanticRepairAttempted: typeof value.semanticRepairAttempted === 'boolean' ? value.semanticRepairAttempted : undefined,
    semanticRepairIssueCodes: toStringArray(value.semanticRepairIssueCodes),
    semanticRepairSectionKeys: toStringArray(value.semanticRepairSectionKeys),
    semanticRepairTruncated: typeof value.semanticRepairTruncated === 'boolean' ? value.semanticRepairTruncated : undefined,
    repairGapReason: typeof value.repairGapReason === 'string' ? value.repairGapReason : undefined,
    repairCycleCount: typeof value.repairCycleCount === 'number' ? value.repairCycleCount : undefined,
    compilerRepairTruncationCount:
      typeof value.compilerRepairTruncationCount === 'number'
        ? value.compilerRepairTruncationCount
        : undefined,
    compilerRepairFinishReasons: toStringArray(value.compilerRepairFinishReasons),
    repairRejected: typeof value.repairRejected === 'boolean' ? value.repairRejected : undefined,
    repairRejectedReason: typeof value.repairRejectedReason === 'string' ? value.repairRejectedReason : undefined,
    repairDegradationSignals: toStringArray(value.repairDegradationSignals),
    degradedCandidateAvailable:
      typeof value.degradedCandidateAvailable === 'boolean' ? value.degradedCandidateAvailable : undefined,
    degradedCandidateSource:
      value.degradedCandidateSource === 'pre_repair_best' || value.degradedCandidateSource === 'post_targeted_repair'
        ? value.degradedCandidateSource
        : undefined,
    displayedCandidateSource:
      value.displayedCandidateSource === 'passed'
      || value.displayedCandidateSource === 'pre_repair_best'
      || value.displayedCandidateSource === 'post_targeted_repair'
        ? value.displayedCandidateSource
        : undefined,
    diagnosticsAlignedWithDisplayedCandidate:
      typeof value.diagnosticsAlignedWithDisplayedCandidate === 'boolean'
        ? value.diagnosticsAlignedWithDisplayedCandidate
        : undefined,
    collapsedFeatureNameIds: toStringArray(value.collapsedFeatureNameIds),
    placeholderFeatureIds: toStringArray(value.placeholderFeatureIds),
    acceptanceBoilerplateFeatureIds: toStringArray(value.acceptanceBoilerplateFeatureIds),
    featureQualityFloorFeatureIds: toStringArray(value.featureQualityFloorFeatureIds),
    featureQualityFloorFailedFeatureIds: toStringArray(value.featureQualityFloorFailedFeatureIds),
    featureQualityFloorPassed:
      typeof value.featureQualityFloorPassed === 'boolean'
        ? value.featureQualityFloorPassed
        : undefined,
    primaryFeatureQualityReason:
      typeof value.primaryFeatureQualityReason === 'string'
        ? value.primaryFeatureQualityReason
        : undefined,
    emptyMainFlowFeatureIds: toStringArray(value.emptyMainFlowFeatureIds),
    placeholderPurposeFeatureIds: toStringArray(value.placeholderPurposeFeatureIds),
    placeholderAlternateFlowFeatureIds: toStringArray(value.placeholderAlternateFlowFeatureIds),
    thinAcceptanceCriteriaFeatureIds: toStringArray(value.thinAcceptanceCriteriaFeatureIds),
    semanticRepairChangedSections: toStringArray(value.semanticRepairChangedSections),
    semanticRepairStructuralChange:
      typeof value.semanticRepairStructuralChange === 'boolean'
        ? value.semanticRepairStructuralChange
        : undefined,
  };
}

function mapDriftAndFailureFields(value: Record<string, any>): Partial<ClientCompilerDiagnostics> {
  return {
    earlyDriftDetected: typeof value.earlyDriftDetected === 'boolean' ? value.earlyDriftDetected : undefined,
    earlyDriftCodes: toStringArray(value.earlyDriftCodes),
    earlyDriftSections: toStringArray(value.earlyDriftSections),
    blockedAddedFeatures: toStringArray(value.blockedAddedFeatures),
    earlySemanticLintCodes: toStringArray(value.earlySemanticLintCodes),
    earlyRepairAttempted: typeof value.earlyRepairAttempted === 'boolean' ? value.earlyRepairAttempted : undefined,
    earlyRepairApplied: typeof value.earlyRepairApplied === 'boolean' ? value.earlyRepairApplied : undefined,
    primaryEarlyDriftReason: typeof value.primaryEarlyDriftReason === 'string' ? value.primaryEarlyDriftReason : undefined,
    runtimeFailureCode:
      value.runtimeFailureCode === 'provider_exhaustion'
      || value.runtimeFailureCode === 'provider_auth'
      || value.runtimeFailureCode === 'provider_unavailable'
        ? value.runtimeFailureCode
        : undefined,
    providerFailureSummary:
      typeof value.providerFailureSummary === 'string'
        ? value.providerFailureSummary
        : undefined,
    providerFailureCounts:
      isObject(value.providerFailureCounts)
      && typeof value.providerFailureCounts.rateLimited === 'number'
      && typeof value.providerFailureCounts.timedOut === 'number'
      && typeof value.providerFailureCounts.provider4xx === 'number'
      && typeof value.providerFailureCounts.emptyResponse === 'number'
        ? {
            rateLimited: value.providerFailureCounts.rateLimited,
            timedOut: value.providerFailureCounts.timedOut,
            provider4xx: value.providerFailureCounts.provider4xx,
            emptyResponse: value.providerFailureCounts.emptyResponse,
          }
        : undefined,
    providerFailedModels: toStringArray(value.providerFailedModels),
    providerFailureStage: typeof value.providerFailureStage === 'string' ? value.providerFailureStage : undefined,
  };
}

function mapModelTrackingFields(value: Record<string, any>): Partial<ClientCompilerDiagnostics> {
  return {
    repairModelIds: toStringArray(value.repairModelIds),
    reviewerModelIds: toStringArray(value.reviewerModelIds),
    verifierModelIds: toStringArray(value.verifierModelIds),
    contentRefined: typeof value.contentRefined === 'boolean' ? value.contentRefined : undefined,
    contentReviewIssueCodes: toStringArray(value.contentReviewIssueCodes),
    semanticVerifierSameFamilyFallback:
      typeof value.semanticVerifierSameFamilyFallback === 'boolean'
        ? value.semanticVerifierSameFamilyFallback
        : undefined,
    semanticVerifierBlockedFamilies: toStringArray(value.semanticVerifierBlockedFamilies),
    activePhase: typeof value.activePhase === 'string' ? value.activePhase : undefined,
    lastProgressEvent: typeof value.lastProgressEvent === 'string' ? value.lastProgressEvent : undefined,
    lastModelAttempt: toLastModelAttempt(value.lastModelAttempt),
    boilerplateHits: typeof value.boilerplateHits === 'number' ? value.boilerplateHits : undefined,
    metaLeakHits: typeof value.metaLeakHits === 'number' ? value.metaLeakHits : undefined,
    languageFixRequired: typeof value.languageFixRequired === 'boolean' ? value.languageFixRequired : undefined,
    aggregatedFeatureCount: typeof value.aggregatedFeatureCount === 'number' ? value.aggregatedFeatureCount : undefined,
  };
}

function sanitizeCompilerDiagnostics(value: unknown): ClientCompilerDiagnostics | null {
  if (!isObject(value)) return null;

  return {
    ...mapCompilerCoreFields(value),
    ...mapFeatureClassificationFields(value),
    ...mapSemanticRepairFields(value),
    ...mapDriftAndFailureFields(value),
    ...mapModelTrackingFields(value),
  };
}

export function extractAiRunFinalContent(response: unknown): string {
  if (!isObject(response)) return '';
  const candidates = [response.finalContent, response.prdContent, response.mergedPRD];
  const content = candidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return content || '';
}

export function extractAiRunIterationLog(response: unknown): string {
  if (!isObject(response)) return '';
  return typeof response.iterationLog === 'string' ? response.iterationLog : '';
}

export function extractLatestCompilerRunRecord(iterationLog: string): ClientCompilerRunRecord | null {
  const matches = Array.from(String(iterationLog || '').matchAll(/<!--\s*compiler-run:(.*?)\s*-->/gs));
  if (matches.length === 0) {
    return null;
  }

  const latestPayload = matches.at(-1)?.[1];
  if (!latestPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(latestPayload);
    if (!isObject(parsed)) {
      return null;
    }

    const {
      qualityStatus,
      finalizationStage,
      at,
      message,
      finalContent,
      iterationLog: embeddedIterationLog,
      ...diagnosticFields
    } = parsed;

    return {
      qualityStatus: typeof qualityStatus === 'string' ? qualityStatus : null,
      finalizationStage: typeof finalizationStage === 'string' ? finalizationStage : null,
      at: typeof at === 'string' ? at : null,
      message: typeof message === 'string' ? message : null,
      finalContent: typeof finalContent === 'string' ? finalContent : null,
      iterationLog: typeof embeddedIterationLog === 'string' ? embeddedIterationLog : null,
      compilerDiagnostics: sanitizeCompilerDiagnostics(diagnosticFields),
    };
  } catch (error) {
    console.warn('Failed to parse compiler-run marker:', error);
    return null;
  }
}

export function extractAiRunRecord(response: unknown): ClientCompilerRunRecord {
  if (!isObject(response)) {
    return {
      compilerDiagnostics: null,
    };
  }

  const iterationLog = extractAiRunIterationLog(response);
  const markerRecord = iterationLog ? extractLatestCompilerRunRecord(iterationLog) : null;
  const compilerDiagnostics =
    sanitizeCompilerDiagnostics(response.compilerDiagnostics)
    || sanitizeCompilerDiagnostics(response.diagnostics)
    || markerRecord?.compilerDiagnostics
    || null;

  return {
    qualityStatus:
      typeof response.qualityStatus === 'string'
        ? response.qualityStatus
        : markerRecord?.qualityStatus || null,
    finalizationStage:
      typeof response.finalizationStage === 'string'
        ? response.finalizationStage
        : markerRecord?.finalizationStage || null,
    at: markerRecord?.at || null,
    message: typeof response.message === 'string' ? response.message : markerRecord?.message || null,
    finalContent: extractAiRunFinalContent(response) || markerRecord?.finalContent || null,
    iterationLog: iterationLog || markerRecord?.iterationLog || null,
    compilerDiagnostics,
  };
}

export function isFailedQualityRun(response: unknown): boolean {
  return extractAiRunRecord(response).qualityStatus === 'failed_quality';
}

export function isFailedRuntimeRun(response: unknown): boolean {
  return extractAiRunRecord(response).qualityStatus === 'failed_runtime';
}

export function isFailedAiRun(response: unknown): boolean {
  const status = extractAiRunRecord(response).qualityStatus;
  return status === 'failed_quality' || status === 'failed_runtime';
}

export function hasUsableAiRunContent(response: unknown): boolean {
  return extractAiRunFinalContent(response).trim().length > 0;
}
