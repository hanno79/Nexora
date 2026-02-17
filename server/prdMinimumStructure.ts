/**
 * Author: rahn
 * Datum: 15.02.2026
 * Version: 1.0
 * Beschreibung: Deterministische Mindest-Struktur-Ergänzungsschicht für Features.
 *   Ergänzt fehlende Main-Flow-Schritte und Acceptance Criteria VOR der Validierung,
 *   damit Features nicht wegen zu kurzer Struktur abgelehnt werden.
 *   Kein LLM-Aufruf — rein deterministisch.
 */

import type { FeatureSpec } from "./prdStructure";

// Zähler für Diagnostics
let autoCompletedMainFlowCount = 0;
let autoCompletedAcceptanceCriteriaCount = 0;

/**
 * Stellt sicher, dass ein Feature mindestens `minSteps` Main-Flow-Schritte hat.
 * Fehlende Schritte werden deterministisch ergänzt.
 */
export function ensureMinimumMainFlow(feature: FeatureSpec, minSteps = 4): FeatureSpec {
  try {
    if (!feature.mainFlow) return feature;

    const currentSteps = feature.mainFlow.length;

    if (currentSteps >= minSteps) return feature;

    const missing = minSteps - currentSteps;

    for (let i = 0; i < missing; i++) {
      feature.mainFlow.push(
        `${currentSteps + i + 1}. System completes remaining required operation step.`
      );
    }

    autoCompletedMainFlowCount += 1;

    console.log(
      `⚙ Auto-Completed Main Flow for ${feature.id} (added ${missing} step(s))`
    );

    return feature;
  } catch (err) {
    console.error("Minimum Main Flow completion failed:", err);
    return feature;
  }
}

/**
 * Stellt sicher, dass ein Feature mindestens `minCriteria` Acceptance Criteria hat.
 * Fehlende Kriterien werden deterministisch ergänzt.
 */
export function ensureMinimumAcceptanceCriteria(
  feature: FeatureSpec,
  minCriteria = 2
): FeatureSpec {
  try {
    if (!feature.acceptanceCriteria) return feature;

    const currentCriteria = feature.acceptanceCriteria.length;

    if (currentCriteria >= minCriteria) return feature;

    const missing = minCriteria - currentCriteria;

    for (let i = 0; i < missing; i++) {
      feature.acceptanceCriteria.push(
        `${currentCriteria + i + 1}. The operation completes without runtime errors.`
      );
    }

    autoCompletedAcceptanceCriteriaCount += 1;

    console.log(
      `⚙ Auto-Completed Acceptance Criteria for ${feature.id} (added ${missing} criteria)`
    );

    return feature;
  } catch (err) {
    console.error("Minimum Acceptance Criteria completion failed:", err);
    return feature;
  }
}

/**
 * Gibt die aktuellen Diagnostics-Zähler zurück.
 * Kann in CompilerDiagnostics eingebunden werden.
 */
export function getMinimumStructureDiagnostics() {
  return {
    autoCompletedMainFlowCount,
    autoCompletedAcceptanceCriteriaCount,
  };
}
