import { parsePRDToStructure } from './prdParser';

export type PrdWorkflowMode = 'generate' | 'improve';

export interface PrdBaselineAssessment {
  hasContent: boolean;
  featureCount: number;
  hasFeatureBaseline: boolean;
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
    };
  }

  try {
    const parsed = parsePRDToStructure(raw);
    const featureCount = Array.isArray(parsed.features) ? parsed.features.length : 0;
    return {
      hasContent: true,
      featureCount,
      hasFeatureBaseline: featureCount > 0,
    };
  } catch {
    return {
      hasContent: true,
      featureCount: 0,
      hasFeatureBaseline: false,
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

