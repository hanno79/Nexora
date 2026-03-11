/**
 * Author: rahn
 * Datum: 09.03.2026
 * Version: 1.0
 * Beschreibung: Regressionstests fuer die Provider-Fehlerdiagnostik
 */

// ÄNDERUNG 09.03.2026: Explizite 4xx-Erkennung und Modell-IDs mit Variantensuffixen absichern.

import { describe, expect, it } from 'vitest';
import { parseProviderFailureDiagnostics } from '../server/providerFailureDiagnostics';

describe('parseProviderFailureDiagnostics', () => {
  it('zaehlt generische provider errors nicht als provider4xx', () => {
    const diagnostics = parseProviderFailureDiagnostics([
      'All 2 configured AI models are temporarily unavailable.',
      '',
      'Failure summary: 2 provider errors',
      '',
      'Models tried:',
      '1. openai/gpt-4.1-mini: provider returned error',
      '2. nvidia/nemotron-3-nano-30b-a3b:free: provider error',
    ].join('\n'));

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.providerFailureCounts.provider4xx).toBe(0);
  });

  it('zaehlt nur explizite provider-4xx-Hinweise aus den Modellzeilen', () => {
    const diagnostics = parseProviderFailureDiagnostics([
      'All 2 configured AI models are temporarily unavailable.',
      '',
      'Models tried:',
      '1. nvidia/nemotron-3-nano-30b-a3b:free: Status: 429 Too Many Requests',
      '2. qwen/qwen3-coder:free: provider 4xx during request',
    ].join('\n'));

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.providerFailureCounts.provider4xx).toBe(2);
    expect(diagnostics?.providerFailedModels).toEqual([
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'qwen/qwen3-coder:free',
    ]);
  });

  it('liest explizite provider-4xx-Werte aus der Failure Summary', () => {
    const diagnostics = parseProviderFailureDiagnostics([
      'All 1 configured AI models are temporarily unavailable.',
      '',
      'Failure summary: 3 provider 4xx, 1 timed out',
      '',
      'Models tried:',
      '1. qwen/qwen3-coder:free: provider returned error',
    ].join('\n'));

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.providerFailureCounts.provider4xx).toBe(3);
    expect(diagnostics?.providerFailureCounts.timedOut).toBe(1);
  });
});