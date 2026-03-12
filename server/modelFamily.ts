type TierLikeDefaults = {
  generator?: string;
  reviewer?: string;
  verifier?: string;
};

export interface VerifierModelResolution {
  requestedModel?: string;
  resolvedModel?: string;
  blockedFamilies: string[];
  requestedFamily?: string;
  resolvedFamily?: string;
  independent: boolean;
  overrideApplied: boolean;
  sameFamilyFallbackOnly: boolean;
}

function normalizeModelIdentifier(model: string | null | undefined): string | undefined {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.replace(/:free$/, '');
}

export function normalizeModelFamily(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || undefined;
}

// Meta-Router-Modelle (z.B. route-llm) waehlen intern verschiedene Backend-Modelle.
// Sie bilden keine echte "Familie" und sollten nicht von der Independence-Pruefung blockiert werden.
const META_ROUTER_FAMILY = 'meta-router';
const META_ROUTER_SLUGS = new Set(['route-llm']);

export function isMetaRouterFamily(family: string | null | undefined): boolean {
  return family === META_ROUTER_FAMILY;
}

export function getModelFamily(model: string | null | undefined): string | undefined {
  const normalized = normalizeModelIdentifier(model);
  if (!normalized) return undefined;

  const slug = normalized.includes('/')
    ? normalized.split('/').slice(-1)[0]
    : normalized;

  // Meta-Router-Modelle erhalten eine spezielle Familie
  if (META_ROUTER_SLUGS.has(slug)) return META_ROUTER_FAMILY;

  const tokens = slug.split(/[-_.]+/).filter(Boolean);
  if (tokens.length === 0) return undefined;

  if (tokens[0] === 'gpt' && tokens[1] === 'oss') return 'gpt-oss';

  const directFamily = [
    'claude',
    'gemini',
    'gemma',
    'gpt',
    'gpt-oss',
    'llama',
    'mistral',
    'qwen',
    'deepseek',
    'nemotron',
    'trinity',
    'minimax',
    'grok',
    'phi',
    'command',
    'jamba',
    'nova',
    'sonar',
    'kimi',
  ].find(family => tokens[0] === family);

  if (directFamily) return directFamily;
  return normalizeModelFamily(tokens[0]);
}

export function areModelsSameFamily(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftFamily = getModelFamily(left);
  const rightFamily = getModelFamily(right);
  return Boolean(leftFamily && rightFamily && leftFamily === rightFamily);
}

export function normalizeModelFamilyList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    values
      .map(entry => normalizeModelFamily(entry))
      .filter((entry): entry is string => Boolean(entry))
  ));
}

export function buildAvoidedModelFamilies(models: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    models
      .map(entry => getModelFamily(entry))
      .filter((entry): entry is string => Boolean(entry) && !isMetaRouterFamily(entry))
  ));
}

export function resolveIndependentVerifierModel(params: {
  generatorModel?: string | null;
  reviewerModel?: string | null;
  verifierModel?: string | null;
  fallbackChain?: Array<string | null | undefined>;
  tierDefaults?: TierLikeDefaults | null;
}): VerifierModelResolution {
  const requestedModel = normalizeModelIdentifier(params.verifierModel);
  const blockedFamilies = buildAvoidedModelFamilies([
    params.generatorModel,
    params.reviewerModel,
  ]);
  const blockedFamilySet = new Set(blockedFamilies);

  const candidates = Array.from(new Set([
    requestedModel,
    normalizeModelIdentifier(params.tierDefaults?.verifier),
    ...(params.fallbackChain || []).map(entry => normalizeModelIdentifier(entry)),
    normalizeModelIdentifier(params.tierDefaults?.reviewer),
    normalizeModelIdentifier(params.tierDefaults?.generator),
  ].filter((entry): entry is string => Boolean(entry))));

  const independentCandidate = candidates.find(candidate => {
    const family = getModelFamily(candidate);
    return Boolean(family && !blockedFamilySet.has(family));
  });

  const resolvedModel = independentCandidate ?? requestedModel ?? candidates[0] ?? undefined;
  const requestedFamily = requestedModel ? getModelFamily(requestedModel) : undefined;
  const resolvedFamily = resolvedModel ? getModelFamily(resolvedModel) : undefined;
  const independent = Boolean(resolvedFamily && !blockedFamilySet.has(resolvedFamily));
  const overrideApplied = Boolean(
    requestedModel
    && resolvedModel
    && requestedModel !== resolvedModel
  );

  return {
    requestedModel,
    resolvedModel,
    blockedFamilies,
    requestedFamily,
    resolvedFamily,
    independent,
    overrideApplied,
    sameFamilyFallbackOnly: Boolean(resolvedModel && !independent),
  };
}
