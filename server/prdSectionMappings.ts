/**
 * PRD Section Mappings
 * Author: rahn
 * Datum: 04.03.2026
 * Version: 1.0
 * Beschreibung: Mapping-Tabellen für PRD Sections
 */

import type { PRDStructure } from './prdStructure';

export const KNOWN_SECTION_MAP: Record<string, keyof PRDStructure> = {
  'system vision': 'systemVision',
  'executive summary': 'systemVision',
  'vision': 'systemVision',
  'system boundaries': 'systemBoundaries',
  'boundaries': 'systemBoundaries',
  'scope': 'systemBoundaries',
  'system scope': 'systemBoundaries',
  'domain model': 'domainModel',
  'data model': 'domainModel',
  'domain': 'domainModel',
  'global business rules': 'globalBusinessRules',
  'business rules': 'globalBusinessRules',
  'non-functional requirements': 'nonFunctional',
  'non functional requirements': 'nonFunctional',
  'nfr': 'nonFunctional',
  'quality attributes': 'nonFunctional',
  'error handling': 'errorHandling',
  'error handling & recovery': 'errorHandling',
  'error handling and recovery': 'errorHandling',
  'deployment': 'deployment',
  'deployment & infrastructure': 'deployment',
  'deployment and infrastructure': 'deployment',
  'infrastructure': 'deployment',
  'definition of done': 'definitionOfDone',
  'done criteria': 'definitionOfDone',
  'out of scope': 'outOfScope',
  'timeline & milestones': 'timelineMilestones',
  'timeline and milestones': 'timelineMilestones',
  'timeline': 'timelineMilestones',
  'success criteria & acceptance testing': 'successCriteria',
  'success criteria and acceptance testing': 'successCriteria',
  'success criteria': 'successCriteria',
  'acceptance testing': 'successCriteria',
};

export const FEATURE_CATALOGUE_HEADINGS: string[] = [
  'functional feature catalogue',
  'feature catalogue',
  'features',
  'functional requirements',
  'feature specifications',
  'must-have features',
  'must have features',
  'nice-to-have features',
  'nice to have features',
  'core features',
  'required features',
];

export const FEATURE_CATALOGUE_INTRO_HEADINGS: string[] = [
  'user stories',
  'nutzergeschichten',
];

export function resolveTemplateAliasTarget(normalizedHeading: string): keyof PRDStructure | null {
  const headingForMatch = normalizedHeading
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    /(^|\b)part\s*a(\b|$)|(^|\b)system\s*context(\b|$)/i.test(headingForMatch) ||
    /^(?:product\s+overview|executive\s+summary|vision\s+(?:and|&)\s+strategy|value\s+proposition|overview)$/i.test(headingForMatch)
  ) {
    return 'systemVision';
  }

  if (
    /(^|\b)part\s*c(\b|$)|(^|\b)technical\s*(?:and|&)\s*design\s*context(\b|$)/i.test(headingForMatch) ||
    /(^|\b)technical\s+requirements?(\b|$)|(^|\b)proposed\s+solution(\b|$)|(^|\b)implementation\s+details?(\b|$)|(^|\b)architecture\s+diagram(\b|$)|(^|\b)architecture\s+overview(\b|$)|(^|\b)rollout\s+plan(\b|$)|(^|\b)go\s+to\s+market\s+strategy(\b|$)/i.test(headingForMatch)
  ) {
    return 'deployment';
  }

  if (/(^|\b)part\s*d(\b|$)|(^|\b)planning\s*(?:and|&)\s*risk(\b|$)/i.test(headingForMatch)) {
    return 'timelineMilestones';
  }

  if (
    /(^|\b)dependencies?\s*(?:and|&)\s*risks?(\b|$)|(^|\b)dependencies?(\b|$)|(^|\b)risks?\s*(?:and|&)\s*mitigation(\b|$)|(^|\b)risk\s+mitigation(\b|$)/i.test(
      headingForMatch
    )
  ) {
    return 'errorHandling';
  }

  if (/(^|\b)problem\s*statement(\b|$)|(^|\b)problemstellung(\b|$)/i.test(normalizedHeading)) {
    return 'systemVision';
  }
  if (
    /(^|\b)goals?\s*(?:&|and)\s*success\s*metrics?(\b|$)|(^|\b)ziele?\s*(?:&|und)\s*(?:erfolgsmetriken|success\s*metrics?)(\b|$)/i.test(
      headingForMatch
    )
  ) {
    return 'successCriteria';
  }
  if (
    /(^|\b)target\s*(?:audience|users?)\b|(^|\b)user\s*personas?(\b|$)|(^|\b)zielgruppe(\b|$)|(^|\b)persona?s?(\b|$)/i.test(
      headingForMatch
    )
  ) {
    return 'systemBoundaries';
  }
  if (
    /(^|\b)user\s*interface\s*guidelines?(\b|$)|(^|\b)ui\s*guidelines?(\b|$)|(^|\b)ux\s*guidelines?(\b|$)|(^|\b)benutzeroberfl[aä]chen?\s*richtlinien(\b|$)/i.test(
      headingForMatch
    )
  ) {
    return 'nonFunctional';
  }
  if (
    /(^|\b)goals?\s*(?:&|and)\s*objectives?(\b|$)|(^|\b)success\s*metrics?(\b|$)|(^|\b)kpis?(\b|$)|(^|\b)roadmap(\b|$)|(^|\b)testing\s+strategy(\b|$)/i.test(
      headingForMatch
    )
  ) {
    return 'successCriteria';
  }
  return null;
}
