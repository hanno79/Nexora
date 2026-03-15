import { describe, expect, it } from 'vitest';
import type { CompilePrdResult } from '../server/prdCompiler';
import {
  buildBoilerplateFeatureBlock,
  buildGoldSetPrd,
  compileGoldSetPrd,
  renameFeature,
  replaceFeatureBlock,
  replaceSectionBody,
} from './helpers/prdGoldSet';

interface GoldSetMutationCase {
  id: string;
  description: string;
  source: string;
  expectedValid: boolean;
  expectedIssueCodes?: string[];
  expectedIssuePrefixes?: string[];
  assert?: (result: CompilePrdResult) => void;
}

function issueCodes(result: CompilePrdResult): string[] {
  return result.quality.issues.map(issue => issue.code);
}

describe('prd gold-set baseline corpus', () => {
  it('keeps the English gold-set compiler-valid', () => {
    const compiled = compileGoldSetPrd(buildGoldSetPrd(), {
      language: 'en',
    });

    expect(compiled.quality.valid).toBe(true);
    expect(compiled.quality.issues.filter(issue => issue.severity === 'error')).toHaveLength(0);
    expect(compiled.quality.issues.some(issue => issue.code.startsWith('language_mismatch_'))).toBe(false);
    expect(compiled.quality.featureCount).toBeGreaterThanOrEqual(6);
  });

  it('renders German gold-set features with localized headings and content', () => {
    const germanPrd = buildGoldSetPrd({
      language: 'de',
      featureCount: 1,
    });

    expect(germanPrd).toContain('### F-01: Provider-Listenverwaltung');
    expect(germanPrd).toContain('1. Zweck');
    expect(germanPrd).toContain('2. Akteure');
    expect(germanPrd).toContain('Lädt die geordnete Provider-Liste für das ausgewählte Tier');
    expect(germanPrd).not.toContain('1. Purpose');
  });

  it('honors an explicit featureCount of zero', () => {
    const emptyFeaturePrd = buildGoldSetPrd({ featureCount: 0 });

    expect(emptyFeaturePrd).not.toContain('### F-01:');
  });
});

