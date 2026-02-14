export interface FeatureSpec {
  id: string;
  name: string;
  rawContent: string;
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
