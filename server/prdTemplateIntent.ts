import type { PRDStructure } from './prdStructure';

export type PrdTemplateCategory =
  | 'feature'
  | 'epic'
  | 'technical'
  | 'product-launch'
  | 'custom'
  | 'generic';

export type SupportedLanguage = 'de' | 'en';

export type RequiredSectionKey =
  | 'systemVision'
  | 'systemBoundaries'
  | 'domainModel'
  | 'globalBusinessRules'
  | 'nonFunctional'
  | 'errorHandling'
  | 'deployment'
  | 'definitionOfDone'
  | 'outOfScope'
  | 'timelineMilestones'
  | 'successCriteria';

export interface TemplateSemanticIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

interface TemplateProfile {
  category: PrdTemplateCategory;
  labelEn: string;
  labelDe: string;
  promptRulesEn: string[];
  promptRulesDe: string[];
  semanticSignals: {
    requiredAny: RegExp[];
    requiredSections: RequiredSectionKey[];
    minFeatureCount?: number;
    featureNameSignals?: RegExp[];
    minFeatureSignalRatio?: number;
    disallowedFeatureNameSignals?: RegExp[];
    maxDisallowedFeatureRatio?: number;
  };
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'must', 'soll',
  'oder', 'und', 'mit', 'fuer', 'für', 'eine', 'einer', 'einem', 'eines', 'den',
  'der', 'die', 'das', 'vom', 'von', 'ist', 'sind', 'werden', 'wird', 'nicht',
  'please', 'bitte', 'template', 'kontext', 'methode', 'mode', 'generate', 'improve',
  'existing', 'content', 'prd',
]);

