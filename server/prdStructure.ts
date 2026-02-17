export interface FeatureSpec {
  id: string;
  name: string;

  rawContent: string;

  purpose?: string;
  actors?: string;
  trigger?: string;
  preconditions?: string;
  mainFlow?: string[];
  alternateFlows?: string[];
  postconditions?: string;
  dataImpact?: string;
  uiImpact?: string;
  acceptanceCriteria?: string[];
}

export const STRUCTURED_FIELD_NAMES = [
  'purpose', 'actors', 'trigger', 'preconditions',
  'mainFlow', 'alternateFlows', 'postconditions',
  'dataImpact', 'uiImpact', 'acceptanceCriteria',
] as const;

export type StructuredFieldName = typeof STRUCTURED_FIELD_NAMES[number];

export interface FeatureCompleteness {
  featureId: string;
  featureName: string;
  filledFields: number;
  totalFields: 10;
  missingFields: string[];
  isComplete: boolean;
}

export interface PRDStructureMetadata {
  featureCount: number;
  completeFeatures: number;
  averageCompleteness: number;
  featureDetails: FeatureCompleteness[];
}

export interface PRDStructure {
  systemVision?: string;
  systemBoundaries?: string;
  domainModel?: string;
  globalBusinessRules?: string;
  featureCatalogueIntro?: string;
  features: FeatureSpec[];
  nonFunctional?: string;
  errorHandling?: string;
  deployment?: string;
  definitionOfDone?: string;
  otherSections: Record<string, string>;
}
