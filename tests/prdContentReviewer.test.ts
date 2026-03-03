import { describe, it, expect } from 'vitest';
import { analyzeContentQuality } from '../server/prdContentReviewer';
import type { PRDStructure } from '../server/prdStructure';

function makeStructure(overrides: Partial<PRDStructure> = {}): PRDStructure {
  return {
    features: [
      { id: 'F-01', name: 'User Authentication', rawContent: 'User login and registration flow.' },
      { id: 'F-02', name: 'Dashboard Analytics', rawContent: 'Analytics dashboard for user data visualization.' },
    ],
    otherSections: {},
    systemVision: 'TaskFlow is a project management tool that helps teams collaborate and track progress on software development tasks.',
    systemBoundaries: 'Web application deployed on Vercel. Target audience: development teams of 5-20 people. Supports real-time collaboration with WebSocket connections.',
    domainModel: 'Core entities: Project, Task, User, Sprint, Comment. Tasks belong to Projects and are assigned to Users. Sprints group Tasks into time-boxed iterations.',
    globalBusinessRules: 'Every Task must have exactly one assignee. Sprint duration is fixed at 2 weeks. Only project admins can delete Tasks. Task status transitions: Todo → In Progress → Review → Done.',
    nonFunctional: 'Page load time under 2 seconds. API response time p95 < 200ms. Support 1000 concurrent users. WCAG 2.1 Level AA compliance. 99.9% uptime SLA.',
    errorHandling: 'All API errors return structured JSON with error code and message. Client-side retry with exponential backoff for transient failures. Circuit breaker pattern for external service calls.',
    deployment: 'Next.js frontend on Vercel. PostgreSQL database on Supabase. Redis cache for session management. GitHub Actions CI/CD pipeline with automated testing.',
    definitionOfDone: 'All acceptance criteria pass. Code review approved by 2 team members. Unit test coverage above 80%. No critical or high severity bugs. Documentation updated.',
    outOfScope: 'Mobile native apps are not included in v1. Offline mode is deferred to v2. Third-party integrations beyond Slack and GitHub are out of scope for this release.',
    timelineMilestones: 'Phase 1 (Week 1-4): Core Task management with F-01, F-02. Phase 2 (Week 5-8): Sprint planning and analytics. Phase 3 (Week 9-12): Integrations and polish.',
    successCriteria: 'User adoption: 100 active teams within 3 months. Task completion rate above 85%. Average session duration over 15 minutes. NPS score above 40.',
    ...overrides,
  };
}

