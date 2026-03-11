/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Unit-Tests fuer extrahierte KI-Routen-Helfer.
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer Statuscode-Mapping und Artefakt-Metrik-Anreicherung nach Routen-Split ergänzt.
// ÄNDERUNG 10.03.2026: Smoke-Header-Regression fuer reproduzierbare Free-Only-AI-Defaults ergänzt.

import { describe, expect, it, vi } from 'vitest';
import {
  qualityStatusHttpCode,
  resolveAiPreferenceUserId,
  SMOKE_FREE_ONLY_HEADER,
  withArtifactMetrics,
} from '../server/aiRouteSupport';

describe('aiRouteSupport', () => {
  it('mappt Quality-Status konservativ auf die erwarteten HTTP-Statuscodes', () => {
    expect(qualityStatusHttpCode('passed')).toBe(200);
    expect(qualityStatusHttpCode('failed_quality')).toBe(422);
    expect(qualityStatusHttpCode('cancelled')).toBe(409);
    expect(qualityStatusHttpCode('failed_runtime')).toBe(500);
  });

  it('reichert Stage-Daten um normierte Laufzeit- und Token-Metriken an', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T10:00:05.000Z'));

    const result = withArtifactMetrics({
      requestStartedAt: new Date('2026-03-08T10:00:00.000Z').getTime(),
      timings: { upstreamMs: 120, ignored: 'x' as any },
      totalTokens: 321,
      stageData: { phase: 'final' },
    });

    expect(result).toEqual({
      phase: 'final',
      timings: {
        upstreamMs: 120,
        routeDurationMs: 5000,
      },
      totalTokens: 321,
    });

    vi.useRealTimers();
  });

  it('erzwingt per explizitem Smoke-Header sichere Default-Modelle statt DB-Praeferenzen', () => {
    expect(resolveAiPreferenceUserId({
      headers: { [SMOKE_FREE_ONLY_HEADER]: 'true' },
    }, 'user-1')).toBeUndefined();
  });

  it('laesst normale Requests weiter mit der echten User-Praeferenz laufen', () => {
    expect(resolveAiPreferenceUserId({ headers: {} }, 'user-1')).toBe('user-1');
  });
});