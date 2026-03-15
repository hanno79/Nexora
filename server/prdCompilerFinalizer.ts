import type { TokenUsage } from '@shared/schema';
import type { PRDStructure, FeatureSpec } from './prdStructure';
import { assembleStructureToMarkdown } from './prdAssembler';
import {
  compilePrdDocument,
  type CompilePrdDocumentFn,
  type PrdQualityReport,
} from './prdCompiler';
import {
  applySemanticPatchRefinement,
  reviewAndRefineContent,
  type ContentIssue,
  type ContentReviewResult,
  type ReviewerContentGenerator,
  type ReviewerRefineResult,
} from './prdContentReviewer';
import {
  FEATURE_ENRICHABLE_FIELDS,
  type FeatureEnrichableField,
} from './prdFeatureSemantics';
import {
  collectTimelineConsistencyDiagnostics,
  normalizeOutOfScopeStrictExclusions,
  rewriteTimelineMilestonesFromFeatureMap,
} from './prdDeterministicSemanticLints';
import type {
  SemanticBlockingIssue,
  SemanticVerificationResult,
  SemanticVerifierInput,
} from './prdSemanticVerifier';
import {
  buildRepairPrompt,
  type RepairHistoryEntry,
} from './prdCompilerRepairPrompt';
import { buildAvoidedModelFamilies } from './modelFamily';
import {
  parseProviderFailureDiagnostics,
  type ProviderFailureCounts,
  type ProviderFailureStage,
  type RuntimeFailureCode,
} from './providerFailureDiagnostics';
import { compareStructures, restoreRemovedFeatures } from './prdStructureDiff';

type SupportedLanguage = 'de' | 'en';
export type FinalizerFailureStage = 'compiler_repair' | 'content_review' | 'semantic_verifier' | 'early_drift';
export type RepairGapReason =
  | 'emergent_issue_after_repair'
  | 'same_issues_persisted'
  | 'repair_no_structural_change'
  | 'repair_no_substantive_change'
  | 'repair_budget_exhausted'
  | 'regression_detected';
export type DegradedCandidateSource = 'pre_repair_best' | 'post_targeted_repair';
export type DisplayedCandidateSource = 'passed' | DegradedCandidateSource;

export type {
  SemanticBlockingIssue,
  SemanticVerificationResult,
  SemanticVerifierInput,
} from './prdSemanticVerifier';

export interface CompilerModelResult {
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason?: string;
}

export interface FinalizeWithCompilerGatesOptions {
  initialResult: CompilerModelResult;
  mode: 'generate' | 'improve';
  existingContent?: string;
  language?: SupportedLanguage;
  templateCategory?: string;
  originalRequest: string;
  maxRepairPasses?: number;
  repairReviewer: (repairPrompt: string, pass: number) => Promise<CompilerModelResult>;
  compileDocument?: CompilePrdDocumentFn;
  /** Enable post-compiler content review to detect and fix filler/repetition. Default: true. */
  enableContentReview?: boolean;
  /** Reviewer for the targeted content-refine AI call. If not provided, content review runs
   *  in analysis-only mode (issues reported but no AI refinement). */
  contentRefineReviewer?: ReviewerContentGenerator;
  /** Reviewer for targeted semantic repair patches after verifier blocking issues. */
  semanticRefineReviewer?: ReviewerContentGenerator;
  /** Independent semantic verifier that runs after compiler/content review. */
  semanticVerifier?: (input: SemanticVerifierInput) => Promise<SemanticVerificationResult>;
  /** Max semantic repair cycles. Default: max(4, affectedFeatureCount * 2), capped at 20. */
  maxSemanticRepairCycles?: number;
  onStageProgress?: (event: FinalizerStageProgressEvent) => void;
  cancelCheck?: (stage: string) => void;
  /** Enable automatic repair of deterministic quality warnings before semantic verification. Default: false. */
  enableQualityAutoRepair?: boolean;
}

type FinalizerStageProgressEvent =
  | { type: 'content_review_start' }
  | { type: 'semantic_verification_start' }
  | { type: 'quality_repair_start'; issueCount: number }
  | { type: 'quality_repair_done'; issueCount?: number; applied?: boolean }
  | { type: 'semantic_repair_start'; issueCount?: number; sectionKeys?: string[] }
  | { type: 'semantic_repair_done'; issueCount?: number; sectionKeys?: string[]; applied?: boolean; truncated?: boolean };

export interface FinalizeWithCompilerGatesResult {
  content: string;
  structure: PRDStructure;
  quality: PrdQualityReport;
  qualityScore: number;
  repairAttempts: CompilerModelResult[];
  reviewerAttempts: ReviewerRefineResult[];
  /** Content review results (populated when enableContentReview is true). */
  contentReview?: ContentReviewResult;
  /** Whether the content was refined by AI after content review. */
  contentRefined?: boolean;
  semanticVerification?: SemanticVerificationResult;
  semanticVerificationHistory?: SemanticVerificationResult[];
  semanticRepairApplied?: boolean;
  semanticRepairAttempted?: boolean;
  semanticRepairIssueCodes?: string[];
  semanticRepairSectionKeys?: string[];
  semanticRepairTruncated?: boolean;
  initialSemanticBlockingIssues?: SemanticBlockingIssue[];
  postRepairSemanticBlockingIssues?: SemanticBlockingIssue[];
  finalSemanticBlockingIssues?: SemanticBlockingIssue[];
  repairGapReason?: RepairGapReason;
  repairCycleCount?: number;
  earlySemanticLintCodes?: string[];
  primaryCapabilityAnchors?: string[];
  featurePriorityWindow?: string[];
  coreFeatureIds?: string[];
  supportFeatureIds?: string[];
  canonicalFeatureIds?: string[];
  timelineMismatchedFeatureIds?: string[];
  timelineRewrittenFromFeatureMap?: boolean;
  timelineRewriteAppliedLines?: number;
  compilerRepairTruncationCount?: number;
  compilerRepairFinishReasons?: string[];
  repairRejected?: boolean;
  repairRejectedReason?: string;
  repairDegradationSignals?: string[];
  degradedCandidateAvailable?: boolean;
  degradedCandidateSource?: DegradedCandidateSource;
  collapsedFeatureNameIds?: string[];
  placeholderFeatureIds?: string[];
  acceptanceBoilerplateFeatureIds?: string[];
  featureQualityFloorFeatureIds?: string[];
  featureQualityFloorPassed?: boolean;
  primaryFeatureQualityReason?: string;
  emptyMainFlowFeatureIds?: string[];
  placeholderPurposeFeatureIds?: string[];
  placeholderAlternateFlowFeatureIds?: string[];
  thinAcceptanceCriteriaFeatureIds?: string[];
  featureQualityFloorFailedFeatureIds?: string[];
  displayedCandidateSource?: DisplayedCandidateSource;
  diagnosticsAlignedWithDisplayedCandidate?: boolean;
  semanticRepairChangedSections?: string[];
  semanticRepairStructuralChange?: boolean;
}

export class PrdCompilerRuntimeError extends Error {
  readonly failureStage: FinalizerFailureStage;
  readonly providerFailureStage: ProviderFailureStage;
  readonly runtimeFailureCode: RuntimeFailureCode;
  readonly providerFailureSummary: string;
  readonly providerFailureCounts: ProviderFailureCounts;
  readonly providerFailedModels: string[];
  readonly compiledContent?: string;
  readonly compiledStructure?: PRDStructure;
  readonly repairAttempts: CompilerModelResult[];
  readonly reviewerAttempts: ReviewerRefineResult[];
  readonly compilerRepairTruncationCount: number;
  readonly compilerRepairFinishReasons: string[];
  readonly degradedCandidateAvailable: boolean;
  readonly degradedCandidateSource?: DegradedCandidateSource;

  constructor(params: {
    message: string;
    failureStage: FinalizerFailureStage;
    providerFailureStage: ProviderFailureStage;
    runtimeFailureCode: RuntimeFailureCode;
    providerFailureSummary: string;
    providerFailureCounts: ProviderFailureCounts;
    providerFailedModels: string[];
    compiledResult?: { content: string; structure: PRDStructure };
    repairAttempts?: CompilerModelResult[];
    reviewerAttempts?: ReviewerRefineResult[];
    compilerRepairTruncationCount?: number;
    compilerRepairFinishReasons?: string[];
    degradedCandidateAvailable?: boolean;
    degradedCandidateSource?: DegradedCandidateSource;
  }) {
    super(params.message);
    this.name = 'PrdCompilerRuntimeError';
    this.failureStage = params.failureStage;
    this.providerFailureStage = params.providerFailureStage;
    this.runtimeFailureCode = params.runtimeFailureCode;
    this.providerFailureSummary = params.providerFailureSummary;
    this.providerFailureCounts = params.providerFailureCounts;
    this.providerFailedModels = params.providerFailedModels;
    this.compiledContent = params.compiledResult?.content;
    this.compiledStructure = params.compiledResult?.structure;
    this.repairAttempts = params.repairAttempts || [];
    this.reviewerAttempts = params.reviewerAttempts || [];
    this.compilerRepairTruncationCount = params.compilerRepairTruncationCount ?? 0;
    this.compilerRepairFinishReasons = params.compilerRepairFinishReasons || [];
    this.degradedCandidateAvailable = params.degradedCandidateAvailable ?? !!params.compiledResult?.content;
    this.degradedCandidateSource = params.degradedCandidateSource;
  }
}

export class PrdCompilerQualityError extends Error {
  readonly quality: PrdQualityReport;
  readonly repairAttempts: CompilerModelResult[];
  readonly reviewerAttempts: ReviewerRefineResult[];
  readonly compiledContent?: string;
  readonly compiledStructure?: PRDStructure;
  readonly semanticVerification?: SemanticVerificationResult;
  readonly failureStage: FinalizerFailureStage;
  readonly semanticRepairApplied: boolean;
  readonly semanticRepairAttempted: boolean;
  readonly semanticRepairIssueCodes: string[];
  readonly semanticRepairSectionKeys: string[];
  readonly semanticRepairTruncated: boolean;
  readonly initialSemanticBlockingIssues: SemanticBlockingIssue[];
  readonly postRepairSemanticBlockingIssues: SemanticBlockingIssue[];
  readonly finalSemanticBlockingIssues: SemanticBlockingIssue[];
  readonly repairGapReason?: RepairGapReason;
  readonly repairCycleCount: number;
  readonly earlySemanticLintCodes: string[];
  readonly primaryCapabilityAnchors: string[];
  readonly featurePriorityWindow: string[];
  readonly coreFeatureIds: string[];
  readonly supportFeatureIds: string[];
  readonly canonicalFeatureIds: string[];
  readonly timelineMismatchedFeatureIds: string[];
  readonly timelineRewrittenFromFeatureMap: boolean;
  readonly timelineRewriteAppliedLines: number;
  readonly compilerRepairTruncationCount: number;
  readonly compilerRepairFinishReasons: string[];
  readonly repairRejected: boolean;
  readonly repairRejectedReason?: string;
  readonly repairDegradationSignals: string[];
  readonly degradedCandidateAvailable: boolean;
  readonly degradedCandidateSource?: DegradedCandidateSource;
  readonly collapsedFeatureNameIds: string[];
  readonly placeholderFeatureIds: string[];
  readonly acceptanceBoilerplateFeatureIds: string[];
  readonly featureQualityFloorFeatureIds: string[];
  readonly featureQualityFloorPassed: boolean;
  readonly primaryFeatureQualityReason?: string;
  readonly emptyMainFlowFeatureIds: string[];
  readonly placeholderPurposeFeatureIds: string[];
  readonly placeholderAlternateFlowFeatureIds: string[];
  readonly thinAcceptanceCriteriaFeatureIds: string[];
  readonly featureQualityFloorFailedFeatureIds: string[];
  readonly displayedCandidateSource?: DisplayedCandidateSource;
  readonly diagnosticsAlignedWithDisplayedCandidate: boolean;
  readonly semanticRepairChangedSections: string[];
  readonly semanticRepairStructuralChange: boolean;
  readonly earlyDriftDetected: boolean;
  readonly earlyDriftCodes: string[];
  readonly earlyDriftSections: string[];
  readonly blockedAddedFeatures: string[];
  readonly earlyRepairAttempted: boolean;
  readonly earlyRepairApplied: boolean;
  readonly primaryEarlyDriftReason?: string;