const TEMPLATE_PROFILES: Record<PrdTemplateCategory, TemplateProfile> = {
  feature: {
    category: 'feature',
    labelEn: 'Feature PRD',
    labelDe: 'Feature-PRD',
    promptRulesEn: [
      'Focus on one bounded product capability and user workflows.',
      'Keep features atomic and directly user-observable.',
      'Prioritize acceptance criteria for one release increment.',
    ],
    promptRulesDe: [
      'Fokussiere auf eine klar abgegrenzte Produktfunktion und deren Nutzer-Workflows.',
      'Features muessen atomar und direkt nutzerbeobachtbar sein.',
      'Priorisiere Akzeptanzkriterien fuer einen konkreten Release-Inkrement.',
    ],
    semanticSignals: {
      requiredAny: [
        /\b(user|nutzer|workflow|funktion|task|aufgabe)\b/i,
        /\b(acceptance|akzeptanz|kriteri)\b/i,
      ],
      requiredSections: ['systemVision', 'successCriteria'],
      minFeatureCount: 4,
      featureNameSignals: [
        /\b(create|update|delete|view|list|manage|sync|validate|import|export|create|register|capture)\b/i,
        /\b(erstellen|bearbeiten|loeschen|anzeigen|auflisten|verwalten|synchronisieren|validieren|import|export)\b/i,
        /\b(user|nutzer|workflow|prozess|task|aufgabe|freigabe|approval|notification|benachrichtigung)\b/i,
      ],
      minFeatureSignalRatio: 0.45,
      disallowedFeatureNameSignals: [
        /\b(system\s*vision|problem\s*statement|goals?(?:\s*&\s*success\s*metrics?)?|target\s*audience|user\s*stories|timeline|out\s*of\s*scope|definition\s*of\s*done|success\s*criteria)\b/i,
        /\b(part\s*[a-d]|section\s*[a-d]|review\s*feedback|iteration\s*\d+)\b/i,
      ],
      maxDisallowedFeatureRatio: 0.35,
    },
  },
  epic: {
    category: 'epic',
    labelEn: 'Epic PRD',
    labelDe: 'Epic-PRD',
    promptRulesEn: [
      'Cover multi-feature scope, sequencing, and cross-feature dependencies.',
      'Describe phased delivery and milestone ownership.',
      'Include explicit scope boundaries between current and later phases.',
      'Use explicit epic planning terms such as phase/milestone/dependency and ownership/stakeholder/workstream.',
    ],
    promptRulesDe: [
      'Beschreibe Multi-Feature-Scope, Sequenzierung und Abhaengigkeiten zwischen Features.',
      'Beschreibe Lieferphasen und Meilenstein-Verantwortung.',
      'Definiere klare Scope-Grenzen zwischen aktueller und spaeterer Phase.',
      'Nutze explizite Epic-Planungsbegriffe wie Phase/Meilenstein/Abhaengigkeit und Verantwortung/Stakeholder/Workstream.',
    ],
    semanticSignals: {
      requiredAny: [
        /\b(milestone|phase|phases|roadmap|rollout|dependency|dependencies|release|iteration|sprint|sequence|sequencing|prioritization|meilenstein|meilensteine|phasen?|abh[aä]ngig|abhaengig|release|iteration|sprint|sequenz|priorisierung)\b/i,
        /\b(team|cross[- ]team|initiative|programm|portfolio|stakeholder|owner|ownership|verantwortung|verantwortlich|koordination|coordination|alignment|workstream|scope|umfang)\b/i,
      ],
      requiredSections: ['timelineMilestones', 'outOfScope'],
      minFeatureCount: 5,
    },
  },
  technical: {
    category: 'technical',
    labelEn: 'Technical PRD',
    labelDe: 'Technisches PRD',
    promptRulesEn: [
      'Emphasize architecture, data model, operational reliability, and integration contracts.',
      'Capture security, performance, and observability expectations explicitly.',
      'Feature catalogue should map to technical capabilities, not generic consumer app flows.',
      'At least 40% of feature names must contain technical intent terms (API, architecture, schema, integration, security, observability, deployment).',
    ],
    promptRulesDe: [
      'Betone Architektur, Datenmodell, Betriebssicherheit und Integrationsvertraege.',
      'Sicherheits-, Performance- und Observability-Anforderungen muessen explizit sein.',
      'Der Feature-Katalog soll technische Faehigkeiten abbilden, nicht generische Consumer-App-Flows.',
      'Mindestens 40% der Feature-Namen muessen technische Begriffe enthalten (API, Architektur, Schema, Integration, Sicherheit, Observability, Deployment).',
    ],
    semanticSignals: {
      requiredAny: [
        /\b(api|schnittstelle|architecture|architektur|database|datenbank|schema|migration)\b/i,
        /\b(security|sicherheit|performance|latenz|reliability|zuverlaessigkeit|observability|monitoring)\b/i,
      ],
      requiredSections: ['domainModel', 'deployment', 'nonFunctional'],
      minFeatureCount: 4,
      featureNameSignals: [
        /\b(api|schnittstelle|architektur|architecture|schema|datenmodell|database|migration|integrat(?:ion|ions?)|vertrag|contract)\b/i,
        /\b(sicherheit|security|performance|latenz|reliability|zuverlaessigkeit|observability|monitoring|deployment|infrastruktur)\b/i,
      ],
      minFeatureSignalRatio: 0.4,
      disallowedFeatureNameSignals: [
        /\b(dark mode|theme|profil|profile|benutzerprofil|social|like|follow)\b/i,
      ],
      maxDisallowedFeatureRatio: 0.4,
    },
  },
  'product-launch': {
    category: 'product-launch',
    labelEn: 'Product Launch PRD',
    labelDe: 'Product-Launch-PRD',
    promptRulesEn: [
      'Tie scope to launch readiness, adoption, and go-to-market execution.',
      'Timeline must include launch phases and stakeholder coordination.',
      'Success criteria must include measurable launch/adoption outcomes.',
      'At least 35% of feature names must include launch intent terms (launch, rollout, go-to-market, adoption, readiness, stakeholder).',
    ],
    promptRulesDe: [
      'Verknuepfe den Scope mit Launch-Readiness, Adoption und Go-to-Market-Ausfuehrung.',
      'Der Zeitplan muss Launch-Phasen und Stakeholder-Koordination enthalten.',
      'Erfolgskriterien muessen messbare Launch-/Adoption-Ergebnisse enthalten.',
      'Mindestens 35% der Feature-Namen muessen Launch-Begriffe enthalten (Launch, Rollout, Go-to-Market, Adoption, Readiness, Stakeholder).',
    ],
    semanticSignals: {
      requiredAny: [
        /\b(launch|go[- ]to[- ]market|gtm|rollout|einfuehrung|markteinfuehrung|kampagne)\b/i,
        /\b(adoption|conversion|aktivierung|kanal|zielgruppe|distribution)\b/i,
      ],
      requiredSections: ['timelineMilestones', 'successCriteria', 'systemBoundaries'],
      minFeatureCount: 4,
      featureNameSignals: [
        /\b(launch|rollout|go[- ]to[- ]market|gtm|einfuehrung|markteinfuehrung|kampagne|kommunikation|stakeholder|readiness|enablement)\b/i,
        /\b(adoption|aktivierung|conversion|kanal|vertrieb|distribution|feedback|beta|release|checklist)\b/i,
      ],
      minFeatureSignalRatio: 0.35,
      disallowedFeatureNameSignals: [
        /\b(dark mode|theme|profil|profile|avatar|chat|social|friend|follower)\b/i,
      ],
      maxDisallowedFeatureRatio: 0.4,
    },
  },
  custom: {
    category: 'custom',
    labelEn: 'Custom PRD',
    labelDe: 'Custom-PRD',
    promptRulesEn: [
      'Keep the output aligned with the provided domain and user outcomes.',
    ],
    promptRulesDe: [
      'Halte die Ausgabe konsistent zum vorgegebenen Domain-Kontext und Nutzerergebnissen.',
    ],
    semanticSignals: {
      requiredAny: [],
      requiredSections: [],
    },
  },
  generic: {
    category: 'generic',
    labelEn: 'Generic PRD',
    labelDe: 'Generisches PRD',
    promptRulesEn: [
      'Keep output domain-consistent and implementation-ready.',
    ],
    promptRulesDe: [
      'Halte die Ausgabe domaein-konsistent und umsetzungsreif.',
    ],
    semanticSignals: {
      requiredAny: [],
      requiredSections: [],
    },
  },
};

