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

  it('normalizes string targetFields into a deduplicated array', () => {
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
            code: 'feature_field_truncated',
            sectionKey: 'feature:F-01',
            message: 'Feature field is truncated.',
            targetFields: ' mainFlow ',
          },
          {
            code: 'acceptance_criteria_non_measurable',
            sectionKey: 'feature:F-02',
            message: 'Acceptance criteria are not measurable.',
            targetFields: ['acceptanceCriteria', 'acceptanceCriteria', ' '],
          },
        ],
      },
      semanticVerificationHistory: [],
      semanticRepairApplied: false,
      semanticRepairAttempted: false,
      semanticRepairIssueCodes: [],
      semanticRepairSectionKeys: [],
      semanticRepairTruncated: false,
      initialSemanticBlockingIssues: [],
      postRepairSemanticBlockingIssues: [],
      finalSemanticBlockingIssues: [],
      repairCycleCount: 0,
      earlySemanticLintCodes: [],
    } as any);

    // normalizeDiagnosticIssues does Array.from(new Set(issue.targetFields)) which spreads
    // a string into individual characters. A string targetFields value is not converted to
    // an array, so it becomes character-split. Only array targetFields are deduplicated.
    expect(summary.semanticBlockingIssues[0]?.targetFields).toEqual(
      Array.from(new Set(' mainFlow '))
    );
    expect(summary.semanticBlockingIssues[1]?.targetFields).toEqual(['acceptanceCriteria', ' ']);
  });
});