  constructor(
    message: string,
    quality: PrdQualityReport,
    repairAttempts: CompilerModelResult[],
    compiledResult?: { content: string; structure: PRDStructure },
    meta?: {
      reviewerAttempts?: ReviewerRefineResult[];
      semanticVerification?: SemanticVerificationResult;
      failureStage?: FinalizerFailureStage;
      semanticRepairApplied?: boolean;
      semanticRepairAttempted?: boolean;
      semanticRepairIssueCodes?: string[];
      semanticRepairSectionKeys?: string[];
      semanticRepairTruncated?: boolean;
      initialSemanticBlockingIssues?: SemanticBlockingIssue[];
      postRepairSemanticBlockingIssues?: SemanticBlockingIssue[];
      finalSemanticBlockingIssues?: SemanticBlockingIssue[];
      repairGapReason?: RepairGapReason;
      repairCycleCount?: number;
      earlySemanticLintCodes?: string[];
      primaryCapabilityAnchors?: string[];
      featurePriorityWindow?: string[];
      coreFeatureIds?: string[];
      supportFeatureIds?: string[];
      canonicalFeatureIds?: string[];
      timelineMismatchedFeatureIds?: string[];
      timelineRewrittenFromFeatureMap?: boolean;
      timelineRewriteAppliedLines?: number;
      compilerRepairTruncationCount?: number;
      compilerRepairFinishReasons?: string[];
      repairRejected?: boolean;
      repairRejectedReason?: string;
      repairDegradationSignals?: string[];
      degradedCandidateAvailable?: boolean;
      degradedCandidateSource?: DegradedCandidateSource;
      collapsedFeatureNameIds?: string[];
      placeholderFeatureIds?: string[];
      acceptanceBoilerplateFeatureIds?: string[];
      featureQualityFloorFeatureIds?: string[];
      featureQualityFloorPassed?: boolean;
      primaryFeatureQualityReason?: string;
      emptyMainFlowFeatureIds?: string[];
      placeholderPurposeFeatureIds?: string[];
      placeholderAlternateFlowFeatureIds?: string[];
      thinAcceptanceCriteriaFeatureIds?: string[];
      featureQualityFloorFailedFeatureIds?: string[];
      displayedCandidateSource?: DisplayedCandidateSource;
      diagnosticsAlignedWithDisplayedCandidate?: boolean;
      semanticRepairChangedSections?: string[];
      semanticRepairStructuralChange?: boolean;
      earlyDriftDetected?: boolean;
      earlyDriftCodes?: string[];
      earlyDriftSections?: string[];
      blockedAddedFeatures?: string[];
      earlyRepairAttempted?: boolean;
      earlyRepairApplied?: boolean;
      primaryEarlyDriftReason?: string;
    }
  ) {
    super(message);
    this.name = 'PrdCompilerQualityError';
    this.quality = quality;
    this.repairAttempts = repairAttempts;
    this.reviewerAttempts = meta?.reviewerAttempts || [];
    this.compiledContent = compiledResult?.content;
    this.compiledStructure = compiledResult?.structure;
    this.semanticVerification = meta?.semanticVerification;
    this.failureStage = meta?.failureStage || 'compiler_repair';
    this.semanticRepairApplied = meta?.semanticRepairApplied ?? false;
    this.semanticRepairAttempted = meta?.semanticRepairAttempted ?? false;
    this.semanticRepairIssueCodes = meta?.semanticRepairIssueCodes || [];
    this.semanticRepairSectionKeys = meta?.semanticRepairSectionKeys || [];
    this.semanticRepairTruncated = meta?.semanticRepairTruncated ?? false;
    this.initialSemanticBlockingIssues = meta?.initialSemanticBlockingIssues || [];
    this.postRepairSemanticBlockingIssues = meta?.postRepairSemanticBlockingIssues || [];
    this.finalSemanticBlockingIssues = meta?.finalSemanticBlockingIssues || [];
    this.repairGapReason = meta?.repairGapReason;
    this.repairCycleCount = meta?.repairCycleCount ?? 0;
    this.earlySemanticLintCodes = meta?.earlySemanticLintCodes || [];
    this.primaryCapabilityAnchors = meta?.primaryCapabilityAnchors || [];
    this.featurePriorityWindow = meta?.featurePriorityWindow || [];
    this.coreFeatureIds = meta?.coreFeatureIds || [];
    this.supportFeatureIds = meta?.supportFeatureIds || [];
    this.canonicalFeatureIds = meta?.canonicalFeatureIds || [];
    this.timelineMismatchedFeatureIds = meta?.timelineMismatchedFeatureIds || [];
    this.timelineRewrittenFromFeatureMap = meta?.timelineRewrittenFromFeatureMap ?? false;
    this.timelineRewriteAppliedLines = meta?.timelineRewriteAppliedLines ?? 0;
    this.compilerRepairTruncationCount = meta?.compilerRepairTruncationCount ?? 0;
    this.compilerRepairFinishReasons = meta?.compilerRepairFinishReasons || [];
    this.repairRejected = meta?.repairRejected ?? false;
    this.repairRejectedReason = meta?.repairRejectedReason;
    this.repairDegradationSignals = meta?.repairDegradationSignals || [];
    this.degradedCandidateAvailable = meta?.degradedCandidateAvailable ?? !!compiledResult?.content;
    this.degradedCandidateSource = meta?.degradedCandidateSource;
    this.collapsedFeatureNameIds = meta?.collapsedFeatureNameIds || [];
    this.placeholderFeatureIds = meta?.placeholderFeatureIds || [];
    this.acceptanceBoilerplateFeatureIds = meta?.acceptanceBoilerplateFeatureIds || [];
    this.featureQualityFloorFeatureIds = meta?.featureQualityFloorFeatureIds || [];
    this.featureQualityFloorPassed = meta?.featureQualityFloorPassed ?? true;
    this.primaryFeatureQualityReason = meta?.primaryFeatureQualityReason;
    this.emptyMainFlowFeatureIds = meta?.emptyMainFlowFeatureIds || [];
    this.placeholderPurposeFeatureIds = meta?.placeholderPurposeFeatureIds || [];
    this.placeholderAlternateFlowFeatureIds = meta?.placeholderAlternateFlowFeatureIds || [];
    this.thinAcceptanceCriteriaFeatureIds = meta?.thinAcceptanceCriteriaFeatureIds || [];
    this.featureQualityFloorFailedFeatureIds = meta?.featureQualityFloorFailedFeatureIds || [];
    this.displayedCandidateSource = meta?.displayedCandidateSource;
    this.diagnosticsAlignedWithDisplayedCandidate = meta?.diagnosticsAlignedWithDisplayedCandidate ?? false;
    this.semanticRepairChangedSections = meta?.semanticRepairChangedSections || [];
    this.semanticRepairStructuralChange = meta?.semanticRepairStructuralChange ?? false;
    this.earlyDriftDetected = meta?.earlyDriftDetected ?? false;
    this.earlyDriftCodes = meta?.earlyDriftCodes || [];
    this.earlyDriftSections = meta?.earlyDriftSections || [];
    this.blockedAddedFeatures = meta?.blockedAddedFeatures || [];
    this.earlyRepairAttempted = meta?.earlyRepairAttempted ?? false;
    this.earlyRepairApplied = meta?.earlyRepairApplied ?? false;
    this.primaryEarlyDriftReason = meta?.primaryEarlyDriftReason;
  }
}

export function qualityScore(quality: PrdQualityReport): number {
  let score = 100;
  for (const issue of quality.issues) {
    score -= issue.severity === 'error' ? 10 : 3;
  }
  if (quality.truncatedLikely) score -= 15;
  score -= (quality.missingSections?.length || 0) * 5;
  score -= (quality.fallbackSections?.length || 0) * 3;
  score += Math.min(20, (quality.featureCount || 0) * 2);
  return score;
}

function hasQualityIssue(quality: PrdQualityReport, code: string): boolean {
  return quality.issues.some(issue => issue.code === code);
}

function hasContentReviewError(review: ContentReviewResult | undefined, code: string): boolean {
  return Boolean(review?.issues.some(issue => issue.severity === 'error' && issue.code === code));
}

function shouldShortCircuitStructuralFormatMismatch(quality: PrdQualityReport): boolean {
  if ((quality.featureCount || 0) > 0) return false;
  const hasFormatMismatch = quality.issues.some(issue => issue.code === 'feature_catalogue_format_mismatch');
  if (!hasFormatMismatch) return false;
  const rawSamples = quality.rawFeatureHeadingSamples || [];
  const recovered = quality.normalizedFeatureCountRecovered || 0;
  return rawSamples.length > 0 && recovered === 0;
}

const TARGETED_DETERMINISTIC_REPAIR_CODES = new Set([
  'boilerplate_repetition_detected',
  'boilerplate_feature_acceptance_repetition',
  'feature_specs_incomplete',
  'feature_content_thin',
  'feature_content_shallow',
  'feature_core_semantic_gap',
  'generic_section_boilerplate_timelineMilestones',
  'template_semantic_boilerplate_successCriteria',
  'schema_field_reference_missing',
  'timeline_feature_reference_mismatch',
  'vision_capability_coverage_missing',
  'support_features_overweight',
  'out_of_scope_reintroduced',
  'out_of_scope_future_leakage',
  'rule_schema_property_coverage_missing',
  'deployment_runtime_contradiction',
  'section_content_degenerate',
  'feature_enrichment_field_empty',
]);

function isBroadStructuralRepairCase(quality: PrdQualityReport): boolean {
  return (quality.missingSections?.length || 0) > 0
    || quality.issues.some(issue => [
      'excessive_fallback_sections',
      'high_fallback_section_count',
      'feature_count_regression',
      'feature_loss_during_compilation',
      'unknown_top_level_sections',
      'missing_feature_catalogue',
      'feature_catalogue_format_mismatch',
      'feature_specs_unstructured',
      'feature_specs_partially_unstructured',
      'truncated_output',
    ].includes(issue.code));
}

function normalizeSectionKeyFromEvidencePath(path?: string): string | null {
  const normalized = String(path || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('feature:')) {
    return normalized.split('.')[0];
  }
  return normalized.split('.')[0] || null;
}

function uniqueTargetFields(fields: string[]): ContentIssue['targetFields'] {
  return Array.from(new Set(fields.filter(Boolean))) as ContentIssue['targetFields'];
}

const CORE_FEATURE_REPAIR_FIELDS: FeatureEnrichableField[] = [
  'purpose',
  'actors',
  'trigger',
  'preconditions',
  'mainFlow',
  'alternateFlows',
  'postconditions',
  'dataImpact',
  'acceptanceCriteria',
];

type FeatureQualitySnapshot = {
  averageSubstantialFieldCount: number;
  collapsedNameFeatureIds: string[];
  placeholderFieldFeatureIds: string[];
  placeholderPurposeFeatureIds: string[];
  dummyMainFlowFeatureIds: string[];
  placeholderAlternateFlowFeatureIds: string[];
  repeatedAcceptanceFeatureIds: string[];
  thinAcceptanceCriteriaFeatureIds: string[];
  lowSubstantialFeatureIds: string[];
};

function normalizeFeatureToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function stripMarkdownMarkers(value: string): string {
  return String(value || '')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlaceholderLikeText(value: string): boolean {
  const normalized = stripMarkdownMarkers(value).toLowerCase();
  if (!normalized) return true;
  if (normalized === 'feature id' || normalized === 'purpose') return true;
  if (normalized === 'tbd' || normalized === 'todo' || normalized === 'placeholder') return true;
  if (normalized === '**') return true;
  return /^feature id[:\s-]*f-?\d+$/i.test(normalized);
}

function isFeatureNameCollapsed(feature: FeatureSpec): boolean {
  const id = normalizeFeatureToken(String(feature.id || ''));
  const rawName = stripMarkdownMarkers(String(feature.name || ''));
  if (!id) return false;
  if (!rawName) return true;
  if (isPlaceholderLikeText(rawName)) return true;
  const name = normalizeFeatureToken(rawName);
  return !name || id === name;
}

function hasMeaningfulFeatureName(feature: FeatureSpec): boolean {
  const name = stripMarkdownMarkers(String(feature.name || ''));
  if (!name) return false;
  if (isPlaceholderLikeText(name)) return false;
  return !isFeatureNameCollapsed(feature);
}

function normalizeFeatureArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(entry => String(entry || '').trim()).filter(Boolean)
    : [];
}

function normalizeFeatureScalarField(value: unknown): string {
  return String(value || '').trim();
}

function countMeaningfulArrayItems(items: string[]): number {
  return items.filter(item => {
    const text = stripMarkdownMarkers(item);
    return text.length >= 10 && !isPlaceholderLikeText(text);
  }).length;
}

function hasMeaningfulArrayItems(items: string[], minItems = 1): boolean {
  return countMeaningfulArrayItems(items) >= minItems;
}

function hasMeaningfulScalarValue(value: unknown, minLen = 20): boolean {
  const text = stripMarkdownMarkers(String(value || ''));
  return text.length >= minLen && !isPlaceholderLikeText(text);
}

function hasSubstantiveAcceptanceCriteria(feature: FeatureSpec): boolean {
  const acceptanceCriteria = normalizeFeatureArrayField(feature.acceptanceCriteria);
  const meaningfulCount = countMeaningfulArrayItems(acceptanceCriteria);
  if (meaningfulCount >= 2) return true;
  if (meaningfulCount !== 1) return false;

  const mainFlow = normalizeFeatureArrayField(feature.mainFlow);
  const hasStrongFeatureContext = hasMeaningfulScalarValue(feature.purpose, 30)
    && countMeaningfulArrayItems(mainFlow) >= 2
    && (
      hasMeaningfulScalarValue(feature.postconditions, 20)
      || hasMeaningfulScalarValue(feature.dataImpact, 20)
    );

  return hasStrongFeatureContext;
}

type FeatureQualityRecoveryResult = {
  structure: PRDStructure;
  changed: boolean;
  restoredNameFeatureIds: string[];
  restoredPlaceholderFeatureIds: string[];
  restoredAcceptanceFeatureIds: string[];
};

function countSubstantialFeatureFields(feature: FeatureSpec): number {
  let substantialFieldCount = 0;
  const featureNameLower = stripMarkdownMarkers(String(feature.name || '')).toLowerCase();
  const featureNameWords = new Set(featureNameLower.split(/\s+/).filter(w => w.length >= 3));

  for (const field of FEATURE_ENRICHABLE_FIELDS) {
    if (field === 'name') continue;
    const value = feature[field];
    if (Array.isArray(value)) {
      if (field === 'acceptanceCriteria') {
        if (hasSubstantiveAcceptanceCriteria(feature)) {
          substantialFieldCount++;
        }
        continue;
      }

      const minItems = field === 'mainFlow' ? 3 : 1;
      if (countMeaningfulArrayItems(value) >= minItems) {
        substantialFieldCount++;
      }
      continue;
    }

    if (typeof value === 'string') {
      const text = stripMarkdownMarkers(value);
      const minLen = field === 'purpose' ? 30 : 20;
      if (text.length < minLen || isPlaceholderLikeText(text)) {
        continue;
      }
      const textLower = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
      const textWords = new Set(textLower.split(/\s+/).filter(w => w.length >= 3));
      const overlap = [...featureNameWords].filter(w => textWords.has(w)).length;
      const echoRatio = featureNameWords.size > 0 ? overlap / featureNameWords.size : 0;
      if (!(echoRatio > 0.8 && text.length < 60)) {
        substantialFieldCount++;
      }
    }
  }

  return substantialFieldCount;
}

function snapshotFeatureQuality(structure: PRDStructure): FeatureQualitySnapshot {
  const features = structure.features || [];
  const collapsedNameFeatureIds: string[] = [];
  const placeholderFieldFeatureIds: string[] = [];
  const placeholderPurposeFeatureIds: string[] = [];
  const dummyMainFlowFeatureIds: string[] = [];
  const placeholderAlternateFlowFeatureIds: string[] = [];
  const thinAcceptanceCriteriaFeatureIds: string[] = [];
  const lowSubstantialFeatureIds: string[] = [];
  const substantialCounts: number[] = [];
  const acceptanceMap = new Map<string, Set<string>>();

  for (const feature of features) {
    const featureId = String(feature.id || '').trim();
    if (!featureId) continue;

    if (isFeatureNameCollapsed(feature)) {
      collapsedNameFeatureIds.push(featureId);
    }

    const placeholderFieldCount = CORE_FEATURE_REPAIR_FIELDS.reduce((count, field) => {
      const value = feature[field];
      if (Array.isArray(value)) {
        if (field === 'acceptanceCriteria') {
          return count + (hasSubstantiveAcceptanceCriteria(feature) ? 0 : 1);
        }
        return count + (countMeaningfulArrayItems(value) > 0 ? 0 : 1);
      }
      return count + (isPlaceholderLikeText(String(value || '')) ? 1 : 0);
    }, 0);
    if (placeholderFieldCount >= 4) {
      placeholderFieldFeatureIds.push(featureId);
    }
    if (!hasMeaningfulScalarValue(feature.purpose, 30)) {
      placeholderPurposeFeatureIds.push(featureId);
    }

    const mainFlow = Array.isArray(feature.mainFlow) ? feature.mainFlow : [];
    const meaningfulMainFlow = mainFlow.filter((entry: string) => {
      const text = stripMarkdownMarkers(String(entry || ''));
      return text.length >= 10 && !isPlaceholderLikeText(text);
    });
    if (meaningfulMainFlow.length < 1) {
      dummyMainFlowFeatureIds.push(featureId);
    }

    const alternateFlows = Array.isArray(feature.alternateFlows) ? feature.alternateFlows : [];
    if (alternateFlows.length === 0 || !hasMeaningfulArrayItems(alternateFlows, 1)) {
      placeholderAlternateFlowFeatureIds.push(featureId);
    }

    const substantialFieldCount = countSubstantialFeatureFields(feature);
    substantialCounts.push(substantialFieldCount);
    if (substantialFieldCount < 4) {
      lowSubstantialFeatureIds.push(featureId);
    }

    if (!hasSubstantiveAcceptanceCriteria(feature)) {
      thinAcceptanceCriteriaFeatureIds.push(featureId);
    }

    for (const entry of feature.acceptanceCriteria || []) {
      const normalized = stripMarkdownMarkers(String(entry || '')).toLowerCase();
      if (normalized.length < 30 || isPlaceholderLikeText(normalized)) continue;
      const featureIds = acceptanceMap.get(normalized) || new Set<string>();
      featureIds.add(featureId);
      acceptanceMap.set(normalized, featureIds);
    }
  }

  const repeatedAcceptanceFeatureIds = Array.from(new Set(
    Array.from(acceptanceMap.values())
      .filter(featureIds => featureIds.size >= 4)
      .flatMap(featureIds => Array.from(featureIds))
  ));

  const averageSubstantialFieldCount = substantialCounts.length > 0
    ? substantialCounts.reduce((sum, count) => sum + count, 0) / substantialCounts.length
    : 0;

  return {
    averageSubstantialFieldCount,
    collapsedNameFeatureIds,
    placeholderFieldFeatureIds,
    placeholderPurposeFeatureIds,
    dummyMainFlowFeatureIds,
    placeholderAlternateFlowFeatureIds,
    repeatedAcceptanceFeatureIds,
    thinAcceptanceCriteriaFeatureIds,
    lowSubstantialFeatureIds,
  };
}

