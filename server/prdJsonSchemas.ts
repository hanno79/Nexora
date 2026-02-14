import type { PRDStructure } from './prdStructure';

export interface SectionUpdateResult {
  sectionName: keyof PRDStructure;
  updatedContent: string;
}