describe('prdContentReviewer', () => {
  describe('analyzeContentQuality', () => {
    it('returns clean result for well-written project-specific content', () => {
      const structure = makeStructure();
      const result = analyzeContentQuality(structure);

      expect(result.overallScore).toBeGreaterThan(30);
      expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
      expect(result.sectionsToRewrite).toHaveLength(0);
      // All comparable sections should have scores
      expect(Object.keys(result.sectionScores).length).toBeGreaterThanOrEqual(10);
    });

    it('detects compiler fallback filler as rewrite error', () => {
      const fallbackText = 'Definition of Done is explicitly defined for this TaskFlow project. Core scope centers on the Feature-Workflows of User Authentication, Dashboard Analytics. Statements are implementation-ready, testable and binding for this version.';
      const structure = makeStructure({ definitionOfDone: fallbackText });
      const result = analyzeContentQuality(structure);

      const fillerIssues = result.issues.filter(i => i.code === 'compiler_fallback_filler');
      expect(fillerIssues.length).toBeGreaterThanOrEqual(1);
      expect(fillerIssues[0].sectionKey).toBe('definitionOfDone');
      expect(fillerIssues[0].severity).toBe('error');
      expect(fillerIssues[0].suggestedAction).toBe('rewrite');
      expect(result.sectionsToRewrite).toContain('definitionOfDone');
    });

    it('detects cross-section repetition above 70% threshold', () => {
      const identicalText = 'The system implements robust error handling with retry logic, circuit breakers, and structured error responses. All errors are logged and monitored. Users receive clear error messages with actionable guidance.';
      const structure = makeStructure({
        errorHandling: identicalText,
        definitionOfDone: identicalText,
      });
      const result = analyzeContentQuality(structure);

      const repetitionIssues = result.issues.filter(i => i.code === 'cross_section_repetition');
      expect(repetitionIssues.length).toBeGreaterThanOrEqual(1);
      expect(result.sectionsToRewrite).toContain('errorHandling');
      expect(result.sectionsToRewrite).toContain('definitionOfDone');
    });

    it('does not flag sections with distinct content as repetition', () => {
      const structure = makeStructure(); // default structure has distinct sections
      const result = analyzeContentQuality(structure);

      const repetitionIssues = result.issues.filter(i => i.code === 'cross_section_repetition');
      expect(repetitionIssues).toHaveLength(0);
    });

    it('detects AI phrasing from compiler boilerplate patterns', () => {
      const aiBoilerplate = 'This feature delivers a clearly scoped user capability with an observable outcome. It defines an independent, testable workflow. The system reads and updates only in-scope entities required for this feature.';
      const structure = makeStructure({ definitionOfDone: aiBoilerplate });
      const result = analyzeContentQuality(structure);

      const aiIssues = result.issues.filter(
        i => i.code === 'ai_phrasing_detected' && i.sectionKey === 'definitionOfDone'
      );
      expect(aiIssues.length).toBeGreaterThanOrEqual(1);
      expect(aiIssues[0].severity).toBe('warning');
      expect(aiIssues[0].suggestedAction).toBe('rewrite');
    });

    it('detects general AI filler phrases (robust and scalable, seamless integration)', () => {
      const llmFiller = 'The system provides a robust and scalable architecture with seamless integration of third-party services. It leverages existing cloud infrastructure to ensure a smooth deployment pipeline for comprehensive solution delivery.';
      const structure = makeStructure({ deployment: llmFiller });
      const result = analyzeContentQuality(structure);

      // Should detect multiple general AI filler patterns
      const aiIssues = result.issues.filter(
        i => i.code === 'ai_phrasing_detected' && i.sectionKey === 'deployment'
      );
      expect(aiIssues.length).toBeGreaterThanOrEqual(1);
      // The section's aiPhrasing score should be low (many hits)
      expect(result.sectionScores['deployment']?.aiPhrasing).toBeLessThan(60);
    });

    it('flags low specificity when section has no project terms', () => {
      const genericText = 'The entity follows strict patterns for optimal resource allocation. It includes proper schema alignment, lifecycle coordination, and batch processing mechanisms. The topology is arranged to be composable and idempotent.';
      const structure = makeStructure({ outOfScope: genericText });
      const result = analyzeContentQuality(structure);

      const specificityIssues = result.issues.filter(
        i => i.code === 'low_specificity' && i.sectionKey === 'outOfScope'
      );
      expect(specificityIssues.length).toBeGreaterThanOrEqual(1);
      expect(specificityIssues[0].severity).toBe('warning');
      expect(specificityIssues[0].suggestedAction).toBe('expand');
    });

    it('does not flag specificity for project-specific text', () => {
      // Text that references features by name
      const specificText = 'User Authentication (F-01) must pass all acceptance criteria including login, registration, and password reset flows. Dashboard Analytics (F-02) must render charts within 2 seconds.';
      const structure = makeStructure({ definitionOfDone: specificText });
      const result = analyzeContentQuality(structure);

      const specificityIssues = result.issues.filter(
        i => i.code === 'low_specificity' && i.sectionKey === 'definitionOfDone'
      );
      expect(specificityIssues).toHaveLength(0);
      // Specificity score should be > 0 for text with project terms
      expect(result.sectionScores['definitionOfDone']?.specificity).toBeGreaterThan(0);
    });

    it('applies template-specific quality weights from technical profile', () => {
      const structure = makeStructure();
      const defaultResult = analyzeContentQuality(structure);
      const technicalResult = analyzeContentQuality(structure, { templateCategory: 'technical' });

      // Both should produce scores, but technical template has different weights
      // (specificity: 30, uniqueness: 30, depth: 40 vs default 25:25:50)
      expect(Object.keys(technicalResult.sectionScores).length).toBeGreaterThanOrEqual(10);
      // Scores may differ due to different weighting
      const defaultDeploy = defaultResult.sectionScores['deployment'];
      const techDeploy = technicalResult.sectionScores['deployment'];
      expect(defaultDeploy).toBeDefined();
      expect(techDeploy).toBeDefined();
      // Technical template weights specificity higher (30 vs 25), so if specificity differs
      // from depth/uniqueness, scores should differ
      if (defaultDeploy && techDeploy) {
        // Both should be valid scores in range
        expect(defaultDeploy.overall).toBeGreaterThanOrEqual(0);
        expect(defaultDeploy.overall).toBeLessThanOrEqual(100);
        expect(techDeploy.overall).toBeGreaterThanOrEqual(0);
        expect(techDeploy.overall).toBeLessThanOrEqual(100);
      }
    });

    it('computes per-section scores with correct ranges', () => {
      const structure = makeStructure();
      const result = analyzeContentQuality(structure);

      for (const [key, score] of Object.entries(result.sectionScores)) {
        expect(score.specificity).toBeGreaterThanOrEqual(0);
        expect(score.specificity).toBeLessThanOrEqual(100);
        expect(score.depth).toBeGreaterThanOrEqual(0);
        expect(score.depth).toBeLessThanOrEqual(100);
        expect(score.uniqueness).toBeGreaterThanOrEqual(0);
        expect(score.uniqueness).toBeLessThanOrEqual(100);
        expect(score.aiPhrasing).toBeGreaterThanOrEqual(0);
        expect(score.aiPhrasing).toBeLessThanOrEqual(100);
        expect(score.overall).toBeGreaterThanOrEqual(0);
        expect(score.overall).toBeLessThanOrEqual(100);
      }

      // Clean content should have high aiPhrasing scores (100 = no AI phrases)
      const visionScore = result.sectionScores['systemVision'];
      expect(visionScore?.aiPhrasing).toBe(100);
    });

    it('gives higher depth scores to longer, structured sections', () => {
      const shortSection = 'Brief section.';
      const longSection = 'Detailed section with multiple points:\n- First item with concrete numbers: 99.9% uptime\n- Second item covering edge cases\n- Third item with specific metrics: p95 < 200ms\nThis covers performance, reliability, and monitoring requirements for the production deployment.';
      const structure = makeStructure({
        outOfScope: shortSection,
        nonFunctional: longSection,
      });
      const result = analyzeContentQuality(structure);

      const outOfScopeScore = result.sectionScores['outOfScope'];
      const nfrScore = result.sectionScores['nonFunctional'];
      // Long structured text should have higher depth than short text
      if (outOfScopeScore && nfrScore) {
        expect(nfrScore.depth).toBeGreaterThan(outOfScopeScore.depth);
      }
    });

    it('detects feature-level AI boilerplate across multiple fields', () => {
      const structure = makeStructure({
        features: [{
          id: 'F-01',
          name: 'Test Feature',
          rawContent: 'Test feature raw content.',
          purpose: '"Test Feature" delivers a clearly scoped user capability with an observable outcome.',
          actors: 'Primary: end user invoking "Test Feature". Secondary: API and persistence services.',
          trigger: 'User explicitly initiates "Test Feature" through the interface.',
          preconditions: 'Required inputs are present and validated before execution.',
          postconditions: 'After "Test Feature" completes, resulting state is consistent, persisted, and available for follow-up actions.',
          dataImpact: 'The "Test Feature" workflow reads and updates only in-scope entities required for this feature.',
          uiImpact: 'UI surfaces loading, success, and error states for "Test Feature" consistently and transparently.',
          mainFlow: ['Step 1', 'Step 2'],
          alternateFlows: ['Error path'],
          acceptanceCriteria: ['"Test Feature" is verifiable by end users directly in the UI without manual reload.'],
        }],
      });
      const result = analyzeContentQuality(structure);

      const boilerplateIssues = result.issues.filter(
        i => i.code === 'feature_ai_boilerplate' && i.sectionKey === 'feature:F-01'
      );
      expect(boilerplateIssues.length).toBeGreaterThanOrEqual(1);
      expect(boilerplateIssues[0].severity).toBe('warning');
    });

    it('template content mismatch detects missing required patterns', () => {
      // Feature template expects successCriteria to match /acceptance|test/
      const structure = makeStructure({
        successCriteria: 'The product will be considered done when goals are met.',
      });
      const result = analyzeContentQuality(structure, { templateCategory: 'feature' });

      const mismatchIssues = result.issues.filter(
        i => i.code === 'template_content_mismatch' && i.sectionKey === 'successCriteria'
      );
      expect(mismatchIssues.length).toBeGreaterThanOrEqual(1);
      expect(mismatchIssues[0].severity).toBe('warning');
    });
  });
});
