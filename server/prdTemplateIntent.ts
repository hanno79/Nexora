import type { PRDStructure } from './prdStructure';
import { normalizeForMatch as _normalizeForMatch } from './prdTextUtils';

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
  /** Template-specific fallback overrides. Only define where a template needs
   *  DIFFERENT fallback content than the base. Omitted keys use BASE_SECTION_FALLBACKS. */
  sectionFallbacks?: Partial<Record<RequiredSectionKey, {
    templateEn: string;
    templateDe: string;
  }>>;
  /** Template-specific hints for content quality review. */
  contentReviewHints?: {
    requiredSectionContent?: Partial<Record<RequiredSectionKey, RegExp[]>>;
    qualityWeights?: { specificity: number; uniqueness: number; depth: number };
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
        // ÄNDERUNG 07.03.2026: Zusätzliche generische Aktionsverben decken reale Feature-Namen
        // wie „Configure Session Lifetime“ oder „Change User Password“ im Feature-Template ab.
        /\b(create|update|delete|view|list|manage|sync|validate|import|export|register|capture|filter|sort|search|display|track|report|retrieve|configure|change|remove|send|revoke|reset|generate)\b/i,
        /(?:erstellen|bearbeiten|l[oö]schen|anzeigen|auflisten|verwalten|synchronisieren|validieren|import|export|anlegen|[aä]ndern|aktualisieren|konfigurieren|erfassen|registrieren|filtern|sortieren|suchen|speichern|laden)/i,
        /(?:verwaltung|erfassung|steuerung|anzeige|[uü]bersicht|konfiguration|synchronisation|validierung|registrierung|integration|automatisierung|authentifizierung|autorisierung|darstellung|speicherung|filterung|sortierung|suche|eingabe|ausgabe|berechnung|[aä]nderung|aktualisierung|benachrichtigung)/i,
        /\b(user|nutzer|workflow|prozess|task|aufgabe|freigabe|approval|notification|benachrichtigung|dashboard|profil|einstellung|daten|liste|tabelle|status|eintrag|bug|feature|idee)\b/i,
      ],
      minFeatureSignalRatio: 0.20,
      disallowedFeatureNameSignals: [
        /\b(system\s*vision|problem\s*statement|goals?(?:\s*&\s*success\s*metrics?)?|target\s*audience|user\s*stories|timeline|out\s*of\s*scope|definition\s*of\s*done|success\s*criteria)\b/i,
        /\b(part\s*[a-d]|section\s*[a-d]|review\s*feedback|iteration\s*\d+)\b/i,
      ],
      maxDisallowedFeatureRatio: 0.35,
    },
    contentReviewHints: {
      requiredSectionContent: {
        successCriteria: [/acceptance|akzeptanz|test/i, /feature|workflow/i],
        definitionOfDone: [/criteria|kriterien|review|test/i],
      },
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
    sectionFallbacks: {
      timelineMilestones: {
        templateEn: 'Delivery is structured in milestones with ownership:\n- Milestone 1: Foundation & data model — Owner: Backend team\n- Milestone 2: Core feature set ({features}) — Owner: Cross-functional\n- Milestone 3: Integration & dependencies — Owner: Platform team\n- Milestone 4: Acceptance & release — Owner: QA + Stakeholders\nEach milestone has defined entry/exit criteria and dependency gates.',
        templateDe: 'Lieferung ist in Meilensteine mit Verantwortung strukturiert:\n- Meilenstein 1: Grundlage & Datenmodell — Verantwortung: Backend-Team\n- Meilenstein 2: Kern-Feature-Set ({features}) — Verantwortung: Cross-funktional\n- Meilenstein 3: Integration & Abhaengigkeiten — Verantwortung: Plattform-Team\n- Meilenstein 4: Abnahme & Release — Verantwortung: QA + Stakeholder\nJeder Meilenstein hat definierte Entry-/Exit-Kriterien und Abhaengigkeits-Gates.',
      },
      outOfScope: {
        templateEn: 'The following are explicitly OUT OF SCOPE for this epic:\n- Features planned for later phases (post-MVP)\n- Cross-team dependencies not yet agreed upon\n- Extensions beyond the defined feature catalogue ({features})\n- Organizational or process changes outside the product scope',
        templateDe: 'Folgende Aspekte sind fuer dieses Epic explizit NICHT im Scope:\n- Features die fuer spaetere Phasen geplant sind (post-MVP)\n- Cross-Team-Abhaengigkeiten die noch nicht vereinbart sind\n- Erweiterungen ueber den definierten Feature-Katalog hinaus ({features})\n- Organisations- oder Prozessaenderungen ausserhalb des Produktscopes',
      },
    },
    contentReviewHints: {
      requiredSectionContent: {
        timelineMilestones: [/milestone|meilenstein|phase/i, /owner|verantwort/i],
        outOfScope: [/scope|phase|later|spaeter/i],
      },
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
      'Prefer explicit technical feature names such as gateway, routing, rate limiting, JWT key rotation, caching, circuit breaker, metrics, tracing, or deployment.',
      'At least 40% of feature names must contain technical intent terms (API, architecture, schema, integration, security, observability, deployment).',
    ],
    promptRulesDe: [
      'Betone Architektur, Datenmodell, Betriebssicherheit und Integrationsvertraege.',
      'Sicherheits-, Performance- und Observability-Anforderungen muessen explizit sein.',
      'Der Feature-Katalog soll technische Faehigkeiten abbilden, nicht generische Consumer-App-Flows.',
      'Bevorzuge explizite technische Feature-Namen wie Gateway, Routing, Rate Limiting, JWT-Key-Rotation, Caching, Circuit Breaker, Metriken, Tracing oder Deployment.',
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
        // ÄNDERUNG 07.03.2026: Reale technische Smoke-Features nutzen oft
        // Gateway-/Routing-/Rate-Limit-/Caching-/JWT-/Circuit-Breaker-Begriffe.
        /\b(api|schnittstelle|gateway|proxy|routing|router|architektur|architecture|schema|datenmodell|database|migration|integrat(?:ion|ions?)|vertrag|contract|jwt|rbac|oauth|authentifizier(?:ung|en)|authentication|cache|caching|ttl|rate[- ]?limit(?:ing)?|throttl(?:e|ing)|circuit[- ]?breaker|retry|failover|load[- ]?balanc(?:e|ing)|idempoten(?:t|z|cy))\b/i,
        /\b(sicherheit|security|performance|latenz|reliability|zuverlaessigkeit|observability|monitoring|metrics|metriken|telemetry|telemetrie|tracing|alerting|deployment|infrastruktur)\b/i,
      ],
      minFeatureSignalRatio: 0.4,
      disallowedFeatureNameSignals: [
        /\b(dark mode|theme|profil|profile|benutzerprofil|social|like|follow)\b/i,
      ],
      maxDisallowedFeatureRatio: 0.4,
    },
    sectionFallbacks: {
      nonFunctional: {
        templateEn: 'Performance: API latency p95 < 200ms, throughput > 100 req/s.\nReliability: 99.9% uptime SLA, automated failover.\nSecurity: OWASP Top 10 mitigated, TLS 1.3, secrets management.\nObservability: Structured logging, distributed tracing, alerting on error rate > 1%.\nScalability: Horizontal scaling for stateless services, connection pooling for DB.',
        templateDe: 'Performance: API-Latenz p95 < 200ms, Durchsatz > 100 req/s.\nZuverlaessigkeit: 99.9% Uptime-SLA, automatisches Failover.\nSicherheit: OWASP Top 10 mitigiert, TLS 1.3, Secrets-Management.\nObservability: Strukturiertes Logging, Distributed Tracing, Alerting bei Fehlerrate > 1%.\nSkalierbarkeit: Horizontale Skalierung fuer stateless Services, Connection Pooling fuer DB.',
      },
    },
    contentReviewHints: {
      requiredSectionContent: {
        nonFunctional: [/latency|latenz|throughput|durchsatz|p\d{2}/i, /security|sicherheit/i],
        deployment: [/architecture|architektur|infrastructure|infrastruktur/i],
      },
      qualityWeights: { specificity: 30, uniqueness: 30, depth: 40 },
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
    sectionFallbacks: {
      successCriteria: {
        templateEn: 'Launch is successful when:\n- Feature adoption rate reaches target within 30 days post-launch\n- User activation funnel shows > 40% completion from signup to first action\n- Stakeholder sign-off on all launch-critical features ({features})\n- Support ticket volume stays below defined threshold\n- No P0/P1 bugs reported in the first 7 days post-launch',
        templateDe: 'Der Launch ist erfolgreich wenn:\n- Feature-Adoptionsrate innerhalb von 30 Tagen nach Launch das Ziel erreicht\n- Nutzer-Aktivierungs-Funnel zeigt > 40% Abschluss von Registrierung bis erste Aktion\n- Stakeholder-Abnahme aller launch-kritischen Features ({features})\n- Support-Ticketvolumen bleibt unter definierter Schwelle\n- Keine P0/P1-Bugs in den ersten 7 Tagen nach Launch',
      },
      timelineMilestones: {
        templateEn: 'Launch timeline:\n- Pre-Launch: Feature freeze, QA, stakeholder review\n- Soft Launch: Limited rollout to beta users, collect feedback\n- General Availability: Full rollout with marketing support\n- Post-Launch: Monitor KPIs, address feedback, iterate\nFeatures in scope: {features}',
        templateDe: 'Launch-Zeitplan:\n- Pre-Launch: Feature-Freeze, QA, Stakeholder-Review\n- Soft Launch: Begrenzter Rollout an Beta-Nutzer, Feedback sammeln\n- General Availability: Vollstaendiger Rollout mit Marketing-Unterstuetzung\n- Post-Launch: KPIs monitoren, Feedback adressieren, iterieren\nFeatures im Scope: {features}',
      },
    },
    contentReviewHints: {
      requiredSectionContent: {
        successCriteria: [/adoption|aktivierung|conversion|launch/i, /metric|kpi|messung/i],
        timelineMilestones: [/launch|rollout|beta/i, /stakeholder/i],
      },
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

const normalizeForMatch = _normalizeForMatch;

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
  /\bTODO\b/gi,
  /\bTBD\b/gi,
  /\bFIXME\b/gi,
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
    .map(f => {
      const id = String(f.id || '').trim();
      const name = String(f.name || '').trim();
      // Return "F-XX: Name" format for precise references
      return id && name ? `${id}: ${name}` : name || id;
    })
    .filter(Boolean)
    .slice(0, 10);
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

// ---------------------------------------------------------------------------
// Section-specific base fallback templates.
// Each section has its OWN distinct template structure.
// Templates can use {features} placeholder (replaced with top feature names).
// Template-specific overrides in TemplateProfile.sectionFallbacks take priority.
// ---------------------------------------------------------------------------

type FallbackTemplatePair = { templateEn: string; templateDe: string };

const BASE_SECTION_FALLBACKS: Record<RequiredSectionKey, FallbackTemplatePair> = {
  systemVision: {
    templateEn: 'The product provides a clearly defined capability for its target users, enabling them to {context} with measurable impact.',
    templateDe: 'Das Produkt bietet eine klar definierte Faehigkeit fuer seine Zielnutzer, die es ihnen ermoeglicht, {context} mit messbarem Mehrwert zu nutzen.',
  },
  systemBoundaries: {
    templateEn: 'The system operates within the following boundaries:\n- Deployment: Web application\n- Runtime: Browser-based client with server backend\n- Persistence: Database-backed with defined data model\n- Integrations: As defined in the feature catalogue ({features})',
    templateDe: 'Das System operiert innerhalb folgender Grenzen:\n- Deployment: Webanwendung\n- Laufzeit: Browser-basierter Client mit Server-Backend\n- Persistenz: Datenbankgestuetzt mit definiertem Datenmodell\n- Integrationen: Wie im Feature-Katalog definiert ({features})',
  },
  domainModel: {
    templateEn: 'Core entities are derived from the feature catalogue ({features}). Each entity has defined relationships, constraints, and lifecycle rules documented in the feature specifications.',
    templateDe: 'Kernentitaeten leiten sich aus dem Feature-Katalog ab ({features}). Jede Entitaet hat definierte Beziehungen, Randbedingungen und Lebenszyklusregeln, die in den Feature-Spezifikationen dokumentiert sind.',
  },
  globalBusinessRules: {
    templateEn: 'The following invariants apply across all features:\n- Data consistency: All mutations are atomic and validated before persistence\n- Authorization: Actions are scoped to the authenticated user context\n- Error handling: Failures produce clear feedback without side effects',
    templateDe: 'Folgende Invarianten gelten uebergreifend fuer alle Features:\n- Datenkonsistenz: Alle Mutationen sind atomar und vor der Persistierung validiert\n- Autorisierung: Aktionen sind auf den authentifizierten Nutzerkontext beschraenkt\n- Fehlerbehandlung: Fehler erzeugen klare Rueckmeldungen ohne Seiteneffekte',
  },
  nonFunctional: {
    templateEn: 'Performance: Page load < 3s, API responses < 500ms.\nReliability: System recovers gracefully from transient failures.\nAccessibility: WCAG 2.1 AA compliance for all user-facing features.\nSecurity: Input validation, authentication, and authorization enforced on all endpoints.',
    templateDe: 'Performance: Seitenladezeit < 3s, API-Antworten < 500ms.\nZuverlaessigkeit: System erholt sich von transienten Fehlern ohne Datenverlust.\nBarrierefreiheit: WCAG 2.1 AA fuer alle nutzersichtbaren Features.\nSicherheit: Eingabevalidierung, Authentifizierung und Autorisierung auf allen Endpunkten.',
  },
  errorHandling: {
    templateEn: 'Error handling follows these principles:\n- Validation errors: Return field-level messages before any mutation\n- Network failures: Retry with exponential backoff, surface timeout after 3 attempts\n- Server errors: Log details server-side, show user-friendly message client-side\n- Data conflicts: Detect and report without silent overwrites',
    templateDe: 'Fehlerbehandlung folgt diesen Prinzipien:\n- Validierungsfehler: Feldspezifische Meldungen vor jeder Mutation\n- Netzwerkfehler: Retry mit exponentiellem Backoff, Timeout nach 3 Versuchen\n- Serverfehler: Details serverseitig loggen, nutzerfreundliche Meldung clientseitig\n- Datenkonflikte: Erkennen und melden ohne stilles Ueberschreiben',
  },
  deployment: {
    templateEn: 'The application is deployed as a web service with:\n- Frontend: Single-page application served via CDN\n- Backend: API server with database connectivity\n- Environment: Development, Staging, Production\n- CI/CD: Automated build, test, and deployment pipeline',
    templateDe: 'Die Anwendung wird als Webservice deployed mit:\n- Frontend: Single-Page-Applikation via CDN\n- Backend: API-Server mit Datenbankanbindung\n- Umgebungen: Development, Staging, Production\n- CI/CD: Automatisierte Build-, Test- und Deployment-Pipeline',
  },
  definitionOfDone: {
    templateEn: 'A feature is complete when:\n- All acceptance criteria from the feature specification pass\n- Code review approved with no open blockers\n- Automated tests cover the main flow and key error paths\n- Documentation updated for user-facing changes\n- No critical or high-severity bugs remain open for: {features}',
    templateDe: 'Ein Feature gilt als abgeschlossen wenn:\n- Alle Akzeptanzkriterien aus der Feature-Spezifikation bestanden sind\n- Code-Review ohne offene Blocker abgeschlossen ist\n- Automatisierte Tests den Hauptfluss und wichtige Fehlerpfade abdecken\n- Dokumentation fuer nutzersichtbare Aenderungen aktualisiert ist\n- Keine kritischen oder hohen Bugs offen sind fuer: {features}',
  },
  outOfScope: {
    templateEn: 'The following are explicitly OUT OF SCOPE for this version:\n- Features and extensions beyond the defined catalogue ({features})\n- Integrations not specified in System Boundaries\n- Performance optimization beyond the stated NFR targets\n- Migration of legacy data from external systems',
    templateDe: 'Folgende Aspekte sind fuer diese Version explizit NICHT im Scope:\n- Features und Erweiterungen ueber den definierten Katalog hinaus ({features})\n- Integrationen, die nicht in den System Boundaries definiert sind\n- Performance-Optimierung ueber die definierten NFR-Ziele hinaus\n- Migration von Altdaten aus externen Systemen',
  },
  timelineMilestones: {
    templateEn: 'Delivery is structured in phases:\n- Phase 1 (Foundation): Core infrastructure and data model setup\n- Phase 2 (Core Features): Implementation of {features}\n- Phase 3 (Refinement): Testing, bug fixes, and acceptance review\nEach phase includes development, testing, and stakeholder review.',
    templateDe: 'Die Lieferung ist in Phasen strukturiert:\n- Phase 1 (Grundlage): Kerninfrastruktur und Datenmodell-Setup\n- Phase 2 (Kern-Features): Umsetzung von {features}\n- Phase 3 (Verfeinerung): Testing, Bugfixes und Abnahme-Review\nJede Phase umfasst Entwicklung, Testing und Stakeholder-Review.',
  },
  successCriteria: {
    templateEn: 'The project is successful when:\n- All features from the catalogue are implemented and accepted by stakeholders\n- Acceptance criteria for each feature (as defined in F-XX specs) pass\n- No critical bugs remain open at release\n- Users can complete the core workflows ({features}) end-to-end without assistance',
    templateDe: 'Das Projekt ist erfolgreich wenn:\n- Alle Features aus dem Katalog implementiert und von Stakeholdern abgenommen sind\n- Akzeptanzkriterien je Feature (wie in F-XX Specs definiert) bestanden sind\n- Keine kritischen Bugs zum Release offen sind\n- Nutzer die Kern-Workflows ({features}) Ende-zu-Ende ohne Hilfe durchfuehren koennen',
  },
};

function resolveFallbackTemplate(
  section: RequiredSectionKey,
  language: SupportedLanguage,
  category: PrdTemplateCategory
): string {
  // 1. Check template-specific override
  const profile = TEMPLATE_PROFILES[category] || TEMPLATE_PROFILES.generic;
  const override = profile.sectionFallbacks?.[section];
  if (override) {
    return language === 'de' ? override.templateDe : override.templateEn;
  }
  // 2. Use base fallback (each section has its own distinct template)
  const base = BASE_SECTION_FALLBACKS[section];
  return language === 'de' ? base.templateDe : base.templateEn;
}

export function buildSectionFallback(params: {
  section: RequiredSectionKey;
  language: SupportedLanguage;
  category?: string | null;
  structure: PRDStructure;
  contextHint?: string;
}): string {
  const category = normalizeTemplateCategory(params.category);
  const features = topFeatureNames(params.structure);
  const featuresStr = features.length > 0 ? features.join(', ') : '(Features)';

  let template = resolveFallbackTemplate(params.section, params.language, category);

  // Replace {features} placeholder with actual feature names
  template = template.replace(/\{features\}/g, featuresStr);

  // Replace {context} placeholder with context words
  const contextWords = safeWordsFromContext(params.contextHint);
  const contextStr = contextWords.length > 0
    ? contextWords.join(', ')
    : featuresStr;
  template = template.replace(/\{context\}/g, contextStr);

  return template;
}

export function isLegacyGenericFallback(value: string): boolean {
  return NORMALIZED_LEGACY_FALLBACKS.has(normalizeForMatch(value));
}

// Regex patterns matching the OLD buildSectionFallback one-size-fits-all template
const COMPILER_FALLBACK_PATTERNS: RegExp[] = [
  /is explicitly defined for this .+\.\s*(?:Core scope centers on|Context priorities include|This section is concretized).+Statements are implementation-ready,? testable,? and binding for this version\./i,
  /ist f(?:ue|ü)r dieses .+explizit beschrieben\.\s*(?:Kernfokus sind die Feature-Workflows|Der Kontext umfasst|Der Abschnitt wird).+Die Aussagen sind umsetzbar,? testbar und f(?:ue|ü)r diese Version verbindlich\./i,
];

/** Detects both legacy static fallbacks AND the old compiler-generated fallback template. */
export function isGenericFallback(value: string): boolean {
  if (isLegacyGenericFallback(value)) return true;
  const text = String(value || '').trim();
  return COMPILER_FALLBACK_PATTERNS.some(pattern => pattern.test(text));
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
    if (isGenericFallback(value)) {
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
