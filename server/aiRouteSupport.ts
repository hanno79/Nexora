/*
Author: rahn
Datum: 08.03.2026
Version: 1.1
Beschreibung: Pure KI-Routen-Helfer fuer Statuscode-Mapping und Artefakt-Metrik-Anreicherung.
*/

// ÄNDERUNG 08.03.2026: DB-/Compiler-gebundene Helfer nach
// `aiRouteCompilerSupport.ts` verschoben, damit dieses Modul import-sicher bleibt.

import type { PrdQualityStatus } from './prdRunQuality';

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