const LEGACY_GENERIC_FALLBACKS = [
  'The product delivers clear user value for the defined audience and outcome.',
  'Das Produkt liefert einen klaren Nutzerwert fuer die definierte Zielgruppe und das Zielergebnis.',
  'The scope, runtime boundaries, and integrations are explicitly defined for this version.',
  'Scope, Laufzeitgrenzen und Integrationen sind fuer diese Version explizit definiert.',
  'Core entities, relationships, and constraints are defined in a deterministic way.',
  'Kernentitaeten, Beziehungen und Randbedingungen sind deterministisch beschrieben.',
  'Global rules define invariants and constraints across all feature workflows.',
  'Globale Regeln definieren Invarianten und Randbedingungen ueber alle Feature-Workflows.',
  'Performance, reliability, security, and accessibility requirements are explicitly documented.',
  'Performance-, Zuverlaessigkeits-, Sicherheits- und Accessibility-Anforderungen sind explizit dokumentiert.',
  'Failure handling, recovery behavior, and fallback expectations are documented.',
  'Fehlerbehandlung, Recovery-Verhalten und Fallback-Erwartungen sind dokumentiert.',
  'Runtime environment, deployment approach, and operational dependencies are described.',
  'Laufzeitumgebung, Deployment-Ansatz und operative Abhaengigkeiten sind beschrieben.',
  'The release is complete only when all required sections and acceptance criteria are fulfilled.',
  'Der Release ist erst abgeschlossen, wenn alle Pflichtabschnitte und Akzeptanzkriterien erfuellt sind.',
  'Items outside this release are explicitly listed to avoid scope creep.',
  'Elemente ausserhalb dieses Releases sind explizit gelistet, um Scope Creep zu vermeiden.',
  'Milestones and delivery phases are defined with realistic checkpoints.',
  'Meilensteine und Lieferphasen sind mit realistischen Checkpoints definiert.',
  'Success criteria and acceptance indicators are measurable and testable.',
  'Erfolgskriterien und Abnahmeindikatoren sind messbar und testbar.',
];

