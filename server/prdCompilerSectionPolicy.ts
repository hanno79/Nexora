/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Required-Section- und Section-Depth-Policies fuer den PRD-Compiler.
*/

// ÄNDERUNG 08.03.2026: Required-Section-/Depth-Helfer aus `server/prdCompiler.ts` als fuenfter risikoarmer Phase-2-Minimalsplit extrahiert.

import { mergeSectionWithPreservation, type RequiredSectionDefinition } from './prdCompilerMerge';
import type { PRDStructure } from './prdStructure';
import { buildSectionFallback, type RequiredSectionKey } from './prdTemplateIntent';
import { hasText } from './prdTextUtils';

type SupportedLanguage = 'de' | 'en';

interface SectionPolicyContext {
  templateCategory?: string;
  contextHint?: string;
}

export function ensurePrdRequiredSectionsInternal(
  structure: PRDStructure,
  language: SupportedLanguage,
  requiredSectionDefs: RequiredSectionDefinition[],
  context?: SectionPolicyContext
): { structure: PRDStructure; addedSections: string[] } {
  const updated: PRDStructure = {
    ...structure,
    otherSections: { ...(structure.otherSections || {}) },
    features: [...(structure.features || [])],
  };
  const addedSections: string[] = [];

  for (const def of requiredSectionDefs) {
    if (hasText(updated[def.key])) continue;
    (updated as any)[def.key] = buildSectionFallback({
      section: def.key as RequiredSectionKey,
      language,
      category: context?.templateCategory,
      structure: updated,
      contextHint: context?.contextHint,
    }) || (language === 'de' ? def.fallbackDe : def.fallbackEn);
    addedSections.push(def.label);
  }

  return { structure: updated, addedSections };
}

export function ensurePrdSectionDepthInternal(
  structure: PRDStructure,
  language: SupportedLanguage,
  requiredSectionDefs: RequiredSectionDefinition[],
  minRequiredSectionLength: number,
  context?: SectionPolicyContext
): { structure: PRDStructure; expandedSections: string[] } {
  const updated: PRDStructure = {
    ...structure,
    otherSections: { ...(structure.otherSections || {}) },
    features: [...(structure.features || [])],
  };
  const expandedSections: string[] = [];

  for (const def of requiredSectionDefs) {
    const currentValue = String(updated[def.key] || '').trim();
    if (!currentValue || currentValue.length >= minRequiredSectionLength) continue;

    const fallback = buildSectionFallback({
      section: def.key as RequiredSectionKey,
      language,
      category: context?.templateCategory,
      structure: updated,
      contextHint: context?.contextHint,
    }) || (language === 'de' ? def.fallbackDe : def.fallbackEn);
    const merged = mergeSectionWithPreservation(currentValue, fallback);
    if (merged.length > currentValue.length) {
      (updated as any)[def.key] = merged;
      expandedSections.push(def.label);
    }
  }

  return { structure: updated, expandedSections };
}