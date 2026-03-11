# NEX-ISSUE-2026-03-11-01

## Title

Separate attempted/relevant feature-quality-floor IDs from actual floor-failure IDs

## Context

`server/prdCompilerFinalizer.ts` currently derives a broad `qualityFloorIds` signal bucket and uses it for both `featureQualityFloorFeatureIds` and `featureQualityFloorFailedFeatureIds`.

That collapses two different semantics:

- `featureQualityFloorFeatureIds` should represent the feature IDs that were relevant to, or inspected by, the feature-quality-floor check.
- `featureQualityFloorFailedFeatureIds` should represent only the feature IDs that actually caused the floor to fail and should therefore affect penalties, failure diagnostics, and user-visible failure state.

The current duplication makes it impossible to distinguish:

- a floor that passed even though some lower-priority features were thin
- a floor that failed because specific leading features tripped the gate
- a degraded repair path where repaired/restored features should be tracked separately from base floor failures

## Symbols

- `featureQualityFloorFeatureIds`
- `featureQualityFloorFailedFeatureIds`
- `qualityFloorIds`

## Expected Semantics

- `featureQualityFloorFeatureIds`
  - Contains the feature IDs that were inspected or are otherwise relevant to the floor decision.
  - Today that likely means the `featurePriorityWindow` plus any extra IDs surfaced by broader floor-related heuristics.
- `featureQualityFloorFailedFeatureIds`
  - Contains only the IDs that satisfy the active failure condition.
  - This set should be empty when `featureQualityFloorPassed === true`.
- `qualityFloorIds`
  - Broad aggregate of floor-related signals.
  - This may remain an internal helper, but if it continues to back `featureQualityFloorFeatureIds`, the naming should be reviewed so the distinction stays explicit.

## Failure Conditions To Preserve

- If any leading feature name collapses to a bare ID, only those collapsed leading IDs belong in `featureQualityFloorFailedFeatureIds`.
- If placeholder purpose text trips the floor, only the leading placeholder-purpose IDs that cross the threshold belong in `featureQualityFloorFailedFeatureIds`.
- If empty main flows trip the floor, only those leading IDs belong in `featureQualityFloorFailedFeatureIds`.
- If thin acceptance criteria trip the floor, only those leading IDs belong in `featureQualityFloorFailedFeatureIds`.
- If the broad low-substance fallback trips the floor, the failing set should contain the low-substance IDs responsible for that broad failure.
- When the floor passes, `featureQualityFloorFailedFeatureIds` must remain empty even if `featureQualityFloorFeatureIds` still records inspected or lower-severity IDs.

## Follow-Up Work

1. Audit the rejected-repair path in `server/prdCompilerFinalizer.ts` to confirm restored feature IDs belong in both collections, or only in the failed set, for rejected repair candidates.
2. Revisit UI labels and artifact naming if `featureQualityFloorFeatureIds` is meant to mean "inspected" rather than "failed".
3. Consider renaming `qualityFloorIds` if the broader signal bucket remains part of the public diagnostic shape.

## Test Plan

1. Add a unit or finalizer regression where `featureQualityFloorPassed === true` and assert:
   - `featureQualityFloorFeatureIds` is non-empty for the inspected feature window.
   - `featureQualityFloorFailedFeatureIds` is empty.
2. Add a regression where the floor fails because leading placeholder-purpose IDs cross the threshold and assert:
   - `featureQualityFloorFeatureIds` includes the inspected feature window.
   - `featureQualityFloorFailedFeatureIds` contains only the failing placeholder-purpose IDs.
3. Add a regression where the broad low-substance fallback fails and assert:
   - `featureQualityFloorFailedFeatureIds` contains the low-substance IDs that triggered the broad failure.
   - the scoring penalty uses only that failed set.
4. Add or update repair-rejection coverage to assert the degraded repair path does not silently repopulate `featureQualityFloorFailedFeatureIds` when the displayed candidate passed the floor.

## Tracking Note

GitHub issue creation was not possible from this workspace on March 11, 2026 because `gh auth status` reported no valid login/token. This local issue file is the tracked reference for now.