function normalizeForMatch(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_>#-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_LEGACY_FALLBACKS = new Set(LEGACY_GENERIC_FALLBACKS.map(normalizeForMatch));
const REQUIRED_SECTION_KEYS: RequiredSectionKey[] = [
  'systemVision',
  'systemBoundaries',
  'domainModel',
  'globalBusinessRules',
  'nonFunctional',
  'errorHandling',
  'deployment',
  'definitionOfDone',
  'outOfScope',
  'timelineMilestones',
  'successCriteria',
];
const FEATURE_STRING_FIELDS = [
  'purpose',
  'actors',
  'trigger',
  'preconditions',
  'postconditions',
  'dataImpact',
  'uiImpact',
] as const;
const FEATURE_ARRAY_FIELDS = [
  'mainFlow',
  'alternateFlows',
  'acceptanceCriteria',
] as const;
const HARD_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\b(?:todo|tbd|fixme)\b/gi,
  /\bto\s+be\s+defined\b/gi,
  /\bcoming\s+soon\b/gi,
  /\blorem\s+ipsum\b/gi,
  /\bn\/a\b/gi,
  /\b(?:replace|insert)\s+(?:me|this|here|with)\b/gi,
  /\b(?:einf(?:ue|ü)gen|ersetzen)\s+(?:hier|mit)\b/gi,
];
const BRACKET_TOKEN_REGEX = /\[[^\]\n]{1,140}\]|\{\{[^}\n]{1,140}\}\}/g;
const BRACKET_PLACEHOLDER_HINTS = [
  'placeholder',
  'todo',
  'tbd',
  'value proposition',
  'wertvorschlag',
  'feature name',
  'produktname',
  'company name',
  'unternehmen',
  'beispiel',
  'example',
  'sample',
  'insert',
  'replace',
  'einfuegen',
  'ersetzen',
];

