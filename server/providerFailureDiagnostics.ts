/**
 * Author: rahn
 * Datum: 09.03.2026
 * Version: 1.1
 * Beschreibung: Parser fuer Provider-Fehlerdiagnostik aus Laufzeitfehlern
 */

export type RuntimeFailureCode = 'provider_exhaustion' | 'provider_auth' | 'provider_unavailable';

export type ProviderFailureStage =
  | 'compiler_repair'
  | 'content_review'
  | 'semantic_repair'
  | 'semantic_verification'
  | 'final_review';

export interface ProviderFailureCounts {
  rateLimited: number;
  timedOut: number;
  provider4xx: number;
  emptyResponse: number;
}

export interface ProviderFailureDiagnostics {
  runtimeFailureCode: RuntimeFailureCode;
  providerFailureSummary: string;
  providerFailureCounts: ProviderFailureCounts;
  providerFailedModels: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCount(source: string, pattern: RegExp): number {
  const match = source.match(pattern);
  if (!match) return 0;
  const count = Number.parseInt(match[1] || '', 10);
  return Number.isFinite(count) ? count : 0;
}

// ÄNDERUNG 09.03.2026: `provider4xx` nur noch bei expliziten 4xx-Hinweisen zaehlen.
function hasExplicitProvider4xx(text: string): boolean {
  return /\bstatus:\s*4\d\d(?:\b|$)/i.test(text) || /\bprovider\s+4xx\b/i.test(text);
}

function extractTriedModelLines(message: string): string[] {
  const lines = message.split(/\r?\n/);
  const markerIndex = lines.findIndex(line => /^models tried:/i.test(line.trim()));
  const candidateLines = markerIndex >= 0 ? lines.slice(markerIndex + 1) : lines;
  return candidateLines
    .map(line => line.trim())
    .filter(line => /^\d+\.\s+/.test(line));
}

function summarizeCounts(counts: ProviderFailureCounts): string {
  const parts: string[] = [];
  if (counts.rateLimited > 0) parts.push(`${counts.rateLimited} rate-limited`);
  if (counts.timedOut > 0) parts.push(`${counts.timedOut} timed out`);
  if (counts.provider4xx > 0) parts.push(`${counts.provider4xx} provider 4xx`);
  if (counts.emptyResponse > 0) parts.push(`${counts.emptyResponse} empty response`);
  return parts.join(', ');
}

function isProviderFailureLine(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('rate limit')
    || normalized.includes('timed out')
    || normalized.includes('timeout')
    || normalized.includes('provider returned error')
    || normalized.includes('provider error')
    || hasExplicitProvider4xx(normalized)
    || normalized.includes('temporarily unavailable')
    || normalized.includes('temporarily limited')
    || normalized.includes('unauthorized')
    || normalized.includes('invalid api key')
    || normalized.includes('empty response')
    || normalized.includes('returned no content')
  );
}

export function parseProviderFailureDiagnostics(message: string): ProviderFailureDiagnostics | null {
  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) return null;

  const lower = normalizedMessage.toLowerCase();
  const triedModelLines = extractTriedModelLines(normalizedMessage);
  const looksLikeProviderFailure =
    /all\s+\d+\s+configured ai models/i.test(normalizedMessage)
    || lower.includes('failure summary:')
    || triedModelLines.some(isProviderFailureLine);

  if (!looksLikeProviderFailure) return null;

  const summaryMatch = normalizedMessage.match(/failure summary:\s*(.+?)(?:\n|$)/i);
  const summaryText = summaryMatch ? normalizeWhitespace(summaryMatch[1]) : '';

  const lineCounts = triedModelLines.reduce<ProviderFailureCounts>((acc, line) => {
    const normalized = line.toLowerCase();
    if (normalized.includes('rate limit')) {
      acc.rateLimited += 1;
    } else if (normalized.includes('timed out') || normalized.includes('timeout')) {
      acc.timedOut += 1;
    } else if (normalized.includes('empty response') || normalized.includes('returned no content')) {
      acc.emptyResponse += 1;
    } else if (hasExplicitProvider4xx(normalized)) {
      acc.provider4xx += 1;
    }
    return acc;
  }, {
    rateLimited: 0,
    timedOut: 0,
    provider4xx: 0,
    emptyResponse: 0,
  });

  const providerFailureCounts: ProviderFailureCounts = {
    rateLimited: parseCount(summaryText, /(\d+)\s+rate-limited/i) || lineCounts.rateLimited,
    timedOut: parseCount(summaryText, /(\d+)\s+timed out/i) || lineCounts.timedOut,
    provider4xx:
      parseCount(summaryText, /(\d+)\s+provider\s+4xx/i)
      || lineCounts.provider4xx,
    emptyResponse: parseCount(summaryText, /(\d+)\s+empty response/i) || lineCounts.emptyResponse,
  };

  const providerFailedModels = Array.from(new Set(
    triedModelLines
      .map(line => line.replace(/^\d+\.\s+/, ''))
      .map(line => {
        const modelId = line.split(/:\s/, 2)[0] || line;
        return normalizeWhitespace(modelId);
      })
      .filter(Boolean)
  ));

  const authDetected =
    lower.includes('unauthorized')
    || lower.includes('invalid api key')
    || lower.includes('auth error')
    || lower.includes('authentication');

  let runtimeFailureCode: RuntimeFailureCode = 'provider_unavailable';
  if (authDetected) {
    runtimeFailureCode = 'provider_auth';
  } else if (
    providerFailureCounts.rateLimited > 0
    || providerFailureCounts.timedOut > 0
    || providerFailureCounts.provider4xx > 0
    || providerFailureCounts.emptyResponse > 0
  ) {
    runtimeFailureCode = 'provider_exhaustion';
  }

  return {
    runtimeFailureCode,
    providerFailureSummary: summaryText || summarizeCounts(providerFailureCounts) || normalizeWhitespace(normalizedMessage),
    providerFailureCounts,
    providerFailedModels,
  };
}