describe('prd gold-set mutation regressions', () => {
  const schemaMismatchSource = buildGoldSetPrd().replace(
    'WidgetSettings.selectedModelId, WidgetSettings.defaultTier, and the active provider ordering reference after validation succeeds.',
    'WidgetSettings.selectedModelIds, WidgetSettings.defaultTier, and the active provider ordering reference after validation succeeds.'
  );

  const outOfScopeSource = replaceFeatureBlock(
    buildGoldSetPrd(),
    'F-05',
    [
      '### F-05: Native Mobile Applications',
      '',
      '1. Purpose',
      'Deliver native mobile applications so administrators can manage widget provider configuration directly on iOS and Android devices.',
      '',
      '2. Actors',
      'Administrator using native mobile applications.',
      '',
      '3. Trigger',
      'The administrator opens one of the native mobile applications and edits widget configuration.',
      '',
      '4. Preconditions',
      'A signed-in mobile user session exists in one of the native mobile applications.',
      '',
      '5. Main Flow',
      '- The native mobile applications load widget settings from the backend.',
      '- The administrator edits provider and model settings in the native mobile applications.',
      '- The native mobile applications save the updated configuration back to the platform API.',
      '',
      '6. Alternate Flows',
      '- If the device is offline, the native mobile applications store changes for later sync.',
      '',
      '7. Postconditions',
      'The native mobile applications become the primary way to configure widget settings on phones and tablets.',
      '',
      '8. Data Impact',
      'Updates WidgetSettings and device-local mobile cache entries for the native mobile applications.',
      '',
      '9. UI Impact',
      'The release now includes native mobile applications and touch-first configuration screens.',
      '',
      '10. Acceptance Criteria',
      '- Administrators can manage widget settings from the native mobile applications on iOS.',
      '- Administrators can manage widget settings from the native mobile applications on Android.',
      '',
    ].join('\n')
  );

  const languageMixSource = replaceSectionBody(
    replaceSectionBody(
      buildGoldSetPrd(),
      'System Boundaries',
      'Der Scope umfasst das einbettbare React-Widget, eine Backend-Konfigurations-API und persistente Laufzeit-Einstellungen in PostgreSQL. Das System bedient authentifizierte interne Benutzer in Webanwendungen und schliesst native Mobile-Clients in diesem Release bewusst aus.'
    ),
    'Error Handling & Recovery',
    'Validierungsfehler liefern feldbezogene Meldungen und erhalten die zuletzt persistierte Konfiguration. Speicherfehler fuehren zu Rollback ohne Teilzustand und erzeugen nachvollziehbare Diagnose-Eintraege.'
  );

  let boilerplateSource = buildGoldSetPrd();
  const boilerplateRenames: Array<[string, string]> = [
    ['F-01', 'Provider List Management'],
    ['F-02', 'Model Catalog Retrieval'],
    ['F-03', 'Tier Configuration Storage'],
    ['F-04', 'Fallback Order Engine'],
    ['F-05', 'Theme Customization Interface'],
    ['F-06', 'Model Selection Persistence'],
  ];
  for (const [featureId, featureName] of boilerplateRenames) {
    boilerplateSource = replaceFeatureBlock(
      boilerplateSource,
      featureId,
      buildBoilerplateFeatureBlock(featureId, featureName)
    );
  }

  const nearDuplicateSource = renameFeature(
    renameFeature(buildGoldSetPrd(), 'F-01', 'Provider Cost Dashboard'),
    'F-02',
    'Provider Cost Reporting'
  );

  const metaLeakSource = replaceSectionBody(
    `Iteration 7\nQuestions Identified\nAnswer: Keep the scope narrow.\nReasoning: The verifier should review this.\n\n${buildGoldSetPrd()}`,
    'System Vision',
    [
      'Iteration 7',
      'Questions Identified',
      'Answer: This should not remain in the compiled output.',
      'Reasoning: The compiler must sanitize this meta leakage before validation.',
      '',
      'The reusable LLM widget gives product teams one embedded control surface for provider selection, model configuration, fallback ordering, and runtime governance. It reduces duplicated implementation work while keeping model-routing behavior, cost visibility, and reviewable defaults consistent across projects.',
    ].join('\n')
  );

  const cases: GoldSetMutationCase[] = [
    {
      id: 'schema-field-mismatch',
      description: 'flags feature references to undeclared domain-model fields',
      source: schemaMismatchSource,
      expectedValid: false,
      expectedIssueCodes: ['schema_field_reference_mismatch'],
    },
    {
      id: 'out-of-scope-reintroduced',
      description: 'flags deliverables that reintroduce explicitly excluded mobile scope',
      source: outOfScopeSource,
      expectedValid: false,
      expectedIssueCodes: ['out_of_scope_reintroduced'],
    },
    {
      id: 'language-mixing',
      description: 'flags mixed-language sections inside an English PRD',
      source: languageMixSource,
      expectedValid: false,
      expectedIssuePrefixes: ['language_mismatch_'],
    },
    {
      id: 'boilerplate-repetition',
      description: 'flags repeated feature boilerplate across the catalogue',
      source: boilerplateSource,
      expectedValid: false,
      expectedIssueCodes: ['boilerplate_repetition_detected', 'boilerplate_feature_acceptance_repetition'],
    },
    {
      id: 'near-duplicate-features',
      description: 'warns about near-duplicate features that remain unmerged',
      source: nearDuplicateSource,
      expectedValid: true,
      expectedIssueCodes: ['feature_near_duplicates_unmerged'],
    },
    {
      id: 'meta-leakage-sanitized',
      description: 'sanitizes prompt/meta leakage instead of letting it reach final compiled output',
      source: metaLeakSource,
      expectedValid: true,
      assert: (result) => {
        expect(result.content).not.toContain('Iteration 7');
        expect(result.content).not.toContain('Questions Identified');
        expect(result.content).not.toContain('Answer:');
        expect(result.content).not.toContain('Reasoning:');
      },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.id} ${testCase.description}`, () => {
      const compiled = compileGoldSetPrd(testCase.source, {
        language: 'en',
      });
      const codes = issueCodes(compiled);

      expect(compiled.quality.valid).toBe(testCase.expectedValid);

      for (const expectedCode of testCase.expectedIssueCodes || []) {
        expect(codes).toContain(expectedCode);
      }

      for (const expectedPrefix of testCase.expectedIssuePrefixes || []) {
        expect(codes.some(code => code.startsWith(expectedPrefix))).toBe(true);
      }

      testCase.assert?.(compiled);
    });
  }
});