function cleanSnippet(value: string, maxLength: number = 60): string {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function isLikelyReferenceToken(token: string): boolean {
  const value = String(token || '').trim();
  if (!value) return true;
  if (/^[xX ]$/.test(value)) return true;
  if (/^[A-Z0-9_.:/-]{1,18}$/.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
}

function collectPlaceholderTokens(value: string): string[] {
  const text = String(value || '');
  if (!text.trim()) return [];

  const hits = new Set<string>();
  for (const pattern of HARD_PLACEHOLDER_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(regex)) {
      const token = String(match[0] || '').trim();
      if (token) hits.add(token);
    }
  }

  for (const match of text.matchAll(BRACKET_TOKEN_REGEX)) {
    const rawToken = String(match[0] || '').trim();
    if (!rawToken) continue;

    if (rawToken.startsWith('[')) {
      const endIndex = Number(match.index || 0) + rawToken.length;
      const nextChar = text[endIndex] || '';
      // Ignore markdown links like [label](https://...).
      if (nextChar === '(') continue;
    }

    const inner = rawToken
      .replace(/^\[\s*|\s*\]$/g, '')
      .replace(/^\{\{\s*|\s*\}\}$/g, '')
      .trim();
    if (isLikelyReferenceToken(inner)) continue;

    const lower = inner.toLowerCase();
    const hasHint = BRACKET_PLACEHOLDER_HINTS.some(hint => lower.includes(hint));
    if (hasHint) {
      hits.add(rawToken);
    }
  }

  return Array.from(hits);
}

function safeWordsFromContext(contextHint?: string): string[] {
  return String(contextHint || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
    .slice(0, 8);
}

function sectionLabel(section: RequiredSectionKey, language: SupportedLanguage): string {
  const labelsEn: Record<RequiredSectionKey, string> = {
    systemVision: 'product vision and outcome',
    systemBoundaries: 'scope and operating boundaries',
    domainModel: 'domain entities and data contracts',
    globalBusinessRules: 'cross-feature invariants',
    nonFunctional: 'quality and reliability targets',
    errorHandling: 'failure and recovery behavior',
    deployment: 'runtime and infrastructure context',
    definitionOfDone: 'release acceptance definition',
    outOfScope: 'explicit exclusions',
    timelineMilestones: 'delivery plan and milestones',
    successCriteria: 'success criteria and acceptance evidence',
  };
  const labelsDe: Record<RequiredSectionKey, string> = {
    systemVision: 'Produktvision und Zielergebnis',
    systemBoundaries: 'Scope und Betriebsgrenzen',
    domainModel: 'Domain-Entitaeten und Datenvertraege',
    globalBusinessRules: 'uebergreifende Invarianten',
    nonFunctional: 'Qualitaets- und Zuverlaessigkeitsziele',
    errorHandling: 'Fehler- und Recovery-Verhalten',
    deployment: 'Laufzeit- und Infrastrukturkontext',
    definitionOfDone: 'Abnahmedefinition',
    outOfScope: 'explizite Ausschluesse',
    timelineMilestones: 'Lieferplan und Meilensteine',
    successCriteria: 'Erfolgskriterien und Abnahmebelege',
  };
  return language === 'de' ? labelsDe[section] : labelsEn[section];
}

function topFeatureNames(structure: PRDStructure): string[] {
  return (structure.features || [])
    .map(f => String(f.name || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function tokenizeScope(value: string): string[] {
  return normalizeForMatch(value)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4 && !STOP_WORDS.has(token));
}

function buildContextFragment(params: {
  structure: PRDStructure;
  contextHint?: string;
  language: SupportedLanguage;
}): string {
  const features = topFeatureNames(params.structure);
  if (features.length > 0) {
    if (params.language === 'de') {
      return `Kernfokus sind die Feature-Workflows "${features.join('", "')}".`;
    }
    return `Core scope centers on the feature workflows "${features.join('", "')}".`;
  }

  const contextWords = safeWordsFromContext(params.contextHint);
  if (contextWords.length > 0) {
    if (params.language === 'de') {
      return `Der Kontext umfasst insbesondere: ${contextWords.join(', ')}.`;
    }
    return `Context priorities include: ${contextWords.join(', ')}.`;
  }

  if (params.language === 'de') {
    return 'Der Abschnitt wird entlang der priorisierten Nutzer- und Lieferziele konkretisiert.';
  }
  return 'This section is concretized around prioritized user and delivery outcomes.';
}

export function normalizeTemplateCategory(value?: string | null): PrdTemplateCategory {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'feature') return 'feature';
  if (normalized === 'epic') return 'epic';
  if (normalized === 'technical') return 'technical';
  if (normalized === 'product-launch') return 'product-launch';
  if (normalized === 'custom') return 'custom';
  if (!normalized) return 'generic';
  return 'generic';
}

export function getTemplateProfile(category?: string | null): TemplateProfile {
  const normalized = normalizeTemplateCategory(category);
  return TEMPLATE_PROFILES[normalized] || TEMPLATE_PROFILES.generic;
}

export function buildTemplateInstruction(
  category: string | null | undefined,
  language: SupportedLanguage
): string {
  const profile = getTemplateProfile(category);
  const label = language === 'de' ? profile.labelDe : profile.labelEn;
  const rules = language === 'de' ? profile.promptRulesDe : profile.promptRulesEn;
  const prefix = language === 'de'
    ? `TEMPLATE-KONTEXT: ${label}.`
    : `TEMPLATE CONTEXT: ${label}.`;
  return `${prefix}\n- ${rules.join('\n- ')}`;
}

export function buildSectionFallback(params: {
  section: RequiredSectionKey;
  language: SupportedLanguage;
  category?: string | null;
  structure: PRDStructure;
  contextHint?: string;
}): string {
  const category = normalizeTemplateCategory(params.category);
  const section = params.section;
  const label = sectionLabel(section, params.language);
  const context = buildContextFragment({
    structure: params.structure,
    contextHint: params.contextHint,
    language: params.language,
  });
  const categoryLabel = params.language === 'de'
    ? TEMPLATE_PROFILES[category].labelDe
    : TEMPLATE_PROFILES[category].labelEn;

  if (params.language === 'de') {
    return `${label} ist fuer dieses ${categoryLabel} explizit beschrieben. ${context} ` +
      `Die Aussagen sind umsetzbar, testbar und fuer diese Version verbindlich.`;
  }

  return `${label} is explicitly defined for this ${categoryLabel}. ${context} ` +
    `Statements are implementation-ready, testable, and binding for this version.`;
}

export function isLegacyGenericFallback(value: string): boolean {
  return NORMALIZED_LEGACY_FALLBACKS.has(normalizeForMatch(value));
}

export function collectPlaceholderIssues(params: {
  structure: PRDStructure;
  mode: 'generate' | 'improve';
}): TemplateSemanticIssue[] {
  const scopeHits: Array<{ scope: string; token: string }> = [];
  const pushHits = (scope: string, value: unknown) => {
    const tokens = collectPlaceholderTokens(String(value || ''));
    for (const token of tokens) {
      scopeHits.push({
        scope,
        token: cleanSnippet(token),
      });
    }
  };

  for (const key of REQUIRED_SECTION_KEYS) {
    const value = String((params.structure as any)[key] || '').trim();
    if (!value) continue;
    pushHits(`section:${key}`, value);
  }

  pushHits('section:featureCatalogueIntro', params.structure.featureCatalogueIntro);

  for (const feature of params.structure.features || []) {
    const featureId = String(feature.id || '').trim() || 'feature';
    pushHits(`feature:${featureId}.name`, feature.name);

    for (const field of FEATURE_STRING_FIELDS) {
      pushHits(`feature:${featureId}.${field}`, (feature as any)[field]);
    }

    for (const field of FEATURE_ARRAY_FIELDS) {
      const values = Array.isArray((feature as any)[field]) ? (feature as any)[field] : [];
      for (const entry of values) {
        pushHits(`feature:${featureId}.${field}`, entry);
      }
    }
  }

  if (scopeHits.length === 0) return [];

  const sampled = scopeHits
    .slice(0, 6)
    .map(hit => `${hit.scope}="${hit.token}"`)
    .join('; ');
  const suffix = scopeHits.length > 6 ? ` (+${scopeHits.length - 6} more)` : '';

  return [
    {
      code: 'placeholder_content_detected',
      message: `Unresolved placeholder content detected: ${sampled}${suffix}.`,
      severity: 'error',
    },
  ];
}

export function collectTemplateSemanticIssues(params: {
  category?: string | null;
  structure: PRDStructure;
  content: string;
  mode: 'generate' | 'improve';
}): TemplateSemanticIssue[] {
  const category = normalizeTemplateCategory(params.category);
  const profile = TEMPLATE_PROFILES[category];
  if (!profile || category === 'generic' || category === 'custom') return [];

  const issues: TemplateSemanticIssue[] = [];
  const severity: 'error' | 'warning' = params.mode === 'generate' ? 'error' : 'warning';
  const hardSeverity: 'error' = 'error';
  const featureNames = (params.structure.features || [])
    .map(feature => String(feature.name || '').trim())
    .filter(Boolean);
  const combinedText = [
    params.content,
    params.structure.systemVision,
    params.structure.systemBoundaries,
    params.structure.timelineMilestones,
    params.structure.successCriteria,
    ...featureNames,
  ]
    .map(v => String(v || ''))
    .join('\n');

  for (const requiredSection of profile.semanticSignals.requiredSections) {
    const value = String((params.structure as any)[requiredSection] || '').trim();
    if (!value) continue;
    if (isLegacyGenericFallback(value)) {
      issues.push({
        code: `template_semantic_boilerplate_${requiredSection}`,
        message: `Section "${requiredSection}" contains generic boilerplate and is not template-specific.`,
        severity,
      });
    }
  }

  if (profile.semanticSignals.requiredAny.length > 0) {
    const matchedSignals = profile.semanticSignals.requiredAny.filter(rx => rx.test(combinedText)).length;
    if (matchedSignals < Math.min(2, profile.semanticSignals.requiredAny.length)) {
      issues.push({
        code: `template_semantic_signal_mismatch_${category}`,
        message: `Template semantic mismatch for "${category}": expected domain-specific signals are missing.`,
        severity,
      });
    }
  }

  const minFeatureCount = profile.semanticSignals.minFeatureCount || 0;
  if (minFeatureCount > 0 && featureNames.length < minFeatureCount) {
    issues.push({
      code: `template_semantic_feature_count_${category}`,
      message: `Template "${category}" expected at least ${minFeatureCount} features, got ${featureNames.length}.`,
      severity: params.mode === 'generate' ? 'warning' : 'warning',
    });
  }

  if (featureNames.length > 0 && (profile.semanticSignals.featureNameSignals || []).length > 0) {
    const matchedFeatureCount = featureNames.filter(name =>
      (profile.semanticSignals.featureNameSignals || []).some(signal => signal.test(name))
    ).length;
    const ratio = Math.max(0, Math.min(1, profile.semanticSignals.minFeatureSignalRatio || 0));
    const minRequired = Math.max(1, Math.ceil(featureNames.length * ratio));
    if (matchedFeatureCount < minRequired) {
      issues.push({
        code: `template_semantic_feature_signal_mismatch_${category}`,
        message: `Template "${category}" feature semantics mismatch: only ${matchedFeatureCount}/${featureNames.length} feature names contain required template-specific signals.`,
        severity: hardSeverity,
      });
    }
  }

  if (featureNames.length > 0 && (profile.semanticSignals.disallowedFeatureNameSignals || []).length > 0) {
    const disallowedCount = featureNames.filter(name =>
      (profile.semanticSignals.disallowedFeatureNameSignals || []).some(signal => signal.test(name))
    ).length;
    const maxRatio = Math.max(0, Math.min(1, profile.semanticSignals.maxDisallowedFeatureRatio ?? 1));
    const allowedCount = Math.floor(featureNames.length * maxRatio);
    if (disallowedCount > allowedCount) {
      if (category === 'feature') {
        issues.push({
          code: 'feature_scope_drift_detected',
          message: `Feature template scope drift detected: ${disallowedCount}/${featureNames.length} feature names look off-scope or structural/meta.`,
          severity: hardSeverity,
        });
      } else {
        issues.push({
          code: `template_semantic_disallowed_feature_signals_${category}`,
          message: `Template "${category}" mismatch: ${disallowedCount}/${featureNames.length} feature names appear generic or unrelated to template intent.`,
          severity: hardSeverity,
        });
      }
    }
  }

  if (category === 'feature' && featureNames.length >= 4) {
    const contextTokens = new Set<string>([
      ...tokenizeScope(String(params.structure.systemVision || '')),
      ...tokenizeScope(String(params.structure.systemBoundaries || '')),
      ...tokenizeScope(String(params.structure.domainModel || '')),
      ...tokenizeScope(String(params.structure.globalBusinessRules || '')),
    ]);

    if (contextTokens.size > 0) {
      let offScopeCount = 0;
      for (const featureName of featureNames) {
        const tokens = tokenizeScope(featureName);
        if (tokens.length === 0) continue;
        const overlap = tokens.some(token => contextTokens.has(token));
        if (!overlap) offScopeCount++;
      }

      if (offScopeCount >= Math.ceil(featureNames.length * 0.6)) {
        issues.push({
          code: 'feature_scope_drift_detected',
          message: `Feature scope drift detected: ${offScopeCount}/${featureNames.length} feature names do not align with core context tokens.`,
          severity: hardSeverity,
        });
      }
    }
  }

  return issues;
}