function restoreFeatureQualityFromBest(params: {
  bestStructure: PRDStructure;
  candidateStructure: PRDStructure;
}): FeatureQualityRecoveryResult {
  const bestById = new Map(
    (params.bestStructure.features || []).map(feature => [String(feature.id || '').trim().toUpperCase(), feature] as const)
  );
  const restoredNameFeatureIds = new Set<string>();
  const restoredPlaceholderFeatureIds = new Set<string>();
  const restoredAcceptanceFeatureIds = new Set<string>();
  let changed = false;

  const restoredFeatures = (params.candidateStructure.features || []).map((feature) => {
    const featureId = String(feature.id || '').trim().toUpperCase();
    const bestFeature = bestById.get(featureId);
    if (!bestFeature) return feature;

    let featureChanged = false;
    const nextFeature: FeatureSpec = { ...feature };

    if (!hasMeaningfulFeatureName(feature) && hasMeaningfulFeatureName(bestFeature)) {
      nextFeature.name = bestFeature.name;
      restoredNameFeatureIds.add(featureId);
      featureChanged = true;
    }

    for (const field of CORE_FEATURE_REPAIR_FIELDS) {
      if (field === 'acceptanceCriteria') continue;

      if (field === 'mainFlow' || field === 'alternateFlows') {
        const currentItems = normalizeFeatureArrayField(feature[field]);
        const bestItems = normalizeFeatureArrayField(bestFeature[field]);
        const minItems = field === 'mainFlow' ? 2 : 1;
        if (!hasMeaningfulArrayItems(currentItems, minItems) && hasMeaningfulArrayItems(bestItems, minItems)) {
          (nextFeature as any)[field] = [...bestItems];
          restoredPlaceholderFeatureIds.add(featureId);
          featureChanged = true;
        }
        continue;
      }

      const currentValue = normalizeFeatureScalarField(feature[field]);
      const bestValue = normalizeFeatureScalarField(bestFeature[field]);
      const minLen = field === 'purpose' ? 30 : 20;
      if (!hasMeaningfulScalarValue(currentValue, minLen) && hasMeaningfulScalarValue(bestValue, minLen)) {
        (nextFeature as any)[field] = bestValue;
        restoredPlaceholderFeatureIds.add(featureId);
        featureChanged = true;
      }
    }

    const bestAcceptance = normalizeFeatureArrayField(bestFeature.acceptanceCriteria);
    if (!hasSubstantiveAcceptanceCriteria(feature) && hasSubstantiveAcceptanceCriteria(bestFeature)) {
      nextFeature.acceptanceCriteria = [...bestAcceptance];
      restoredAcceptanceFeatureIds.add(featureId);
      featureChanged = true;
    }

    if (featureChanged) {
      changed = true;
      return nextFeature;
    }

    return feature;
  });

  return {
    structure: changed
      ? { ...params.candidateStructure, features: restoredFeatures }
      : params.candidateStructure,
    changed,
    restoredNameFeatureIds: Array.from(restoredNameFeatureIds),
    restoredPlaceholderFeatureIds: Array.from(restoredPlaceholderFeatureIds),
    restoredAcceptanceFeatureIds: Array.from(restoredAcceptanceFeatureIds),
  };
}

