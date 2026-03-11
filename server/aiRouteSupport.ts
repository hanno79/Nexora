/*
Author: rahn
Datum: 08.03.2026
Version: 1.1
Beschreibung: Pure KI-Routen-Helfer fuer Statuscode-Mapping und Artefakt-Metrik-Anreicherung.
*/

// ÄNDERUNG 08.03.2026: DB-/Compiler-gebundene Helfer nach
// `aiRouteCompilerSupport.ts` verschoben, damit dieses Modul import-sicher bleibt.
// ÄNDERUNG 10.03.2026: Expliziten Smoke-Header fuer sichere Free-/Development-Defaults ergänzt.

import type { PrdQualityStatus } from './prdRunQuality';

export const SMOKE_FREE_ONLY_HEADER = 'x-smoke-free-only';

function readHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }

  return typeof value === 'string' ? value : undefined;
}

export function resolveAiPreferenceUserId(
  request: { headers?: Record<string, unknown> },
  userId: string | undefined,
): string | undefined {
  const smokeHeader = readHeaderValue(request.headers?.[SMOKE_FREE_ONLY_HEADER]);
  const shouldForceFreeDefaults = ['1', 'true', 'yes', 'on'].includes(
    smokeHeader?.trim().toLowerCase() || '',
  );

  return shouldForceFreeDefaults ? undefined : userId;
}

export function qualityStatusHttpCode(status: PrdQualityStatus): number {
  if (status === 'failed_quality') return 422;
  if (status === 'cancelled') return 409;
  if (status === 'failed_runtime') return 500;
  return 200;
}

function normalizeArtifactTimings(
  requestStartedAt: number,
  timings?: Record<string, unknown> | null,
): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (timings) {
    for (const [key, value] of Object.entries(timings)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = value;
      }
    }
  }
  normalized.routeDurationMs = Date.now() - requestStartedAt;
  return normalized;
}

export function withArtifactMetrics(params: {
  requestStartedAt: number;
  timings?: Record<string, unknown> | null;
  totalTokens?: number | null;
  stageData?: Record<string, unknown>;
}): Record<string, unknown> {
  const stageData = { ...(params.stageData || {}) };
  const timings = normalizeArtifactTimings(params.requestStartedAt, params.timings);
  if (Object.keys(timings).length > 0) {
    stageData.timings = timings;
  }
  if (typeof params.totalTokens === 'number' && Number.isFinite(params.totalTokens)) {
    stageData.totalTokens = params.totalTokens;
  }
  return stageData;
}
