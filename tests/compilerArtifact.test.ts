import { describe, expect, it } from 'vitest';
import { summarizeFinalizerResult } from '../server/compilerArtifact';

describe('compilerArtifact', () => {
  it('preserves suggestedFix when normalizing diagnostic issues', () => {
    const suggestedFix = 'Replace LocalStorage with PostgreSQL in Deployment.';
    const summary = summarizeFinalizerResult({
      quality: {
        valid: false,
        truncatedLikely: false,
        missingSections: [],
        featureCount: 0,
        issues: [],
      },
      qualityScore: 42,
      contentReview: { issues: [] },
      repairAttempts: [],
      reviewerAttempts: [],
      semanticVerification: {
        blockingIssues: [
          {
            code: 'deployment_stack_mismatch',
            sectionKey: 'deployment',
            message: 'Deployment conflicts with the runtime model.',
            suggestedFix,
          },
        ],
      },
      semanticVerificationHistory: [],
      semanticRepairApplied: false,
      semanticRepairAttempted: false,
      semanticRepairIssueCodes: [],
      semanticRepairSectionKeys: [],
      semanticRepairTruncated: false,
      initialSemanticBlockingIssues: [
        {
          code: 'deployment_stack_mismatch',
          sectionKey: 'deployment',
          message: 'Deployment conflicts with the runtime model.',
          suggestedFix,
        },
      ],
      postRepairSemanticBlockingIssues: [],
      finalSemanticBlockingIssues: [
        {
          code: 'deployment_stack_mismatch',
          sectionKey: 'deployment',
          message: 'Deployment conflicts with the runtime model.',
          suggestedFix,
        },
      ],
      repairCycleCount: 0,
      earlySemanticLintCodes: [],
    } as any);

    expect(summary.initialSemanticBlockingIssues[0]?.suggestedFix).toBe(suggestedFix);
    expect(summary.finalSemanticBlockingIssues[0]?.suggestedFix).toBe(suggestedFix);
    expect(summary.semanticBlockingIssues[0]?.suggestedFix).toBe(suggestedFix);
  });
});
