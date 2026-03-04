import { parsePRDToStructure } from './prdParser';

export type PrdWorkflowMode = 'generate' | 'improve';

export interface PrdBaselineAssessment {
  hasContent: boolean;
  featureCount: number;
  hasFeatureBaseline: boolean;
  /** Content exists but has no parseable feature catalogue — treat as context hint, not merge baseline */
  baselinePartial: boolean;
}

export interface ResolvePrdWorkflowModeInput {
  requestedMode?: PrdWorkflowMode;
  existingContent?: string | null;
}

export interface ResolvePrdWorkflowModeResult {
  mode: PrdWorkflowMode;
  assessment: PrdBaselineAssessment;
  downgradedFromImprove: boolean;
}

export function assessPrdBaseline(existingContent?: string | null): PrdBaselineAssessment {
  const raw = String(existingContent || '').trim();
  if (!raw) {
    return {
      hasContent: false,
      featureCount: 0,
      hasFeatureBaseline: false,
      baselinePartial: false,
    };
  }

  try {
    const parsed = parsePRDToStructure(raw);
    const featureCount = Array.isArray(parsed.features) ? parsed.features.length : 0;
    return {
      hasContent: true,
      featureCount,
      hasFeatureBaseline: featureCount > 0,
      baselinePartial: featureCount === 0,
    };
  } catch {
    return {
      hasContent: true,
      featureCount: 0,
      hasFeatureBaseline: false,
      baselinePartial: true,
    };
  }
}

export function resolvePrdWorkflowMode(
  input: ResolvePrdWorkflowModeInput
): ResolvePrdWorkflowModeResult {
  const requestedMode: PrdWorkflowMode = input.requestedMode === 'improve' ? 'improve' : 'generate';
  const assessment = assessPrdBaseline(input.existingContent);

  if (requestedMode === 'generate') {
    return {
      mode: 'generate',
      assessment,
      downgradedFromImprove: false,
    };
  }

  if (!assessment.hasFeatureBaseline) {
    if (assessment.hasContent) {
      // Content exists but no parseable features — stay in improve mode
      // with baselinePartial flag so the compiler uses existing content
      // as context hint instead of merge baseline. Never silently discard
      // existing content.
      return {
        mode: 'improve',
        assessment,
        downgradedFromImprove: false,
      };
    }
    return {
      mode: 'generate',
      assessment,
      downgradedFromImprove: true,
    };
  }

  return {
    mode: 'improve',
    assessment,
    downgradedFromImprove: false,
  };
}

