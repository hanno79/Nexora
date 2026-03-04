/// <reference types="vitest" />
import { analyzeContentQuality, buildFeatureEnrichPrompt, parseFeatureEnrichResponse } from '../server/prdContentReviewer';
import type { PRDStructure } from '../server/prdStructure';

function makeStructure(overrides: Partial<PRDStructure> = {}): PRDStructure {
  return {
    features: [
      {
        id: 'F-01', name: 'User Authentication',
        rawContent: 'User login and registration flow.',
        purpose: 'Authenticate users via OAuth2 for secure access to TaskFlow.',
        actors: 'End user, OAuth2 provider (Google, GitHub)',
        trigger: 'User clicks "Sign In" button on the landing page.',
        preconditions: 'OAuth2 provider is reachable and configured.',
        mainFlow: ['User clicks Sign In', 'System redirects to OAuth provider', 'Provider returns auth token', 'System creates session and redirects to dashboard'],
        acceptanceCriteria: ['User can sign in via Google OAuth', 'Invalid tokens are rejected with 401', 'Session persists across page reloads'],
      },
      {
        id: 'F-02', name: 'Dashboard Analytics',
        rawContent: 'Analytics dashboard for user data visualization.',
        purpose: 'Display task completion metrics and sprint velocity for project managers.',
        actors: 'Project manager, team lead',
        trigger: 'User navigates to the Analytics tab.',
        preconditions: 'At least one sprint with completed tasks exists.',
        mainFlow: ['System loads sprint data', 'Charts render velocity and burndown', 'User filters by date range'],
        acceptanceCriteria: ['Dashboard loads within 2 seconds', 'Charts update on filter change', 'Empty state shown for no data'],
      },
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

    it('detects features with incomplete structured fields', () => {
      const structure = makeStructure({
        features: [
          {
            id: 'F-01', name: 'Complete Feature',
            rawContent: 'Full feature.',
            purpose: 'Does something specific.',
            actors: 'End user',
            trigger: 'Click button',
            preconditions: 'User is logged in',
            mainFlow: ['Step 1', 'Step 2'],
            acceptanceCriteria: ['Criterion 1'],
          },
          {
            id: 'F-02', name: 'Sparse Feature',
            rawContent: 'Sparse feature with only a purpose.',
            purpose: 'This feature exists.',
            // All other fields empty — should be flagged
          },
        ],
      });

      const result = analyzeContentQuality(structure);
      const incompleteIssues = result.issues.filter(i => i.code === 'feature_fields_incomplete');
      expect(incompleteIssues.length).toBe(1);
      expect(incompleteIssues[0].sectionKey).toBe('feature:F-02');
      expect(incompleteIssues[0].suggestedAction).toBe('enrich');
      expect(incompleteIssues[0].message).toMatch(/Missing:/);
    });

    it('does not flag features with 5+ filled fields as incomplete', () => {
      const structure = makeStructure(); // Default features have 6 fields each
      const result = analyzeContentQuality(structure);
      const incompleteIssues = result.issues.filter(i => i.code === 'feature_fields_incomplete');
      expect(incompleteIssues).toHaveLength(0);
    });

    it('detects shallow features with thin boilerplate content', () => {
      const structure = makeStructure({
        features: [{
          id: 'F-01', name: 'Scoring Algorithm',
          rawContent: 'Scoring.',
          purpose: 'Implementierung des Punktesystems.',  // 34 chars, but no detail
          actors: 'Spieler.',                             // < 20 chars
          trigger: 'Spielstart.',                         // < 20 chars
          preconditions: 'Keine.',                        // < 20 chars
          mainFlow: ['Berechnung von Punkten.'],          // only 1 step (needs 3)
          alternateFlows: ['Keine.'],                     // < 10 chars item
          postconditions: 'Punkte berechnet.',            // < 20 chars
          dataImpact: 'Punkte.',                          // < 20 chars
          uiImpact: 'Keine.',                             // < 20 chars
          acceptanceCriteria: ['Punkte korrekt.'],        // only 1 item (needs 2)
        }],
      });
      const result = analyzeContentQuality(structure);
      const shallowIssues = result.issues.filter(i => i.code === 'feature_content_shallow');
      expect(shallowIssues.length).toBe(1);
      expect(shallowIssues[0].sectionKey).toBe('feature:F-01');
      expect(shallowIssues[0].suggestedAction).toBe('enrich');
    });

    it('does not flag well-specified features as shallow', () => {
      const structure = makeStructure(); // default features have substantial content
      const result = analyzeContentQuality(structure);
      const shallowIssues = result.issues.filter(i => i.code === 'feature_content_shallow');
      expect(shallowIssues).toHaveLength(0);
    });

    it('detects fallback-filled sections via explicit fallbackSections list', () => {
      const structure = makeStructure({
        // Content doesn't match old FALLBACK_PATTERN regex, but section is known to be fallback-filled
        definitionOfDone: 'A feature is complete when all acceptance criteria pass and code review is approved.',
      });
      const result = analyzeContentQuality(structure, {
        fallbackSections: ['definitionOfDone'],
      });

      const fillerIssues = result.issues.filter(
        i => i.code === 'compiler_fallback_filler' && i.sectionKey === 'definitionOfDone'
      );
      expect(fillerIssues.length).toBe(1);
      expect(fillerIssues[0].severity).toBe('error');
      expect(result.sectionsToRewrite).toContain('definitionOfDone');
    });

    it('detects template fallback via opening-line patterns (DE definitionOfDone)', () => {
      const structure = makeStructure({
        definitionOfDone: 'Ein Feature gilt als abgeschlossen wenn:\n- Alle Akzeptanzkriterien bestanden\n- Code-Review abgeschlossen\n- Tests decken Hauptfluss ab\n- Keine kritischen Bugs offen fuer: F-01 User Auth, F-02 Dashboard',
      });
      const result = analyzeContentQuality(structure);
      const filler = result.issues.filter(i => i.code === 'compiler_fallback_filler' && i.sectionKey === 'definitionOfDone');
      expect(filler.length).toBe(1);
      expect(result.sectionsToRewrite).toContain('definitionOfDone');
    });

    it('detects template fallback via opening-line patterns (EN successCriteria)', () => {
      const structure = makeStructure({
        successCriteria: 'The project is successful when:\n- All features are implemented\n- Acceptance criteria pass\n- No critical bugs at release\n- Users complete core workflows end-to-end',
      });
      const result = analyzeContentQuality(structure);
      const filler = result.issues.filter(i => i.code === 'compiler_fallback_filler' && i.sectionKey === 'successCriteria');
      expect(filler.length).toBe(1);
      expect(result.sectionsToRewrite).toContain('successCriteria');
    });

    it('detects template fallback via opening-line patterns (DE outOfScope)', () => {
      const structure = makeStructure({
        outOfScope: 'Folgende Aspekte sind fuer diese Version explizit NICHT im Scope:\n- Features ueber den Katalog hinaus\n- Integrationen ausserhalb der Boundaries\n- Performance-Optimierung ueber NFR-Ziele hinaus',
      });
      const result = analyzeContentQuality(structure);
      const filler = result.issues.filter(i => i.code === 'compiler_fallback_filler' && i.sectionKey === 'outOfScope');
      expect(filler.length).toBe(1);
      expect(result.sectionsToRewrite).toContain('outOfScope');
    });

    it('detects template fallback via opening-line patterns (DE timelineMilestones)', () => {
      const structure = makeStructure({
        timelineMilestones: 'Die Lieferung ist in Phasen strukturiert:\n- Phase 1: Kerninfrastruktur\n- Phase 2: Umsetzung von F-01, F-02\n- Phase 3: Testing und Abnahme',
      });
      const result = analyzeContentQuality(structure);
      const filler = result.issues.filter(i => i.code === 'compiler_fallback_filler' && i.sectionKey === 'timelineMilestones');
      expect(filler.length).toBe(1);
      expect(result.sectionsToRewrite).toContain('timelineMilestones');
    });

    it('does not flag project-specific sections as template fallback', () => {
      // Custom project-specific content that happens to mention "abgeschlossen" but isn't template text
      const structure = makeStructure({
        definitionOfDone: 'Jedes Feature der TaskFlow-App gilt als abgeschlossen, sobald folgende projektspezifische Kriterien erfuellt sind:\n- OAuth2-Login funktioniert mit Google und GitHub\n- Dashboard zeigt Sprint-Velocity korrekt an',
      });
      const result = analyzeContentQuality(structure);
      const filler = result.issues.filter(i => i.code === 'compiler_fallback_filler' && i.sectionKey === 'definitionOfDone');
      expect(filler).toHaveLength(0);
    });
  });

  describe('parseFeatureEnrichResponse', () => {
    it('parses structured enrichment response into field map', () => {
      const response = `=== F-01: Auth Login ===
**purpose**: Authenticate users securely via OAuth2.
**actors**: End user, Google OAuth provider
**mainFlow**:
1. User clicks Sign In button
2. System redirects to Google OAuth
3. Token returned and session created

=== F-03: Dashboard ===
**trigger**: User navigates to /dashboard
**acceptanceCriteria**:
- [ ] Dashboard loads under 2 seconds
- [ ] Empty state shown when no data`;

      const result = parseFeatureEnrichResponse(response, ['F-01', 'F-03']);
      expect(result.size).toBe(2);

      const f01 = result.get('F-01')!;
      expect(f01.purpose).toMatch(/OAuth2/);
      expect(f01.actors).toMatch(/Google/);
      expect(f01.mainFlow).toHaveLength(3);

      const f03 = result.get('F-03')!;
      expect(f03.trigger).toMatch(/dashboard/);
      expect(f03.acceptanceCriteria).toHaveLength(2);
    });

    it('ignores features not in the allowed ID list', () => {
      const response = `=== F-99: Unknown ===
**purpose**: Should be ignored.`;

      const result = parseFeatureEnrichResponse(response, ['F-01']);
      expect(result.size).toBe(0);
    });

    it('handles mixed-case feature IDs via case-insensitive matching', () => {
      const response = `=== f-01: Auth Login ===
**purpose**: Authenticate users securely via OAuth2.`;

      // Caller passes lowercase IDs — should still match
      const result = parseFeatureEnrichResponse(response, ['f-01']);
      expect(result.size).toBe(1);
      expect(result.get('F-01')).toBeDefined();
      expect(result.get('F-01')!.purpose).toMatch(/OAuth2/);
    });
  });

  describe('buildFeatureEnrichPrompt', () => {
    it('generates prompt with project context and missing fields', () => {
      const prompt = buildFeatureEnrichPrompt({
        features: [
          { id: 'F-01', name: 'Auth Login', rawContent: 'User authentication via OAuth.', missingFields: ['actors', 'mainFlow'] },
        ],
        projectContext: {
          systemVision: 'A task management tool for dev teams.',
          domainModel: 'Entities: User, Task, Project.',
          otherFeatures: [{ id: 'F-02', name: 'Dashboard' }],
        },
        language: 'en',
      });

      expect(prompt).toContain('F-01: Auth Login');
      expect(prompt).toContain('actors, mainFlow');
      expect(prompt).toContain('task management');
      expect(prompt).toContain('F-02: Dashboard');
    });
  });
});