function buildFeatureQualityTargets(structure: PRDStructure, quality: PrdQualityReport): ContentIssue[] {
  const issueCodes = new Set(quality.issues.map(issue => issue.code));
  if (![...issueCodes].some(code => TARGETED_DETERMINISTIC_REPAIR_CODES.has(code))) {
    return [];
  }

  const snapshot = snapshotFeatureQuality(structure);
  const issues: ContentIssue[] = [];
  const seen = new Set<string>();
  const pushFeatureIssue = (featureId: string, message: string, targetFields: FeatureEnrichableField[]) => {
    const key = `${featureId}::${message}::${targetFields.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      code: 'feature_quality_floor',
      sectionKey: `feature:${featureId}`,
      message,
      severity: 'error',
      suggestedAction: 'enrich',
      targetFields: uniqueTargetFields(targetFields),
    });
  };

  const thinOrIncompleteActive = issueCodes.has('feature_specs_incomplete')
    || issueCodes.has('feature_content_thin')
    || issueCodes.has('feature_content_shallow')
    || issueCodes.has('boilerplate_repetition_detected');
  if (thinOrIncompleteActive) {
    for (const featureId of snapshot.lowSubstantialFeatureIds) {
      pushFeatureIssue(
        featureId,
        `Feature ${featureId} has thin or incomplete structured content. Rewrite the primary feature fields with feature-specific detail.`,
        ['name', ...CORE_FEATURE_REPAIR_FIELDS]
      );
    }
  }

  if (issueCodes.has('boilerplate_feature_acceptance_repetition')) {
    for (const featureId of snapshot.repeatedAcceptanceFeatureIds) {
      pushFeatureIssue(
        featureId,
        `Feature ${featureId} uses repeated acceptance-criteria boilerplate. Rewrite the acceptance criteria to be feature-specific and testable.`,
        ['name', 'acceptanceCriteria', 'trigger', 'mainFlow', 'postconditions', 'dataImpact']
      );
    }
  }

  for (const featureId of snapshot.collapsedNameFeatureIds) {
    pushFeatureIssue(
      featureId,
      `Feature ${featureId} lost its descriptive name and collapsed to a bare ID. Preserve the existing feature identity and rewrite the target fields so they stay consistent with that identity.`,
      ['name', ...CORE_FEATURE_REPAIR_FIELDS]
    );
  }

  for (const featureId of snapshot.placeholderPurposeFeatureIds) {
    pushFeatureIssue(
      featureId,
      `Feature ${featureId} uses placeholder or ID-echo purpose text. Rewrite the feature purpose so it describes the actual user-visible behavior.`,
      ['name', 'purpose', 'trigger', 'mainFlow', 'postconditions', 'dataImpact', 'acceptanceCriteria']
    );
  }

  for (const featureId of snapshot.dummyMainFlowFeatureIds) {
    pushFeatureIssue(
      featureId,
      `Feature ${featureId} is missing a substantive main flow. Replace the placeholder flow with concrete user/system steps.`,
      ['name', 'trigger', 'mainFlow', 'postconditions', 'dataImpact', 'acceptanceCriteria']
    );
  }

  for (const featureId of snapshot.placeholderAlternateFlowFeatureIds) {
    pushFeatureIssue(
      featureId,
      `Feature ${featureId} uses placeholder alternate flows. Replace them with at least one concrete edge case or error path that matches the feature behavior.`,
      ['name', 'alternateFlows', 'mainFlow', 'postconditions', 'acceptanceCriteria']
    );
  }

  for (const featureId of snapshot.thinAcceptanceCriteriaFeatureIds) {
    pushFeatureIssue(
      featureId,
      `Feature ${featureId} uses thin or non-specific acceptance criteria. Rewrite them so they are feature-specific and testable.`,
      ['name', 'acceptanceCriteria', 'trigger', 'mainFlow', 'postconditions', 'dataImpact']
    );
  }

  return issues;
}

function collectRepairDegradationSignals(bestStructure: PRDStructure, candidateStructure: PRDStructure): string[] {
  const signals = new Set<string>();
  const candidateSnapshot = snapshotFeatureQuality(candidateStructure);
  const bestSnapshot = snapshotFeatureQuality(bestStructure);
  const featureCount = Math.max(candidateStructure.features?.length || 0, 0);
  const widespreadThreshold = Math.max(2, Math.ceil(featureCount * 0.25));

  if (candidateSnapshot.collapsedNameFeatureIds.length >= widespreadThreshold) {
    signals.add('feature_names_collapsed_to_ids');
  }
  if (candidateSnapshot.placeholderFieldFeatureIds.length >= widespreadThreshold) {
    signals.add('placeholder_required_fields');
  }
  if (candidateSnapshot.dummyMainFlowFeatureIds.length >= Math.max(2, Math.ceil(featureCount * 0.2))) {
    signals.add('dummy_main_flow');
  }
  if (candidateSnapshot.repeatedAcceptanceFeatureIds.length >= Math.max(4, Math.ceil(featureCount * 0.2))) {
    signals.add('acceptance_criteria_boilerplate');
  }
  if (
    candidateSnapshot.averageSubstantialFieldCount + 2
      <= bestSnapshot.averageSubstantialFieldCount
  ) {
    signals.add('substantial_field_regression');
  }

  // ÄNDERUNG 13.03.2026: Erkennt katastrophalen Feature-Verlust (>50% der Features verloren).
  const baselineFeatureCount = bestStructure.features?.length || 0;
  const candidateFeatureCount = candidateStructure.features?.length || 0;
  if (baselineFeatureCount > 0 && candidateFeatureCount < Math.ceil(baselineFeatureCount * 0.5)) {
    signals.add('substantial_feature_loss');
  }

  return Array.from(signals);
}

function buildRepairRejectedReason(signals: string[]): string | undefined {
  if (signals.length === 0) return undefined;
  const labels: Record<string, string> = {
    feature_names_collapsed_to_ids: 'feature names collapsed to bare IDs',
    placeholder_required_fields: 'required feature fields were replaced by placeholders',
    dummy_main_flow: 'main flows degraded into dummy or placeholder steps',
    acceptance_criteria_boilerplate: 'acceptance criteria collapsed into repeated boilerplate',
    substantial_field_regression: 'feature detail regressed sharply compared to the best candidate',
    substantial_feature_loss: 'more than half of features were lost in the repair output',
  };
  return `Rejected compiler repair because ${signals.map(signal => labels[signal] || signal.replace(/_/g, ' ')).join(', ')}.`;
}

type FeatureQualityDiagnostics = {
  collapsedFeatureNameIds: string[];
  placeholderFeatureIds: string[];
  acceptanceBoilerplateFeatureIds: string[];
  featureQualityFloorFeatureIds: string[];
  featureQualityFloorFailedFeatureIds: string[];
  featureQualityFloorPassed: boolean;
  primaryFeatureQualityReason?: string;
  emptyMainFlowFeatureIds: string[];
  placeholderPurposeFeatureIds: string[];
  placeholderAlternateFlowFeatureIds: string[];
  thinAcceptanceCriteriaFeatureIds: string[];
};

function buildFeatureQualityDiagnostics(
  structure: PRDStructure,
  quality?: Pick<PrdQualityReport, 'featurePriorityWindow'>
): FeatureQualityDiagnostics {
  const snapshot = snapshotFeatureQuality(structure);
  const featureIds = (structure.features || []).map(feature => String(feature.id || '').trim()).filter(Boolean);
  const requestedWindow = Array.from(new Set((quality?.featurePriorityWindow || []).filter(Boolean)));
  const defaultWindowSize = Math.max(3, Math.min(5, Math.ceil(featureIds.length * 0.35)));
  const featurePriorityWindow = (requestedWindow.length > 0 ? requestedWindow : featureIds.slice(0, defaultWindowSize))
    .filter(featureId => featureIds.includes(featureId));
  const featurePrioritySet = new Set(featurePriorityWindow);
  const countLeadingHits = (values: string[]) => values.filter(featureId => featurePrioritySet.has(featureId)).length;
  const minLeadThreshold = 2;
  const broadFeatureThreshold = Math.max(3, Math.ceil(featureIds.length * 0.2));
  const collapsedLeadingIds = snapshot.collapsedNameFeatureIds.filter(featureId => featurePrioritySet.has(featureId));
  const placeholderPurposeLeadingIds = snapshot.placeholderPurposeFeatureIds.filter(featureId => featurePrioritySet.has(featureId));
  const emptyMainFlowLeadingIds = snapshot.dummyMainFlowFeatureIds.filter(featureId => featurePrioritySet.has(featureId));
  const thinAcceptanceLeadingIds = snapshot.thinAcceptanceCriteriaFeatureIds.filter(featureId => featurePrioritySet.has(featureId));
  const lowSubstantialLeadingIds = snapshot.lowSubstantialFeatureIds.filter(featureId => featurePrioritySet.has(featureId));
  let featureQualityFloorPassed = true;
  let primaryFeatureQualityReason: string | undefined;
  let qualityFloorFailedFeatureIds: string[] = [];

  if (collapsedLeadingIds.length > 0) {
    featureQualityFloorPassed = false;
    qualityFloorFailedFeatureIds = collapsedLeadingIds;
    primaryFeatureQualityReason = `Leading features collapsed to bare IDs: ${collapsedLeadingIds.join(', ')}.`;
  } else if (placeholderPurposeLeadingIds.length >= minLeadThreshold) {
    featureQualityFloorPassed = false;
    qualityFloorFailedFeatureIds = placeholderPurposeLeadingIds;
    primaryFeatureQualityReason = `Leading features use placeholder or ID-echo purpose text: ${placeholderPurposeLeadingIds.join(', ')}.`;
  } else if (emptyMainFlowLeadingIds.length >= minLeadThreshold) {
    featureQualityFloorPassed = false;
    qualityFloorFailedFeatureIds = emptyMainFlowLeadingIds;
    primaryFeatureQualityReason = `Leading features are missing substantive main flows: ${emptyMainFlowLeadingIds.join(', ')}.`;
  } else if (thinAcceptanceLeadingIds.length >= minLeadThreshold) {
    featureQualityFloorPassed = false;
    qualityFloorFailedFeatureIds = thinAcceptanceLeadingIds;
    primaryFeatureQualityReason = `Leading features use thin or generic acceptance criteria: ${thinAcceptanceLeadingIds.join(', ')}.`;
  } else if (lowSubstantialLeadingIds.length >= minLeadThreshold) {
    featureQualityFloorPassed = false;
    qualityFloorFailedFeatureIds = lowSubstantialLeadingIds;
    primaryFeatureQualityReason = `Feature substance is too thin across the leading feature set: ${lowSubstantialLeadingIds.join(', ')}.`;
  } else if (snapshot.lowSubstantialFeatureIds.length >= broadFeatureThreshold) {
    featureQualityFloorPassed = false;
    qualityFloorFailedFeatureIds = snapshot.lowSubstantialFeatureIds;
    primaryFeatureQualityReason = `Feature substance is too thin across the broader feature set: ${snapshot.lowSubstantialFeatureIds.slice(0, 5).join(', ')}.`;
  }

  const qualityFloorRelevantIds = Array.from(new Set([
    ...snapshot.lowSubstantialFeatureIds,
    ...snapshot.collapsedNameFeatureIds,
    ...snapshot.placeholderPurposeFeatureIds,
    ...snapshot.dummyMainFlowFeatureIds,
    ...snapshot.placeholderAlternateFlowFeatureIds,
    ...snapshot.thinAcceptanceCriteriaFeatureIds,
  ])).sort();
  const qualityFloorFeatureIds = Array.from(new Set([
    ...featurePriorityWindow,
    ...qualityFloorRelevantIds,
  ])).sort();

  return {
    collapsedFeatureNameIds: snapshot.collapsedNameFeatureIds,
    placeholderFeatureIds: Array.from(new Set([
      ...snapshot.placeholderFieldFeatureIds,
      ...snapshot.placeholderPurposeFeatureIds,
      ...snapshot.dummyMainFlowFeatureIds,
      ...snapshot.placeholderAlternateFlowFeatureIds,
    ])).sort(),
    acceptanceBoilerplateFeatureIds: snapshot.repeatedAcceptanceFeatureIds,
    // `featureQualityFloorFeatureIds` records the inspected/relevant floor scope,
    // while `featureQualityFloorFailedFeatureIds` stays limited to the tripping IDs.
    featureQualityFloorFeatureIds: qualityFloorFeatureIds,
    featureQualityFloorFailedFeatureIds: qualityFloorFailedFeatureIds,
    featureQualityFloorPassed,
    primaryFeatureQualityReason,
    emptyMainFlowFeatureIds: snapshot.dummyMainFlowFeatureIds,
    placeholderPurposeFeatureIds: snapshot.placeholderPurposeFeatureIds,
    placeholderAlternateFlowFeatureIds: snapshot.placeholderAlternateFlowFeatureIds,
    thinAcceptanceCriteriaFeatureIds: snapshot.thinAcceptanceCriteriaFeatureIds,
  };
}

function buildFeatureQualityFloorIssue(diagnostics: FeatureQualityDiagnostics): { code: string; message: string; severity: 'error' } | null {
  if (diagnostics.featureQualityFloorPassed !== false) return null;
  return {
    code: 'feature_quality_floor_failed',
    message: diagnostics.primaryFeatureQualityReason
      || 'Leading or canonical features are structurally present but semantically too thin to support release decisions.',
    severity: 'error',
  };
}

function withFeatureQualityFloorIssue(
  quality: PrdQualityReport,
  diagnostics: FeatureQualityDiagnostics
): PrdQualityReport {
  const floorIssue = buildFeatureQualityFloorIssue(diagnostics);
  if (!floorIssue) return quality;
  if (quality.issues.some(issue => issue.code === floorIssue.code)) {
    return quality;
  }
  return withSyntheticQualityIssue(quality, floorIssue);
}

function calculateFeatureSubstanceScore(
  structure: PRDStructure,
  diagnostics: FeatureQualityDiagnostics
): number {
  const snapshot = snapshotFeatureQuality(structure);
  let score = Math.round(snapshot.averageSubstantialFieldCount * 100);
  score += diagnostics.featureQualityFloorPassed ? 5000 : 0;
  score -= diagnostics.featureQualityFloorFailedFeatureIds.length * 40;
  score -= diagnostics.placeholderPurposeFeatureIds.length * 25;
  score -= diagnostics.emptyMainFlowFeatureIds.length * 25;
  score -= diagnostics.placeholderAlternateFlowFeatureIds.length * 15;
  score -= diagnostics.thinAcceptanceCriteriaFeatureIds.length * 15;
  return score;
}

type EvaluatedCandidate = {
  content: string;
  compiled: {
    content: string;
    structure: PRDStructure;
    quality: PrdQualityReport;
  };
  featureQualityDiagnostics: FeatureQualityDiagnostics;
  featureSubstanceScore: number;
};

function compareCandidatePreference(
  left: EvaluatedCandidate,
  right: EvaluatedCandidate
): number {
  const leftFeatureCount = left.compiled.structure.features?.length || 0;
  const rightFeatureCount = right.compiled.structure.features?.length || 0;
  if (leftFeatureCount !== rightFeatureCount) {
    if (leftFeatureCount === 0) return -1;
    if (rightFeatureCount === 0) return 1;
  }
  if (left.featureQualityDiagnostics.featureQualityFloorPassed !== right.featureQualityDiagnostics.featureQualityFloorPassed) {
    return left.featureQualityDiagnostics.featureQualityFloorPassed ? 1 : -1;
  }
  if (left.featureSubstanceScore !== right.featureSubstanceScore) {
    return left.featureSubstanceScore - right.featureSubstanceScore;
  }
  return qualityScore(left.compiled.quality) - qualityScore(right.compiled.quality);
}

function toDeterministicContentIssues(
  quality: PrdQualityReport,
  structure: PRDStructure,
  featureQualityDiagnostics: FeatureQualityDiagnostics
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seen = new Set<string>();
  const featureQualityFloorFailed = featureQualityDiagnostics.featureQualityFloorPassed === false;

  const pushIssue = (issue: ContentIssue) => {
    const key = JSON.stringify([
      issue.code,
      issue.sectionKey,
      issue.message,
      issue.suggestedAction,
      issue.targetFields || [],
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const issue of quality.issues) {
    if (!TARGETED_DETERMINISTIC_REPAIR_CODES.has(issue.code)) {
      continue;
    }
    if (
      featureQualityFloorFailed
      && ['out_of_scope_future_leakage', 'out_of_scope_reintroduced'].includes(issue.code)
    ) {
      continue;
    }

    const sectionKeyFromPath = normalizeSectionKeyFromEvidencePath(issue.evidencePath);
    // ÄNDERUNG 14.03.2026: Leere Enrichment-Felder gezielt auffuellen,
    // bevor der Semantic Verifier sie als feature_section_semantic_mismatch meldet.
    if (issue.code === 'feature_enrichment_field_empty') {
      const featureSectionKey = sectionKeyFromPath?.startsWith('feature:') ? sectionKeyFromPath : null;
      if (featureSectionKey) {
        pushIssue({
          code: issue.code,
          sectionKey: featureSectionKey,
          message: issue.message,
          severity: 'error',
          suggestedAction: 'enrich',
          targetFields: uniqueTargetFields(issue.relatedPaths || []),
        });
      }
      continue;
    }

    if (issue.code === 'feature_core_semantic_gap') {
      const featureSectionKey = sectionKeyFromPath?.startsWith('feature:') ? sectionKeyFromPath : 'systemVision';
      if (featureSectionKey.startsWith('feature:')) {
        // ÄNDERUNG 11.03.2026: Core-Semantik-Luecken muessen eng auf die
        // eigentliche Konsistenzachse begrenzt bleiben, damit der
        // deterministische Repair keine unnoetig breiten Feature-Umschriften ausloest.
        pushIssue({
          code: issue.code,
          sectionKey: featureSectionKey,
          message: issue.message,
          severity: 'error',
          suggestedAction: 'enrich',
          targetFields: uniqueTargetFields([
            'preconditions',
            'postconditions',
            'dataImpact',
          ]),
        });
      } else {
        pushIssue({
          code: issue.code,
          sectionKey: 'systemVision',
          message: issue.message,
          severity: 'error',
          suggestedAction: 'rewrite',
        });
      }
      continue;
    }

    // ÄNDERUNG 10.03.2026: Generische Timeline-Boilerplate muss im
    // deterministischen Repair denselben Zielabschnitt treffen wie echte
    // Timeline-Referenzfehler, damit der Live-Pfad nicht ohne Timeline-Target endet.
    if (
      issue.code === 'timeline_feature_reference_mismatch'
      || issue.code === 'generic_section_boilerplate_timelineMilestones'
    ) {
      pushIssue({
        code: issue.code,
        sectionKey: 'timelineMilestones',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      continue;
    }

    // ÄNDERUNG 10.03.2026: Template-Boilerplate in Success Criteria muss schon
    // im deterministischen Repair gezielt umgeschrieben werden, damit der
    // `post_targeted_repair`-Kandidat nicht mit generischem Resttext endet.
    if (issue.code === 'template_semantic_boilerplate_successCriteria') {
      pushIssue({
        code: issue.code,
        sectionKey: 'successCriteria',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      continue;
    }

    if (issue.code === 'vision_capability_coverage_missing' || issue.code === 'support_features_overweight') {
      for (const pathValue of issue.relatedPaths || []) {
        const sectionKey = normalizeSectionKeyFromEvidencePath(pathValue);
        if (!sectionKey?.startsWith('feature:')) continue;
        pushIssue({
          code: issue.code,
          sectionKey,
          message: issue.message,
          severity: 'error',
          suggestedAction: 'enrich',
          targetFields: uniqueTargetFields([
            'purpose',
            'trigger',
            'mainFlow',
            'preconditions',
            'postconditions',
            'dataImpact',
            'acceptanceCriteria',
          ]),
        });
      }
      pushIssue({
        code: issue.code,
        sectionKey: 'systemVision',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      continue;
    }

    // ÄNDERUNG 11.03.2026: Schema-Referenzfehler muessen den deterministischen
    // Repair sicher in den Domain-Model-Pfad fuehren; bei Feature-Evidence wird
    // zusaetzlich das betroffene Feature mit derselben Repair-Schleife angereichert.
    if (issue.code === 'schema_field_reference_missing') {
      pushIssue({
        code: issue.code,
        sectionKey: 'domainModel',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      if (sectionKeyFromPath?.startsWith('feature:')) {
        pushIssue({
          code: issue.code,
          sectionKey: sectionKeyFromPath,
          message: issue.message,
          severity: 'error',
          suggestedAction: 'enrich',
          targetFields: uniqueTargetFields([
            'purpose',
            'trigger',
            'mainFlow',
            'preconditions',
            'postconditions',
            'dataImpact',
            'acceptanceCriteria',
          ]),
        });
      }
      continue;
    }

    // ÄNDERUNG 11.03.2026: Reintroduced scope leaks muessen denselben konkreten
    // Evidence-Abschnitt treffen wie im existierenden Repair-Mapping; sonst endet
    // der Live-Pfad wieder ohne verwertbaren Target-Reviewer-Call.
    if (issue.code === 'out_of_scope_reintroduced' || issue.code === 'out_of_scope_future_leakage') {
      const sectionKey = sectionKeyFromPath || 'outOfScope';
      pushIssue({
        code: issue.code,
        sectionKey,
        message: issue.message,
        severity: 'error',
        suggestedAction: sectionKey.startsWith('feature:') ? 'enrich' : 'rewrite',
        ...(sectionKey.startsWith('feature:')
          ? {
            targetFields: uniqueTargetFields([
              'purpose',
              'trigger',
              'dataImpact',
              'uiImpact',
            ]),
          }
          : {}),
      });
      continue;
    }

    if (issue.code === 'rule_schema_property_coverage_missing') {
      pushIssue({
        code: issue.code,
        sectionKey: 'domainModel',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      pushIssue({
        code: issue.code,
        sectionKey: 'globalBusinessRules',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      continue;
    }

    if (issue.code === 'deployment_runtime_contradiction') {
      pushIssue({
        code: issue.code,
        sectionKey: 'systemBoundaries',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      pushIssue({
        code: issue.code,
        sectionKey: 'deployment',
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      continue;
    }

    if (issue.code === 'section_content_degenerate') {
      const sectionKey = sectionKeyFromPath || 'outOfScope';
      pushIssue({
        code: issue.code,
        sectionKey,
        message: issue.message,
        severity: 'error',
        suggestedAction: 'rewrite',
      });
      continue;
    }
  }

  for (const featureIssue of buildFeatureQualityTargets(structure, quality)) {
    pushIssue(featureIssue);
  }

  return issues;
}

function deterministicIssueSignature(issues: ContentIssue[]): string {
  return JSON.stringify(issues.map(issue => ({
    code: issue.code,
    sectionKey: issue.sectionKey,
    suggestedAction: issue.suggestedAction,
    targetFields: issue.targetFields || [],
  })));
}

function shouldRepair(
  _result: CompilerModelResult,
  quality: PrdQualityReport,
  mode: 'generate' | 'improve'
): boolean {
  if (!quality.valid) return true;
  if (quality.truncatedLikely) return true;

  // ÄNDERUNG 08.03.2026: Generate-Ergebnisse mit massiv compilerseitig
  // erzeugten Fallback-Sektionen duerfen nicht still als final akzeptiert
  // werden. Sie muessen in den Repair-/Fehlerpfad laufen.
  if (mode === 'generate' && hasQualityIssue(quality, 'excessive_fallback_sections')) {
    return true;
  }

  // If the compiler produced a valid, non-truncated structure, accept it even
  // when the raw model output looked syntactically incomplete (finish_reason='length').
  return false;
}

export function toSemanticContentIssues(issues: SemanticBlockingIssue[]): ContentIssue[] {
  return issues.map(issue => {
    const sectionKey = String(issue.sectionKey || '').trim() || 'systemVision';
    const isFeatureIssue = sectionKey.startsWith('feature:');
    const targetFields = issue.targetFields?.length
      ? issue.targetFields.join(', ')
      : '';
    const baseMessage = String(issue.message || '').trim()
      || (isFeatureIssue
        ? `Feature block "${sectionKey}" contains a blocking semantic mismatch.`
        : `Section "${sectionKey}" contains a blocking semantic inconsistency.`);
    const message = isFeatureIssue && targetFields && !/Rewrite:\s/i.test(baseMessage)
      ? `${baseMessage} Rewrite: ${targetFields}`
      : baseMessage;

    return {
      code: issue.code || 'cross_section_inconsistency',
      sectionKey,
      message,
      severity: 'error',
      suggestedAction: issue.suggestedAction || (isFeatureIssue ? 'enrich' : 'rewrite'),
      ...(issue.targetFields?.length ? { targetFields: issue.targetFields } : {}),
      ...(issue.suggestedFix ? { suggestedFix: issue.suggestedFix } : {}),
    };
  });
}

function cloneSemanticBlockingIssues(issues: SemanticBlockingIssue[] | undefined): SemanticBlockingIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.map(issue => ({
    code: String(issue.code || '').trim() || 'cross_section_inconsistency',
    sectionKey: String(issue.sectionKey || '').trim() || 'systemVision',
    message: String(issue.message || '').trim() || 'Blocking semantic inconsistency.',
    suggestedAction: issue.suggestedAction || (String(issue.sectionKey || '').trim().startsWith('feature:') ? 'enrich' : 'rewrite'),
    ...(issue.targetFields?.length ? { targetFields: Array.from(new Set(issue.targetFields)) } : {}),
    ...(issue.suggestedFix ? { suggestedFix: issue.suggestedFix } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Feature-by-feature repair helpers
// ---------------------------------------------------------------------------

function extractFeatureKey(sectionKey: string): string | null {
  const match = sectionKey.match(/^feature:(F-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function groupIssuesByTarget(issues: SemanticBlockingIssue[]): Map<string, SemanticBlockingIssue[]> {
  const groups = new Map<string, SemanticBlockingIssue[]>();
  for (const issue of issues) {
    const key = issue.sectionKey || 'unknown';
    const existing = groups.get(key);
    if (existing) {
      existing.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }
  return groups;
}

const ISSUE_SEVERITY_RANK: Record<string, number> = {
  business_rule_contradiction: 0,
  cross_section_inconsistency: 1,
  feature_section_semantic_mismatch: 2,
  schema_field_mismatch: 3,
  scope_meta_leakage: 4,
};

function getHighestSeverityRank(issues: SemanticBlockingIssue[]): number {
  let best = 99;
  for (const issue of issues) {
    const rank = ISSUE_SEVERITY_RANK[issue.code] ?? 5;
    if (rank < best) best = rank;
  }
  return best;
}

function sortTargetKeysBySeverity(grouped: Map<string, SemanticBlockingIssue[]>): string[] {
  return Array.from(grouped.keys()).sort((a, b) => {
    const rankA = getHighestSeverityRank(grouped.get(a) || []);
    const rankB = getHighestSeverityRank(grouped.get(b) || []);
    if (rankA !== rankB) return rankA - rankB;
    // Section-level issues before feature-level issues
    const aIsFeature = a.startsWith('feature:') ? 1 : 0;
    const bIsFeature = b.startsWith('feature:') ? 1 : 0;
    return aIsFeature - bIsFeature;
  });
}

function blockingIssuePairSignature(issues: SemanticBlockingIssue[] | undefined): string[] {
  return Array.from(new Set(
    cloneSemanticBlockingIssues(issues)
      .map(issue => `${issue.sectionKey}::${issue.code}`)
      .filter(Boolean)
  )).sort();
}

function determineRepairGapReason(params: {
  beforeRepair: SemanticBlockingIssue[];
  afterRepair: SemanticBlockingIssue[];
  changed: boolean;
  substantiveChanged?: boolean;
  exhaustedBudget?: boolean;
}): RepairGapReason {
  if (!params.changed) {
    return 'repair_no_structural_change';
  }

  if (params.substantiveChanged === false) {
    return 'repair_no_substantive_change';
  }

  const beforePairs = blockingIssuePairSignature(params.beforeRepair);
  const afterPairs = blockingIssuePairSignature(params.afterRepair);
  if (
    beforePairs.length === afterPairs.length
    && beforePairs.every((pair, index) => pair === afterPairs[index])
  ) {
    return 'same_issues_persisted';
  }

  const hasEmergentIssue = afterPairs.some(pair => !beforePairs.includes(pair));
  if (hasEmergentIssue) {
    return 'emergent_issue_after_repair';
  }

  if (params.exhaustedBudget) {
    return 'repair_budget_exhausted';
  }

  return 'same_issues_persisted';
}

const ENRICHMENT_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'uiImpact', 'dataImpact', 'trigger', 'alternateFlows', 'preconditions', 'postconditions',
]);

// ÄNDERUNG 13.03.2026: Soft-blocking Issues (Enrichment-Gaps, Section-Level-Widersprueche)
// werden am Final Gate als degraded akzeptiert statt zu blockieren.
// ÄNDERUNG 14.03.2026: Auch cross_section_inconsistency auf Features mit
// Enrichment-Only-Feldern (z.B. dataImpact) ist unreparierbar — nicht nur
// feature_section_semantic_mismatch. Beide betreffen optionale Detailfelder.
function isEnrichmentOnlyIssue(issue: SemanticBlockingIssue): boolean {
  if (issue.code !== 'feature_section_semantic_mismatch'
      && issue.code !== 'cross_section_inconsistency') return false;
  if (!issue.sectionKey?.startsWith('feature:')) return false;
  if (!issue.targetFields?.length) return false;
  return issue.targetFields.every(field => ENRICHMENT_ONLY_FIELDS.has(field));
}

function isSectionLevelContradiction(issue: SemanticBlockingIssue): boolean {
  // globalBusinessRules-Widersprueche sind oft im User-Prompt verankert
  // und vom Repair-Loop nicht aufloesbar — egal ob als business_rule_contradiction
  // oder cross_section_inconsistency gemeldet. Andere Sections (z.B. timelineMilestones)
  // mit business_rule_contradiction sind potenziell reparierbar.
  if (issue.sectionKey !== 'globalBusinessRules') return false;
  return issue.code === 'business_rule_contradiction'
    || issue.code === 'cross_section_inconsistency';
}

function isNonFeatureSchemaMismatch(issue: SemanticBlockingIssue): boolean {
  // schema_field_mismatch auf nicht-Feature-Sections (z.B. domainModel) sind
  // Definitions-Nitpicks die der Repair-Loop nicht aufloesen kann.
  return issue.code === 'schema_field_mismatch'
    && !issue.sectionKey?.startsWith('feature:');
}

// Issues die definitiv unreparierbar sind — Repair-Loop ueberspringt sie komplett
function isUnrepairableIssue(issue: SemanticBlockingIssue): boolean {
  return isEnrichmentOnlyIssue(issue)
    || isSectionLevelContradiction(issue);
}

// ÄNDERUNG 14.03.2026: Timeline cross_section_inconsistency nach deterministischem
// Rewrite ist unreparierbar — der LLM-Repair bekommt mainFlow als Target fuer ein
// Timeline-Problem, was nachweislich zu repair_no_structural_change fuehrt.
function isTimelineConsistencyIssue(issue: SemanticBlockingIssue): boolean {
  return issue.code === 'cross_section_inconsistency'
    && issue.sectionKey === 'timelineMilestones';
}

// Soft-blocking am Final Gate: unreparierbar + schema-Nitpicks auf nicht-Feature-Sections
// + Timeline-Konsistenz-Issues (deterministischer Rewrite hat bereits korrigiert)
function isSoftBlockingIssue(issue: SemanticBlockingIssue): boolean {
  return isUnrepairableIssue(issue)
    || isNonFeatureSchemaMismatch(issue)
    || isTimelineConsistencyIssue(issue);
}

function partitionBlockingIssues(issues: SemanticBlockingIssue[]): {
  hardBlocking: SemanticBlockingIssue[];
  softBlocking: SemanticBlockingIssue[];
} {
  const hard: SemanticBlockingIssue[] = [];
  const soft: SemanticBlockingIssue[] = [];
  for (const issue of issues) {
    if (isSoftBlockingIssue(issue)) {
      soft.push(issue);
    } else {
      hard.push(issue);
    }
  }
  return { hardBlocking: hard, softBlocking: soft };
}

function hasSubstantiveCandidateImprovement(
  before: EvaluatedCandidate,
  after: EvaluatedCandidate
): boolean {
  if (after.featureQualityDiagnostics.featureQualityFloorPassed && !before.featureQualityDiagnostics.featureQualityFloorPassed) {
    return true;
  }
  if (after.featureSubstanceScore > before.featureSubstanceScore) {
    return true;
  }
  if (qualityScore(after.compiled.quality) > qualityScore(before.compiled.quality)) {
    return true;
  }
  if ((after.compiled.quality.timelineMismatchedFeatureIds?.length || 0) < (before.compiled.quality.timelineMismatchedFeatureIds?.length || 0)) {
    return true;
  }
  if (after.compiled.quality.issues.length < before.compiled.quality.issues.length) {
    return true;
  }
  return false;
}

function wrapProviderRuntimeError(params: {
  error: unknown;
  failureStage: FinalizerFailureStage;
  providerFailureStage: ProviderFailureStage;
  compiled: { content: string; structure: PRDStructure };
  repairAttempts: CompilerModelResult[];
  reviewerAttempts: ReviewerRefineResult[];
  compilerRepairTruncationCount: number;
  compilerRepairFinishReasons: string[];
  degradedCandidateSource?: DegradedCandidateSource;
}): PrdCompilerRuntimeError | null {
  const message = params.error instanceof Error ? params.error.message : String(params.error || '');
  const providerDiagnostics = parseProviderFailureDiagnostics(message);
  if (!providerDiagnostics) return null;

  return new PrdCompilerRuntimeError({
    message,
    failureStage: params.failureStage,
    providerFailureStage: params.providerFailureStage,
    runtimeFailureCode: providerDiagnostics.runtimeFailureCode,
    providerFailureSummary: providerDiagnostics.providerFailureSummary,
    providerFailureCounts: providerDiagnostics.providerFailureCounts,
    providerFailedModels: providerDiagnostics.providerFailedModels,
    compiledResult: params.compiled,
    repairAttempts: params.repairAttempts,
    reviewerAttempts: params.reviewerAttempts,
    compilerRepairTruncationCount: params.compilerRepairTruncationCount,
    compilerRepairFinishReasons: params.compilerRepairFinishReasons,
    degradedCandidateAvailable: !!params.compiled.content,
    degradedCandidateSource: params.degradedCandidateSource,
  });
}

function withSyntheticQualityIssue(
  quality: PrdQualityReport,
  issue: { code: string; message: string; severity: 'error' | 'warning' }
): PrdQualityReport {
  return {
    ...quality,
    valid: issue.severity === 'error' ? false : quality.valid,
    issues: [...quality.issues, issue],
  };
}

export async function finalizeWithCompilerGates(
  options: FinalizeWithCompilerGatesOptions
): Promise<FinalizeWithCompilerGatesResult> {
  const {
    initialResult,
    mode,
    existingContent,
    language,
    templateCategory,
    originalRequest,
    repairReviewer,
    maxRepairPasses = 4,
    compileDocument = compilePrdDocument,
  } = options;

  let current = initialResult;
  const compileCurrent = (content: string) =>
    compileDocument(content, {
      mode,
      existingContent,
      language,
      templateCategory,
      strictCanonical: true,
      strictLanguageConsistency: true,
      enableFeatureAggregation: true,
      contextHint: originalRequest,
    });
  const runCancelCheck = (stage: string) => {
    options.cancelCheck?.(stage);
  };

  runCancelCheck('compiler_finalization');
  const evaluateCandidate = (
    content: string,
    compiledCandidate = compileCurrent(content)
  ): EvaluatedCandidate => {
    const featureDiagnostics = buildFeatureQualityDiagnostics(compiledCandidate.structure, compiledCandidate.quality);
    const qualityWithFloor = withFeatureQualityFloorIssue(compiledCandidate.quality, featureDiagnostics);
    return {
      content,
      compiled: {
        ...compiledCandidate,
        quality: qualityWithFloor,
      },
      featureQualityDiagnostics: featureDiagnostics,
      featureSubstanceScore: calculateFeatureSubstanceScore(compiledCandidate.structure, featureDiagnostics),
    };
  };

  let currentEvaluation = evaluateCandidate(current.content);
  let compiled = currentEvaluation.compiled;
  let featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
  let canonicalFeatureIds = compiled.quality.canonicalFeatureIds || [];
  let timelineMismatchedFeatureIds = compiled.quality.timelineMismatchedFeatureIds || [];
  let timelineRewrittenFromFeatureMap = false;
  let timelineRewriteAppliedLines = 0;
  const normalizedOutOfScope = normalizeOutOfScopeStrictExclusions(
    String(compiled.structure.outOfScope || ''),
    language || 'en'
  );
  if (normalizedOutOfScope.changed && normalizedOutOfScope.content) {
    const normalizedStructure: PRDStructure = {
      ...compiled.structure,
      outOfScope: normalizedOutOfScope.content,
    };
    const normalizedContent = assembleStructureToMarkdown(normalizedStructure);
    const normalizedEvaluation = evaluateCandidate(normalizedContent);
    if (compareCandidatePreference(normalizedEvaluation, currentEvaluation) >= 0) {
      current = {
        ...current,
        content: normalizedContent,
      };
      currentEvaluation = normalizedEvaluation;
      compiled = currentEvaluation.compiled;
      featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
      canonicalFeatureIds = compiled.quality.canonicalFeatureIds || canonicalFeatureIds;
      timelineMismatchedFeatureIds = compiled.quality.timelineMismatchedFeatureIds || [];
    }
  }
  let needsRepair = shouldRepair(current, compiled.quality, mode);
  const repairAttempts: CompilerModelResult[] = [];
  const reviewerAttempts: ReviewerRefineResult[] = [];
  const semanticVerificationHistory: SemanticVerificationResult[] = [];
  let compilerRepairTruncationCount = 0;
  const compilerRepairFinishReasons: string[] = [];
  let repairRejected = false;
  let repairRejectedReason: string | undefined;
  let repairDegradationSignals: string[] = [];
  let degradedCandidateSource: DegradedCandidateSource = 'pre_repair_best';
  let semanticRepairChangedSections: string[] = [];
  let semanticRepairStructuralChange = false;
  let semanticVerification: SemanticVerificationResult | undefined;
  let semanticRepairApplied = false;
  let semanticRepairAttempted = false;
  let semanticRepairIssueCodes: string[] = [];
  let semanticRepairSectionKeys: string[] = [];
  let semanticRepairTruncated = false;
  let initialSemanticBlockingIssues: SemanticBlockingIssue[] = [];
  let postRepairSemanticBlockingIssues: SemanticBlockingIssue[] = [];
  let finalSemanticBlockingIssues: SemanticBlockingIssue[] = [];
  let repairGapReason: RepairGapReason | undefined;
  let repairCycleCount = 0;

  // Track best result across repair passes to prevent quality degradation
  let bestCurrent = current;
  let bestCompiled = compiled;
  let bestScore = qualityScore(compiled.quality);
  let bestSubstantiveCurrent = current;
  let bestSubstantiveCompiled = compiled;
  let bestSubstantiveFeatureQualityDiagnostics = featureQualityDiagnostics;
  let bestSubstantiveCandidateSource: DegradedCandidateSource = degradedCandidateSource;
  let bestSubstantiveEvaluation = currentEvaluation;
  let degradationCount = 0;

  const maybePromoteBestSubstantive = (
    candidateCurrent: CompilerModelResult,
    candidateEvaluation: EvaluatedCandidate,
    candidateSource: DegradedCandidateSource
  ) => {
    if (compareCandidatePreference(candidateEvaluation, bestSubstantiveEvaluation) > 0) {
      bestSubstantiveCurrent = candidateCurrent;
      bestSubstantiveCompiled = candidateEvaluation.compiled;
      bestSubstantiveFeatureQualityDiagnostics = candidateEvaluation.featureQualityDiagnostics;
      bestSubstantiveCandidateSource = candidateSource;
      bestSubstantiveEvaluation = candidateEvaluation;
    }
  };

  const compileWithFeatureQualityRecovery = (
    content: string,
    baselineStructure: PRDStructure
  ) => {
    let nextContent = content;
    const rawCompiled = compileCurrent(content);
    // Existing: Feld-Qualitaet bestehender Features wiederherstellen
    const recovery = restoreFeatureQualityFromBest({
      bestStructure: baselineStructure,
      candidateStructure: rawCompiled.structure,
    });
    let workingStructure = recovery.changed ? recovery.structure : rawCompiled.structure;

    // ÄNDERUNG 13.03.2026: Komplett fehlende Features aus der Baseline wiederherstellen.
    // restoreFeatureQualityFromBest() iteriert nur ueber existierende Candidate-Features,
    // stellt aber komplett verlorene Features nicht wieder her. Hier greifen wir auf
    // compareStructures/restoreRemovedFeatures zurueck (gleiche Logik wie runPostCompilerPreservation).
    const diff = compareStructures(baselineStructure, workingStructure);
    let restoredMissingFeatureCount = 0;
    if (diff.removedFeatures.length > 0) {
      workingStructure = restoreRemovedFeatures(baselineStructure, workingStructure, diff.removedFeatures);
      restoredMissingFeatureCount = diff.removedFeatures.length;
    }

    const structureChanged = recovery.changed || restoredMissingFeatureCount > 0;
    if (structureChanged) {
      nextContent = assembleStructureToMarkdown(workingStructure);
    }
    const nextCompiled = structureChanged ? compileCurrent(nextContent) : rawCompiled;
    const evaluated = evaluateCandidate(nextContent, nextCompiled);
    return {
      content: nextContent,
      rawCompiled,  // unveraendert fuer Degradation-Signal-Vergleich
      compiled: evaluated.compiled,
      featureQualityDiagnostics: evaluated.featureQualityDiagnostics,
      featureSubstanceScore: evaluated.featureSubstanceScore,
      recovery,
      restoredMissingFeatureCount,
    };
  };

  const alignDisplayedCandidate = (
    candidateCurrent: CompilerModelResult,
    candidateSource: DisplayedCandidateSource
  ) => {
    const evaluation = evaluateCandidate(candidateCurrent.content);
    return {
      current: {
        ...candidateCurrent,
        content: evaluation.content,
      },
      evaluation,
      displayedCandidateSource: candidateSource,
      diagnosticsAlignedWithDisplayedCandidate: true,
    };
  };

  if (needsRepair && shouldShortCircuitStructuralFormatMismatch(compiled.quality)) {
    const displayedFailure = alignDisplayedCandidate(bestSubstantiveCurrent, bestSubstantiveCandidateSource);
    throw new PrdCompilerQualityError(
      'PRD compiler quality gate failed: feature catalogue exists in raw markdown but could not be parsed after deterministic canonical normalization.',
      displayedFailure.evaluation.compiled.quality,
      repairAttempts,
      {
        content: displayedFailure.evaluation.compiled.content,
        structure: displayedFailure.evaluation.compiled.structure,
      },
      {
        reviewerAttempts,
        failureStage: 'compiler_repair',
        primaryCapabilityAnchors: displayedFailure.evaluation.compiled.quality.primaryCapabilityAnchors,
        featurePriorityWindow: displayedFailure.evaluation.compiled.quality.featurePriorityWindow,
        coreFeatureIds: displayedFailure.evaluation.compiled.quality.coreFeatureIds,
        supportFeatureIds: displayedFailure.evaluation.compiled.quality.supportFeatureIds,
        canonicalFeatureIds: displayedFailure.evaluation.compiled.quality.canonicalFeatureIds || canonicalFeatureIds,
        timelineMismatchedFeatureIds: displayedFailure.evaluation.compiled.quality.timelineMismatchedFeatureIds || timelineMismatchedFeatureIds,
        timelineRewrittenFromFeatureMap,
        timelineRewriteAppliedLines,
        compilerRepairTruncationCount,
        compilerRepairFinishReasons,
        repairRejected,
        repairRejectedReason,
        repairDegradationSignals,
        degradedCandidateAvailable: !!displayedFailure.evaluation.compiled.content,
        degradedCandidateSource: bestSubstantiveCandidateSource,
        displayedCandidateSource: displayedFailure.displayedCandidateSource,
        diagnosticsAlignedWithDisplayedCandidate: displayedFailure.diagnosticsAlignedWithDisplayedCandidate,
        semanticRepairChangedSections,
        semanticRepairStructuralChange,
        ...displayedFailure.evaluation.featureQualityDiagnostics,
      }
    );
  }

  let lastDeterministicRepairSignature = '';
  for (let deterministicPass = 1; deterministicPass <= 2 && needsRepair && !isBroadStructuralRepairCase(compiled.quality); deterministicPass++) {
    const deterministicRepairReviewer: ReviewerContentGenerator = async (prompt: string) => {
      let result: CompilerModelResult;
      try {
        result = await repairReviewer(prompt, deterministicPass);
      } catch (error) {
        const runtimeError = wrapProviderRuntimeError({
          error,
          failureStage: 'compiler_repair',
          providerFailureStage: 'compiler_repair',
          compiled: { content: compiled.content, structure: compiled.structure },
          repairAttempts,
          reviewerAttempts,
          compilerRepairTruncationCount,
          compilerRepairFinishReasons,
          degradedCandidateSource,
        });
        if (runtimeError) throw runtimeError;
        throw error;
      }
      return {
        content: result.content,
        model: result.model,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    };
    runCancelCheck(`compiler_repair_deterministic_pass_${deterministicPass}`);
    const deterministicRepairIssues = toDeterministicContentIssues(
      compiled.quality,
      compiled.structure,
      featureQualityDiagnostics
    );
    if (deterministicRepairIssues.length === 0) {
      break;
    }

    const repairSignature = deterministicIssueSignature(deterministicRepairIssues);
    if (repairSignature === lastDeterministicRepairSignature) {
      break;
    }
    lastDeterministicRepairSignature = repairSignature;

    runCancelCheck(`compiler_repair_deterministic_apply_${deterministicPass}`);
    const deterministicRepair = await applySemanticPatchRefinement({
      content: compiled.content,
      structure: compiled.structure,
      issues: deterministicRepairIssues,
      language: language || 'en',
      templateCategory,
      originalRequest,
      reviewer: deterministicRepairReviewer,
    });
    reviewerAttempts.push(...(deterministicRepair.reviewerAttempts || []));
    if (!deterministicRepair.refined) {
      break;
    }

    const deterministicRecovered = compileWithFeatureQualityRecovery(
      deterministicRepair.content,
      bestCompiled.structure
    );
    const deterministicEvaluation: EvaluatedCandidate = {
      content: deterministicRecovered.content,
      compiled: deterministicRecovered.compiled,
      featureQualityDiagnostics: deterministicRecovered.featureQualityDiagnostics,
      featureSubstanceScore: deterministicRecovered.featureSubstanceScore,
    };
    if (compareCandidatePreference(deterministicEvaluation, currentEvaluation) >= 0) {
      current = {
        ...current,
        content: deterministicRecovered.content,
      };
      currentEvaluation = deterministicEvaluation;
      compiled = currentEvaluation.compiled;
      bestCurrent = current;
      bestCompiled = compiled;
      bestScore = qualityScore(compiled.quality);
      degradedCandidateSource = 'post_targeted_repair';
      featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
      canonicalFeatureIds = compiled.quality.canonicalFeatureIds || canonicalFeatureIds;
      timelineMismatchedFeatureIds = compiled.quality.timelineMismatchedFeatureIds || [];
      maybePromoteBestSubstantive(current, currentEvaluation, degradedCandidateSource);
    }
    needsRepair = shouldRepair(current, compiled.quality, mode);
  }

  const repairHistory: RepairHistoryEntry[] = [];

  for (let pass = 1; pass <= maxRepairPasses && needsRepair; pass++) {
    runCancelCheck(`compiler_repair_pass_${pass}`);
    const issueSummary = bestCompiled.quality.issues.map(i => `- ${i.message}`).join('\n') || '- Unknown quality issue';
    const repairPrompt = buildRepairPrompt({
      mode,
      issueSummary,
      existingContent,
      currentContent: bestCurrent.content,
      currentStructure: bestCompiled.structure,
      originalRequest,
      templateCategory,
      language,
      repairHistory,
    });

    let repairResult: CompilerModelResult;
    try {
      repairResult = await repairReviewer(repairPrompt, pass);
    } catch (error) {
      const runtimeError = wrapProviderRuntimeError({
        error,
        failureStage: 'compiler_repair',
        providerFailureStage: 'compiler_repair',
        compiled: { content: compiled.content, structure: compiled.structure },
        repairAttempts,
        reviewerAttempts,
        compilerRepairTruncationCount,
        compilerRepairFinishReasons,
        degradedCandidateSource,
      });
      if (runtimeError) throw runtimeError;
      throw error;
    }
    repairAttempts.push(repairResult);
    if (repairResult.finishReason) {
      compilerRepairFinishReasons.push(repairResult.finishReason);
      if (repairResult.finishReason === 'length') {
        compilerRepairTruncationCount++;
        // ÄNDERUNG 13.03.2026: Truncated Responses ueberspringen statt als
        // Degradation zu zaehlen. Truncation ist ein Infrastruktur-Problem,
        // kein Model-Problem — soll degradationCount nicht erhoehen.
        console.warn(`[RepairLoop] Pass ${pass}: truncated response (finish_reason=length), skipping compilation`);
        repairHistory.push({
          pass,
          score: bestScore,
          issueCount: bestCompiled.quality.issues.length,
          topIssues: ['truncated_response'],
        });
        if (compilerRepairTruncationCount >= 2) break;
        continue;
      }
    }
    const recoveredRepair = compileWithFeatureQualityRecovery(
      repairResult.content,
      bestCompiled.structure
    );
    const repairResultContent = recoveredRepair.content;
    const repairCompiled = recoveredRepair.compiled;
    const repairScore = qualityScore(repairCompiled.quality);
    const degradationSignals = collectRepairDegradationSignals(bestCompiled.structure, recoveredRepair.rawCompiled.structure);
    const rejectedFeatureQualityDiagnostics = buildFeatureQualityDiagnostics(
      recoveredRepair.rawCompiled.structure,
      recoveredRepair.rawCompiled.quality
    );
    const repairedFeatureQualityDiagnostics: FeatureQualityDiagnostics = {
      collapsedFeatureNameIds: Array.from(new Set([
        ...rejectedFeatureQualityDiagnostics.collapsedFeatureNameIds,
        ...recoveredRepair.recovery.restoredNameFeatureIds,
      ])).sort(),
      placeholderFeatureIds: Array.from(new Set([
        ...rejectedFeatureQualityDiagnostics.placeholderFeatureIds,
        ...recoveredRepair.recovery.restoredPlaceholderFeatureIds,
      ])).sort(),
      acceptanceBoilerplateFeatureIds: Array.from(new Set([
        ...rejectedFeatureQualityDiagnostics.acceptanceBoilerplateFeatureIds,
        ...recoveredRepair.recovery.restoredAcceptanceFeatureIds,
      ])).sort(),
      featureQualityFloorFeatureIds: Array.from(new Set([
        ...rejectedFeatureQualityDiagnostics.featureQualityFloorFeatureIds,
        ...recoveredRepair.recovery.restoredNameFeatureIds,
        ...recoveredRepair.recovery.restoredPlaceholderFeatureIds,
        ...recoveredRepair.recovery.restoredAcceptanceFeatureIds,
      ])).sort(),
      featureQualityFloorFailedFeatureIds: Array.from(new Set([
        ...rejectedFeatureQualityDiagnostics.featureQualityFloorFailedFeatureIds,
        ...recoveredRepair.recovery.restoredNameFeatureIds,
        ...recoveredRepair.recovery.restoredPlaceholderFeatureIds,
        ...recoveredRepair.recovery.restoredAcceptanceFeatureIds,
      ])).sort(),
      featureQualityFloorPassed: false,
      primaryFeatureQualityReason:
        rejectedFeatureQualityDiagnostics.primaryFeatureQualityReason
        || 'The latest compiler repair degraded feature substance and was rejected before it could replace the best candidate.',
      emptyMainFlowFeatureIds: rejectedFeatureQualityDiagnostics.emptyMainFlowFeatureIds,
      placeholderPurposeFeatureIds: rejectedFeatureQualityDiagnostics.placeholderPurposeFeatureIds,
      placeholderAlternateFlowFeatureIds: rejectedFeatureQualityDiagnostics.placeholderAlternateFlowFeatureIds,
      thinAcceptanceCriteriaFeatureIds: rejectedFeatureQualityDiagnostics.thinAcceptanceCriteriaFeatureIds,
    };
    const rejectedRepair = degradationSignals.length > 0;
    if (rejectedRepair) {
      repairRejected = true;
      repairDegradationSignals = degradationSignals;
      repairRejectedReason = buildRepairRejectedReason(degradationSignals);
      featureQualityDiagnostics = repairedFeatureQualityDiagnostics;
    }

    repairHistory.push({
      pass,
      score: repairScore,
      issueCount: repairCompiled.quality.issues.length,
      topIssues: repairCompiled.quality.issues.slice(0, 3).map(i => i.code),
    });

    const repairedDiagnostics = buildFeatureQualityDiagnostics(repairCompiled.structure, repairCompiled.quality);
    const repairedEvaluation: EvaluatedCandidate = {
      content: repairResultContent,
      compiled: repairCompiled,
      featureQualityDiagnostics: repairedDiagnostics,
      featureSubstanceScore: calculateFeatureSubstanceScore(repairCompiled.structure, repairedDiagnostics),
    };

    if (!rejectedRepair && compareCandidatePreference(repairedEvaluation, currentEvaluation) > 0) {
      bestCurrent = {
        ...repairResult,
        content: repairedEvaluation.content,
      };
      currentEvaluation = repairedEvaluation;
      bestCompiled = currentEvaluation.compiled;
      bestScore = repairScore;
      degradationCount = 0;
      featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
      canonicalFeatureIds = bestCompiled.quality.canonicalFeatureIds || canonicalFeatureIds;
      timelineMismatchedFeatureIds = bestCompiled.quality.timelineMismatchedFeatureIds || [];
      maybePromoteBestSubstantive(bestCurrent, currentEvaluation, degradedCandidateSource);
    } else {
      degradationCount++;
      if (degradationCount >= 2) break; // repairs are not helping, abort early
    }

    current = bestCurrent;
    compiled = bestCompiled;
    needsRepair = shouldRepair(current, compiled.quality, mode);
    if (needsRepair && compilerRepairTruncationCount >= 2) {
      break;
    }
  }

  if (needsRepair) {
    const displayedFailure = alignDisplayedCandidate(bestSubstantiveCurrent, bestSubstantiveCandidateSource);
    const errorIssues = displayedFailure.evaluation.compiled.quality.issues.filter(i => i.severity === 'error');
    const details = errorIssues.map(i => i.message).join(' | ') || 'Unknown quality issue.';
    throw new PrdCompilerQualityError(
      `PRD compiler quality gate failed after ${repairAttempts.length} repair attempt(s): ${details}`,
      displayedFailure.evaluation.compiled.quality,
      repairAttempts,
      {
        content: displayedFailure.evaluation.compiled.content,
        structure: displayedFailure.evaluation.compiled.structure,
      },
      {
        reviewerAttempts,
        failureStage: 'compiler_repair',
        primaryCapabilityAnchors: displayedFailure.evaluation.compiled.quality.primaryCapabilityAnchors,
        featurePriorityWindow: displayedFailure.evaluation.compiled.quality.featurePriorityWindow,
        coreFeatureIds: displayedFailure.evaluation.compiled.quality.coreFeatureIds,
        supportFeatureIds: displayedFailure.evaluation.compiled.quality.supportFeatureIds,
        canonicalFeatureIds: displayedFailure.evaluation.compiled.quality.canonicalFeatureIds || canonicalFeatureIds,
        timelineMismatchedFeatureIds: displayedFailure.evaluation.compiled.quality.timelineMismatchedFeatureIds || timelineMismatchedFeatureIds,
        timelineRewrittenFromFeatureMap,
        timelineRewriteAppliedLines,
        compilerRepairTruncationCount,
        compilerRepairFinishReasons,
        repairRejected,
        repairRejectedReason,
        repairDegradationSignals,
        degradedCandidateAvailable: !!displayedFailure.evaluation.compiled.content,
        degradedCandidateSource: bestSubstantiveCandidateSource,
        displayedCandidateSource: displayedFailure.displayedCandidateSource,
        diagnosticsAlignedWithDisplayedCandidate: displayedFailure.diagnosticsAlignedWithDisplayedCandidate,
        semanticRepairChangedSections,
        semanticRepairStructuralChange,
        ...displayedFailure.evaluation.featureQualityDiagnostics,
      }
    );
  }

  // --- Content Review & Refine (post-compiler pass) ---
  const enableContentReview = options.enableContentReview !== false;
  let contentReview: ContentReviewResult | undefined;
  let contentRefined = false;

  if (enableContentReview) {
    runCancelCheck('content_review');
    options.onStageProgress?.({ type: 'content_review_start' });
    let refineResult: {
      content: string;
      structure: PRDStructure;
      reviewResult: ContentReviewResult;
      refined: boolean;
      reviewerAttempts?: ReviewerRefineResult[];
    };
    try {
      refineResult = await reviewAndRefineContent({
        content: compiled.content,
        structure: compiled.structure,
        language: language || 'en',
        templateCategory,
        fallbackSections: compiled.quality.fallbackSections,
        reviewer: options.contentRefineReviewer,
      });
    } catch (error) {
      const runtimeError = wrapProviderRuntimeError({
        error,
        failureStage: 'content_review',
        providerFailureStage: 'content_review',
        compiled: { content: compiled.content, structure: compiled.structure },
        repairAttempts,
        reviewerAttempts,
        compilerRepairTruncationCount,
        compilerRepairFinishReasons,
        degradedCandidateSource,
      });
      if (runtimeError) throw runtimeError;
      throw error;
    }

    contentReview = refineResult.reviewResult;
    contentRefined = refineResult.refined;
    reviewerAttempts.push(...(refineResult.reviewerAttempts || []));

    if (refineResult.refined) {
      // Re-compile the refined content to ensure structural integrity
      const recompiledEvaluation = evaluateCandidate(refineResult.content);
      if (
        recompiledEvaluation.compiled.quality.valid
        || compareCandidatePreference(recompiledEvaluation, currentEvaluation) >= 0
      ) {
        current = {
          ...current,
          content: recompiledEvaluation.content,
        };
        currentEvaluation = recompiledEvaluation;
        compiled = currentEvaluation.compiled;
        bestScore = qualityScore(compiled.quality);
        featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
        canonicalFeatureIds = compiled.quality.canonicalFeatureIds || canonicalFeatureIds;
        timelineMismatchedFeatureIds = compiled.quality.timelineMismatchedFeatureIds || [];
        maybePromoteBestSubstantive(current, currentEvaluation, degradedCandidateSource);
      }
      // If recompile degraded quality, keep the pre-refinement version
    }
  }

  const shouldBlockExcessiveFallbackReview = Boolean(
    options.contentRefineReviewer
    && hasQualityIssue(compiled.quality, 'excessive_fallback_sections')
    && hasContentReviewError(contentReview, 'compiler_fallback_filler')
  );

  if (shouldBlockExcessiveFallbackReview) {
    const displayedFailure = alignDisplayedCandidate(bestSubstantiveCurrent, bestSubstantiveCandidateSource);
    // ÄNDERUNG 07.03.2026: Den kompilierten Fehlstand im Error mitführen, damit
    // degradierte Fallback-Pfade nicht den rohen Repair-Text statt des echten
    // Compiler-Ergebnisses zurückgeben.
    const blockedQuality = withSyntheticQualityIssue(displayedFailure.evaluation.compiled.quality, {
      code: 'content_review_blocked_excessive_fallback',
      message: 'Content review still detected compiler-generated fallback filler after refinement attempts.',
      severity: 'error',
    });
    throw new PrdCompilerQualityError(
      'PRD compiler quality gate failed after content review: compiler-generated fallback filler remains.',
      blockedQuality,
      repairAttempts,
      {
        content: displayedFailure.evaluation.compiled.content,
        structure: displayedFailure.evaluation.compiled.structure,
      },
      {
        reviewerAttempts,
        failureStage: 'content_review',
        primaryCapabilityAnchors: displayedFailure.evaluation.compiled.quality.primaryCapabilityAnchors,
        featurePriorityWindow: displayedFailure.evaluation.compiled.quality.featurePriorityWindow,
        coreFeatureIds: displayedFailure.evaluation.compiled.quality.coreFeatureIds,
        supportFeatureIds: displayedFailure.evaluation.compiled.quality.supportFeatureIds,
        canonicalFeatureIds: displayedFailure.evaluation.compiled.quality.canonicalFeatureIds || canonicalFeatureIds,
        timelineMismatchedFeatureIds: displayedFailure.evaluation.compiled.quality.timelineMismatchedFeatureIds || timelineMismatchedFeatureIds,
        timelineRewrittenFromFeatureMap,
        timelineRewriteAppliedLines,
        compilerRepairTruncationCount,
        compilerRepairFinishReasons,
        repairRejected,
        repairRejectedReason,
        repairDegradationSignals,
        degradedCandidateAvailable: !!displayedFailure.evaluation.compiled.content,
        degradedCandidateSource: bestSubstantiveCandidateSource,
        displayedCandidateSource: displayedFailure.displayedCandidateSource,
        diagnosticsAlignedWithDisplayedCandidate: displayedFailure.diagnosticsAlignedWithDisplayedCandidate,
        semanticRepairChangedSections,
        semanticRepairStructuralChange,
        ...displayedFailure.evaluation.featureQualityDiagnostics,
      }
    );
  }

  const timelineConsistencyBeforeVerifier = collectTimelineConsistencyDiagnostics(compiled.structure);
  canonicalFeatureIds = timelineConsistencyBeforeVerifier.canonicalFeatureIds.length > 0
    ? timelineConsistencyBeforeVerifier.canonicalFeatureIds
    : (compiled.quality.canonicalFeatureIds || canonicalFeatureIds);
  timelineMismatchedFeatureIds = timelineConsistencyBeforeVerifier.timelineMismatchedFeatureIds;
  // ÄNDERUNG 14.03.2026: Quality-Floor-Gate entfernt — rewriteTimelineMilestonesFromFeatureMap
  // modifiziert nur timelineMilestones, nie Features. compareCandidatePreference schuetzt vor Regression.
  if (timelineMismatchedFeatureIds.length > 0) {
    const timelineRewrite = rewriteTimelineMilestonesFromFeatureMap(compiled.structure, language || 'en');
    if (timelineRewrite.changed && timelineRewrite.content) {
      const rewrittenStructure: PRDStructure = {
        ...compiled.structure,
        timelineMilestones: timelineRewrite.content,
      };
      const rewrittenContent = assembleStructureToMarkdown(rewrittenStructure);
      const rewrittenEvaluation = evaluateCandidate(rewrittenContent);
      if (compareCandidatePreference(rewrittenEvaluation, currentEvaluation) >= 0) {
        current = {
          ...current,
          content: rewrittenContent,
        };
        currentEvaluation = rewrittenEvaluation;
        compiled = currentEvaluation.compiled;
        bestCurrent = current;
        bestCompiled = compiled;
        bestScore = qualityScore(compiled.quality);
        timelineRewrittenFromFeatureMap = true;
        timelineRewriteAppliedLines = timelineRewrite.appliedLines;
        featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
        canonicalFeatureIds = compiled.quality.canonicalFeatureIds || canonicalFeatureIds;
        timelineMismatchedFeatureIds = compiled.quality.timelineMismatchedFeatureIds || [];
        maybePromoteBestSubstantive(current, currentEvaluation, degradedCandidateSource);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Auto-Repair Pass: fix deterministic quality warnings before semantic verification
  // -------------------------------------------------------------------------
  const QUALITY_REPAIR_CODES = new Set([
    'feature_duplicate_flow',
    'acceptance_criteria_boilerplate',
    'deployment_stack_mismatch',
    'nfr_architecture_mismatch',
    'feature_field_truncated',
    'acceptance_criteria_non_measurable',
    'request_fulfillment_gap',
    'feature_core_semantic_gap',
  ]);
  const qualityRepairReviewer = options.semanticRefineReviewer || options.contentRefineReviewer;
  if (options.enableQualityAutoRepair && qualityRepairReviewer && compiled.quality?.issues?.length) {
    const qualityWarnings = compiled.quality.issues.filter(
      (issue) => issue.severity === 'warning' && issue.evidencePath && QUALITY_REPAIR_CODES.has(issue.code)
    );
    if (qualityWarnings.length > 0) {
      options.onStageProgress?.({ type: 'quality_repair_start', issueCount: qualityWarnings.length });
      let qualityRepairAppliedCount = 0;
      const qualityRepairIssueCodes: string[] = [];

      // ÄNDERUNG 15.03.2026: Spezialisierte Target-Fields pro Issue-Code,
      // damit der Repair-Prompt gezielt die relevanten Feature-Felder adressiert.
      const QUALITY_REPAIR_TARGET_FIELDS: Record<string, string[]> = {
        feature_core_semantic_gap: ['preconditions', 'postconditions', 'dataImpact'],
        acceptance_criteria_non_measurable: ['acceptanceCriteria'],
        acceptance_criteria_boilerplate: ['acceptanceCriteria'],
        feature_field_truncated: ['mainFlow', 'alternateFlows', 'acceptanceCriteria'],
      };

      for (const warning of qualityWarnings.slice(0, 5)) {
        runCancelCheck('quality_repair');
        const sectionKey = warning.evidencePath?.startsWith('feature:')
          ? warning.evidencePath
          : warning.evidencePath || 'systemVision';
        const isFeature = sectionKey.startsWith('feature:');
        const targetFields = isFeature
          ? QUALITY_REPAIR_TARGET_FIELDS[warning.code] as import('./prdFeatureSemantics').FeatureEnrichableField[] | undefined
          : undefined;
        const contentIssues: ContentIssue[] = [{
          code: warning.code,
          sectionKey,
          message: warning.message,
          severity: 'warning',
          suggestedAction: isFeature ? 'enrich' : 'rewrite',
          ...(targetFields ? { targetFields } : {}),
        }];

        try {
          const qualityPatch = await applySemanticPatchRefinement({
            content: compiled.content,
            structure: compiled.structure,
            issues: contentIssues,
            language: language || 'en',
            templateCategory,
            originalRequest,
            reviewer: qualityRepairReviewer,
          });

          if (qualityPatch.refined) {
            const patchEval = evaluateCandidate(qualityPatch.content);
            const strictAccepted = compareCandidatePreference(patchEval, currentEvaluation) >= 0;

            // ÄNDERUNG 15.03.2026: Gelockerte Akzeptanz fuer Warning-Repairs —
            // wenn die strikte Praeferenz-Pruefung fehlschlaegt, pruefen ob die
            // spezifische Warning behoben wurde und der Quality-Score maximal
            // 5 Punkte gesunken ist. Damit werden gezielte Fixes nicht abgelehnt
            // nur weil sie den Gesamtscore minimal beeinflussen.
            let warningFixAccepted = false;
            if (!strictAccepted && patchEval.compiled.quality) {
              const patchScore = qualityScore(patchEval.compiled.quality);
              const currentScore = qualityScore(compiled.quality);
              const scoreDrop = currentScore - patchScore;
              const warningStillPresent = patchEval.compiled.quality.issues?.some(
                (i) => i.code === warning.code && i.evidencePath === warning.evidencePath,
              );
              if (!warningStillPresent && scoreDrop <= 5) {
                warningFixAccepted = true;
              }
            }

            if (strictAccepted || warningFixAccepted) {
              current = { ...current, content: qualityPatch.content };
              currentEvaluation = patchEval;
              compiled = patchEval.compiled;
              bestCurrent = current;
              bestCompiled = compiled;
              bestScore = qualityScore(compiled.quality);
              qualityRepairAppliedCount++;
              qualityRepairIssueCodes.push(warning.code);
              reviewerAttempts.push(...qualityPatch.reviewerAttempts);
              maybePromoteBestSubstantive(current, currentEvaluation, degradedCandidateSource);
            }
          }
        } catch {
          // Quality repair is best-effort — skip on error
        }
      }

      options.onStageProgress?.({
        type: 'quality_repair_done',
        issueCount: qualityWarnings.length,
        applied: qualityRepairAppliedCount > 0,
      });
    }
  }

  if (options.semanticVerifier) {
    const runSemanticVerifier = async () => {
      runCancelCheck('semantic_verification');
      options.onStageProgress?.({ type: 'semantic_verification_start' });
      const avoidModelFamilies = buildAvoidedModelFamilies([
        initialResult.model,
        ...repairAttempts.map(attempt => attempt.model),
        ...reviewerAttempts.map(attempt => attempt.model),
      ]);
      let result: SemanticVerificationResult;
      try {
        result = await options.semanticVerifier!({
          content: compiled.content,
          structure: compiled.structure,
          mode,
          existingContent,
          language: language || 'en',
          templateCategory,
          originalRequest,
          avoidModelFamilies,
        });
      } catch (error) {
        const runtimeError = wrapProviderRuntimeError({
          error,
          failureStage: 'semantic_verifier',
          providerFailureStage: 'semantic_verification',
          compiled: { content: compiled.content, structure: compiled.structure },
          repairAttempts,
          reviewerAttempts,
          compilerRepairTruncationCount,
          compilerRepairFinishReasons,
          degradedCandidateSource,
        });
        if (runtimeError) throw runtimeError;
        throw error;
      }
      semanticVerification = result;
      semanticVerificationHistory.push(result);
      return result;
    };

    let verification = await runSemanticVerifier();
    finalSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
    const semanticRepairReviewer = options.semanticRefineReviewer || options.contentRefineReviewer;
    const affectedFeatureCount = new Set(
      verification.blockingIssues
        .map(i => i.sectionKey)
        .filter(s => s.startsWith('feature:'))
    ).size;
    const maxSemanticRepairCycles = semanticRepairReviewer
      ? Math.min(options.maxSemanticRepairCycles ?? Math.max(4, affectedFeatureCount * 2), 20)
      : 0;

    if (verification.verdict === 'fail' && verification.blockingIssues.length > 0) {
      initialSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
    }

    // Feature-by-feature semantic repair loop with locking and regression detection
    const frozenFeatureIds = new Set<string>();
    const manualReviewFeatureIds = new Set<string>();
    const perTargetAttempts = new Map<string, number>();

    while (
      verification.verdict === 'fail'
      && verification.blockingIssues.length > 0
      && repairCycleCount < maxSemanticRepairCycles
      && semanticRepairReviewer
    ) {
      runCancelCheck(`semantic_repair_cycle_${repairCycleCount + 1}`);

      // 1. Filter out frozen, manual-review, and soft-blocking targets
      const activeIssues = verification.blockingIssues.filter(issue => {
        const featureKey = extractFeatureKey(issue.sectionKey);
        if (featureKey && frozenFeatureIds.has(featureKey)) return false;
        if (featureKey && manualReviewFeatureIds.has(featureKey)) return false;
        if (!featureKey && manualReviewFeatureIds.has(issue.sectionKey)) return false;
        // ÄNDERUNG 13.03.2026: Unreparierbare Issues nicht reparieren — werden am Gate akzeptiert.
        // Hinweis: isNonFeatureSchemaMismatch wird hier NICHT gefiltert — Repair darf es versuchen.
        if (isUnrepairableIssue(issue)) return false;
        return true;
      });

      if (activeIssues.length === 0) break;

      // 2. Group by target, sort by severity, pick highest-priority target
      const grouped = groupIssuesByTarget(activeIssues);
      const sortedTargets = sortTargetKeysBySeverity(grouped);
      const targetKey = sortedTargets[0];
      const targetIssues = grouped.get(targetKey)!;

      // 3. Track per-target attempts
      const attempts = (perTargetAttempts.get(targetKey) ?? 0) + 1;
      perTargetAttempts.set(targetKey, attempts);

      // 4. Snapshot for potential revert
      const snapshotContent = compiled.content;
      const snapshotStructure = compiled.structure;
      const snapshotEvaluation = currentEvaluation;

      // 5. Diagnostics tracking
      const beforeRepairIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
      const beforeRepairEvaluation = currentEvaluation;
      const semanticIssues = toSemanticContentIssues(targetIssues);
      semanticRepairAttempted = true;
      repairCycleCount += 1;
      semanticRepairIssueCodes = Array.from(new Set([
        ...semanticRepairIssueCodes,
        ...semanticIssues.map(issue => issue.code).filter(Boolean),
      ]));
      semanticRepairSectionKeys = Array.from(new Set([
        ...semanticRepairSectionKeys,
        ...semanticIssues.map(issue => issue.sectionKey).filter(Boolean),
      ]));
      options.onStageProgress?.({
        type: 'semantic_repair_start',
        issueCount: targetIssues.length,
        sectionKeys: semanticIssues.map(issue => issue.sectionKey).filter(Boolean),
      });

      // 6. Call repair for ONLY this target's issues
      let semanticRepair: {
        content: string;
        structure: PRDStructure;
        refined: boolean;
        reviewerAttempts: ReviewerRefineResult[];
        truncated: boolean;
        changedSections: string[];
        structuralChange: boolean;
      };
      try {
        semanticRepair = await applySemanticPatchRefinement({
          content: compiled.content,
          structure: compiled.structure,
          issues: semanticIssues,
          language: language || 'en',
          templateCategory,
          originalRequest,
          reviewer: semanticRepairReviewer,
        });
      } catch (error) {
        const runtimeError = wrapProviderRuntimeError({
          error,
          failureStage: 'semantic_verifier',
          providerFailureStage: 'semantic_repair',
          compiled: { content: compiled.content, structure: compiled.structure },
          repairAttempts,
          reviewerAttempts,
          compilerRepairTruncationCount,
          compilerRepairFinishReasons,
          degradedCandidateSource,
        });
        if (runtimeError) throw runtimeError;
        throw error;
      }
      reviewerAttempts.push(...semanticRepair.reviewerAttempts);
      semanticRepairTruncated = semanticRepairTruncated || semanticRepair.truncated;
      options.onStageProgress?.({
        type: 'semantic_repair_done',
        issueCount: targetIssues.length,
        sectionKeys: semanticIssues.map(issue => issue.sectionKey).filter(Boolean),
        applied: semanticRepair.refined,
        truncated: semanticRepair.truncated,
      });

      // 7. Repair didn't refine — skip or mark for manual review
      if (!semanticRepair.refined) {
        if (attempts >= 2) {
          manualReviewFeatureIds.add(targetKey);
        }
        repairGapReason = determineRepairGapReason({
          beforeRepair: beforeRepairIssues,
          afterRepair: beforeRepairIssues,
          changed: false,
          substantiveChanged: false,
          exhaustedBudget: repairCycleCount >= maxSemanticRepairCycles,
        });
        if (repairCycleCount === 1) {
          postRepairSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        }
        finalSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        continue; // Try next target instead of breaking
      }

      // 8. Quality check
      const recompiledEvaluation = evaluateCandidate(semanticRepair.content);
      if (!(recompiledEvaluation.compiled.quality.valid || compareCandidatePreference(recompiledEvaluation, currentEvaluation) >= 0)) {
        // Repair degraded quality — revert and try next target
        if (attempts >= 2) {
          manualReviewFeatureIds.add(targetKey);
        }
        const semanticRepairChanged = !!semanticRepair.structuralChange || (semanticRepair.changedSections?.length || 0) > 0;
        repairGapReason = determineRepairGapReason({
          beforeRepair: beforeRepairIssues,
          afterRepair: beforeRepairIssues,
          changed: semanticRepairChanged,
          substantiveChanged: false,
          exhaustedBudget: repairCycleCount >= maxSemanticRepairCycles,
        });
        if (repairCycleCount === 1) {
          postRepairSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        }
        finalSemanticBlockingIssues = cloneSemanticBlockingIssues(beforeRepairIssues);
        continue; // Try next target instead of breaking
      }

      // 9. Accept repair
      current = {
        ...current,
        content: recompiledEvaluation.content,
      };
      currentEvaluation = recompiledEvaluation;
      compiled = currentEvaluation.compiled;

      // 10. Re-verify
      runCancelCheck(`semantic_reverification_cycle_${repairCycleCount}`);
      verification = await runSemanticVerifier();
      finalSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
      if (repairCycleCount === 1) {
        postRepairSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
      }
      const finalizeAcceptedSemanticRepair = () => {
        bestScore = qualityScore(compiled.quality);
        featureQualityDiagnostics = currentEvaluation.featureQualityDiagnostics;
        canonicalFeatureIds = compiled.quality.canonicalFeatureIds || canonicalFeatureIds;
        timelineMismatchedFeatureIds = compiled.quality.timelineMismatchedFeatureIds || [];
        semanticRepairApplied = true;
        semanticRepairChangedSections = Array.from(new Set([
          ...semanticRepairChangedSections,
          ...(semanticRepair.changedSections || []),
        ]));
        semanticRepairStructuralChange = semanticRepairStructuralChange || !!semanticRepair.structuralChange;
        maybePromoteBestSubstantive(current, currentEvaluation, degradedCandidateSource);
      };

      if (verification.verdict === 'pass' || verification.blockingIssues.length === 0) {
        finalizeAcceptedSemanticRepair();
        repairGapReason = undefined;
        break;
      }

      // ÄNDERUNG 13.03.2026: Auch beenden wenn nur noch unreparierbare Issues uebrig sind.
      // Hinweis: isNonFeatureSchemaMismatch zaehlt hier NICHT — der Loop darf diese weiter versuchen.
      const hasRepairableIssues = verification.blockingIssues.some(i => !isUnrepairableIssue(i));
      if (!hasRepairableIssues) {
        finalizeAcceptedSemanticRepair();
        repairGapReason = undefined;
        break;
      }

      // 11. Regression check: did repair break any frozen features?
      const regressions = verification.blockingIssues.filter(issue => {
        const fk = extractFeatureKey(issue.sectionKey);
        return fk && frozenFeatureIds.has(fk);
      });

      if (regressions.length > 0) {
        // Revert to snapshot
        compiled = { content: snapshotContent, structure: snapshotStructure, quality: snapshotEvaluation.compiled.quality };
        current = { ...current, content: snapshotContent };
        currentEvaluation = snapshotEvaluation;
        manualReviewFeatureIds.add(targetKey);
        repairGapReason = 'regression_detected';
        // Re-verify on reverted state
        verification = await runSemanticVerifier();
        finalSemanticBlockingIssues = cloneSemanticBlockingIssues(verification.blockingIssues);
        continue;
      }

      // 12. Feature locking: if repaired target now passes, freeze it
      finalizeAcceptedSemanticRepair();
      const targetStillFailing = verification.blockingIssues.some(i => i.sectionKey === targetKey);
      if (!targetStillFailing) {
        const featureKey = extractFeatureKey(targetKey);
        if (featureKey) frozenFeatureIds.add(featureKey);
      } else if (attempts >= 2) {
        manualReviewFeatureIds.add(targetKey);
      }

      if (repairCycleCount >= maxSemanticRepairCycles) {
        repairGapReason = determineRepairGapReason({
          beforeRepair: beforeRepairIssues,
          afterRepair: verification.blockingIssues,
          changed: true,
          substantiveChanged: hasSubstantiveCandidateImprovement(beforeRepairEvaluation, currentEvaluation),
          exhaustedBudget: true,
        });
        break;
      }
    }

    // Set gap reason when loop exited due to all targets exhausted (manual review)
    if (verification.verdict === 'fail' && semanticRepairAttempted && !repairGapReason) {
      repairGapReason = 'same_issues_persisted';
    }

    if (verification.verdict === 'fail' && verification.blockingIssues.length > 0) {
      // ÄNDERUNG 13.03.2026: Partitioniere in hard-blocking (echte Defekte) und
      // soft-blocking (Enrichment-Gaps, Section-Level-Widersprueche). Nur hard-blocking
      // Issues blockieren die Finalisierung — soft-blocking werden als degraded akzeptiert.
      const { hardBlocking, softBlocking } = partitionBlockingIssues(verification.blockingIssues);
      if (hardBlocking.length === 0 && softBlocking.length > 0) {
        const displayedDegraded = alignDisplayedCandidate(bestSubstantiveCurrent, bestSubstantiveCandidateSource);
        return {
          content: displayedDegraded.evaluation.compiled.content,
          structure: displayedDegraded.evaluation.compiled.structure,
          quality: withSyntheticQualityIssue(displayedDegraded.evaluation.compiled.quality, {
            code: 'semantic_verifier_enrichment_only',
            message: `Verifier reported only soft-blocking issues (${softBlocking.map(i => `${i.sectionKey}:${i.code}`).join(', ')}). Accepting as degraded.`,
            severity: 'warning',
          }),
          qualityScore: qualityScore(displayedDegraded.evaluation.compiled.quality),
          repairAttempts,
          reviewerAttempts,
          contentReview,
          contentRefined,
          semanticVerification: verification,
          semanticVerificationHistory,
          semanticRepairApplied,
          semanticRepairAttempted,
          semanticRepairIssueCodes,
          semanticRepairSectionKeys,
          semanticRepairTruncated,
          initialSemanticBlockingIssues,
          postRepairSemanticBlockingIssues,
          finalSemanticBlockingIssues,
          repairGapReason,
          repairCycleCount,
          primaryCapabilityAnchors: displayedDegraded.evaluation.compiled.quality.primaryCapabilityAnchors,
          featurePriorityWindow: displayedDegraded.evaluation.compiled.quality.featurePriorityWindow,
          coreFeatureIds: displayedDegraded.evaluation.compiled.quality.coreFeatureIds,
          supportFeatureIds: displayedDegraded.evaluation.compiled.quality.supportFeatureIds,
          canonicalFeatureIds: displayedDegraded.evaluation.compiled.quality.canonicalFeatureIds || canonicalFeatureIds,
          timelineMismatchedFeatureIds: displayedDegraded.evaluation.compiled.quality.timelineMismatchedFeatureIds || timelineMismatchedFeatureIds,
          timelineRewrittenFromFeatureMap,
          timelineRewriteAppliedLines,
          compilerRepairTruncationCount,
          compilerRepairFinishReasons,
          repairRejected,
          repairRejectedReason,
          repairDegradationSignals,
          degradedCandidateAvailable: !!displayedDegraded.evaluation.compiled.content,
          degradedCandidateSource: bestSubstantiveCandidateSource,
          displayedCandidateSource: displayedDegraded.displayedCandidateSource,
          diagnosticsAlignedWithDisplayedCandidate: displayedDegraded.diagnosticsAlignedWithDisplayedCandidate,
          semanticRepairChangedSections,
          semanticRepairStructuralChange,
          ...displayedDegraded.evaluation.featureQualityDiagnostics,
        };
      }

      // ÄNDERUNG 14.03.2026: Repair-Exhaustion Circuit-Breaker — alle Gap-Reasons
      // sind Exhaustion-Signale, nicht nur structural/substantive:
      // - repair_no_structural_change: Repair konnte nichts aendern
      // - repair_no_substantive_change: Repair hat geaendert aber nicht verbessert
      // - regression_detected: Repair hat anderes Feature gebrochen (Revert)
      // - same_issues_persisted: Gleiche Issues nach Repair
      // - emergent_issue_after_repair: Neue Issues nach Repair
      // Greift NUR wenn Repair tatsaechlich gelaufen ist (repairCycleCount > 0).
      const isRepairExhausted = !!repairGapReason && repairCycleCount > 0;

      if (isRepairExhausted) {
        const displayedExhausted = alignDisplayedCandidate(bestSubstantiveCurrent, bestSubstantiveCandidateSource);
        return {
          content: displayedExhausted.evaluation.compiled.content,
          structure: displayedExhausted.evaluation.compiled.structure,
          quality: withSyntheticQualityIssue(displayedExhausted.evaluation.compiled.quality, {
            code: 'semantic_verifier_repair_exhausted',
            message: `Repair loop exhausted after ${repairCycleCount} cycles (${repairGapReason}). `
              + `Remaining issues: ${verification.blockingIssues.map(i => `${i.sectionKey}:${i.code}`).join(', ')}. `
              + `Accepting as degraded.`,
            severity: 'warning',
          }),
          qualityScore: qualityScore(displayedExhausted.evaluation.compiled.quality),
          repairAttempts,
          reviewerAttempts,
          contentReview,
          contentRefined,
          semanticVerification: verification,
          semanticVerificationHistory,
          semanticRepairApplied,
          semanticRepairAttempted,
          semanticRepairIssueCodes,
          semanticRepairSectionKeys,
          semanticRepairTruncated,
          initialSemanticBlockingIssues,
          postRepairSemanticBlockingIssues,
          finalSemanticBlockingIssues,
          repairGapReason,
          repairCycleCount,
          primaryCapabilityAnchors: displayedExhausted.evaluation.compiled.quality.primaryCapabilityAnchors,
          featurePriorityWindow: displayedExhausted.evaluation.compiled.quality.featurePriorityWindow,
          coreFeatureIds: displayedExhausted.evaluation.compiled.quality.coreFeatureIds,
          supportFeatureIds: displayedExhausted.evaluation.compiled.quality.supportFeatureIds,
          canonicalFeatureIds: displayedExhausted.evaluation.compiled.quality.canonicalFeatureIds || canonicalFeatureIds,
          timelineMismatchedFeatureIds: displayedExhausted.evaluation.compiled.quality.timelineMismatchedFeatureIds || timelineMismatchedFeatureIds,
          timelineRewrittenFromFeatureMap,
          timelineRewriteAppliedLines,
          compilerRepairTruncationCount,
          compilerRepairFinishReasons,
          repairRejected,
          repairRejectedReason,
          repairDegradationSignals,
          degradedCandidateAvailable: !!displayedExhausted.evaluation.compiled.content,
          degradedCandidateSource: bestSubstantiveCandidateSource,
          displayedCandidateSource: displayedExhausted.displayedCandidateSource,
          diagnosticsAlignedWithDisplayedCandidate: displayedExhausted.diagnosticsAlignedWithDisplayedCandidate,
          semanticRepairChangedSections,
          semanticRepairStructuralChange,
          ...displayedExhausted.evaluation.featureQualityDiagnostics,
        };
      }

      const displayedFailure = alignDisplayedCandidate(bestSubstantiveCurrent, bestSubstantiveCandidateSource);
      throw new PrdCompilerQualityError(
        'PRD compiler quality gate failed after semantic verification.',
        withSyntheticQualityIssue(displayedFailure.evaluation.compiled.quality, {
          code: 'semantic_verifier_blocked',
          message: verification.blockingIssues.map(issue => issue.message).join(' | ') || 'Semantic verifier reported blocking issues.',
          severity: 'error',
        }),
        repairAttempts,
        {
          content: displayedFailure.evaluation.compiled.content,
          structure: displayedFailure.evaluation.compiled.structure,
        },
        {
          reviewerAttempts,
          semanticVerification: verification,
          failureStage: 'semantic_verifier',
          semanticRepairApplied,
          semanticRepairAttempted,
          semanticRepairIssueCodes,
          semanticRepairSectionKeys,
          semanticRepairTruncated,
          initialSemanticBlockingIssues,
          postRepairSemanticBlockingIssues,
          finalSemanticBlockingIssues,
          repairGapReason,
          repairCycleCount,
          primaryCapabilityAnchors: displayedFailure.evaluation.compiled.quality.primaryCapabilityAnchors,
          featurePriorityWindow: displayedFailure.evaluation.compiled.quality.featurePriorityWindow,
          coreFeatureIds: displayedFailure.evaluation.compiled.quality.coreFeatureIds,
          supportFeatureIds: displayedFailure.evaluation.compiled.quality.supportFeatureIds,
          canonicalFeatureIds: displayedFailure.evaluation.compiled.quality.canonicalFeatureIds || canonicalFeatureIds,
          timelineMismatchedFeatureIds: displayedFailure.evaluation.compiled.quality.timelineMismatchedFeatureIds || timelineMismatchedFeatureIds,
          timelineRewrittenFromFeatureMap,
          timelineRewriteAppliedLines,
          compilerRepairTruncationCount,
          compilerRepairFinishReasons,
          repairRejected,
          repairRejectedReason,
          repairDegradationSignals,
          degradedCandidateAvailable: !!displayedFailure.evaluation.compiled.content,
          degradedCandidateSource: bestSubstantiveCandidateSource,
          displayedCandidateSource: displayedFailure.displayedCandidateSource,
          diagnosticsAlignedWithDisplayedCandidate: displayedFailure.diagnosticsAlignedWithDisplayedCandidate,
          semanticRepairChangedSections,
          semanticRepairStructuralChange,
          ...displayedFailure.evaluation.featureQualityDiagnostics,
        },
      );
    }
  }

  return {
    content: compiled.content,
    structure: compiled.structure,
    quality: compiled.quality,
    qualityScore: qualityScore(compiled.quality),
    repairAttempts,
    reviewerAttempts,
    contentReview,
    contentRefined,
    semanticVerification,
    semanticVerificationHistory,
    semanticRepairApplied,
    semanticRepairAttempted,
    semanticRepairIssueCodes,
    semanticRepairSectionKeys,
    semanticRepairTruncated,
    initialSemanticBlockingIssues,
    postRepairSemanticBlockingIssues,
    finalSemanticBlockingIssues,
    repairGapReason,
    repairCycleCount,
    primaryCapabilityAnchors: compiled.quality.primaryCapabilityAnchors,
    featurePriorityWindow: compiled.quality.featurePriorityWindow,
    coreFeatureIds: compiled.quality.coreFeatureIds,
    supportFeatureIds: compiled.quality.supportFeatureIds,
    canonicalFeatureIds,
    timelineMismatchedFeatureIds,
    timelineRewrittenFromFeatureMap,
    timelineRewriteAppliedLines,
    compilerRepairTruncationCount,
    compilerRepairFinishReasons,
    repairRejected,
    repairRejectedReason,
    repairDegradationSignals,
    degradedCandidateAvailable: !!compiled.content,
    degradedCandidateSource,
    displayedCandidateSource: 'passed',
    diagnosticsAlignedWithDisplayedCandidate: true,
    semanticRepairChangedSections,
    semanticRepairStructuralChange,
    ...featureQualityDiagnostics,
  };
}
