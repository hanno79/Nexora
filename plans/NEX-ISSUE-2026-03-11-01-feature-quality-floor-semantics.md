# NEX-ISSUE-2026-03-11-01

## Title

Separate attempted/relevant feature-quality-floor IDs from actual floor-failure IDs

## Context

Verified against the current code on March 11, 2026:

- `server/prdCompilerFinalizer.ts` already emits two distinct public signals from `buildFeatureQualityDiagnostics(...)`.
- `featureQualityFloorFeatureIds` is the broader inspected/relevant set.
- `featureQualityFloorFailedFeatureIds` is the narrower tripping/causal set.
- The old ambiguity now lives only in the internal helper concept that used to be described as `qualityFloorIds`; in code this is now the internal helper `qualityFloorRelevantIds`.

The remaining work is to keep the terminology, tests, and consumer expectations aligned with those verified semantics.

## Symbols

- `featureQualityFloorFeatureIds`
- `featureQualityFloorFailedFeatureIds`
- `featurePriorityWindow`
- `qualityFloorRelevantIds` (internal helper; previously discussed as `qualityFloorIds`)

## Expected Semantics

- `featureQualityFloorFeatureIds`
  - Contains the feature IDs that were inspected or are otherwise relevant to the floor decision.
  - In the current implementation this is `sort(unique(featurePriorityWindow + qualityFloorRelevantIds))`.
  - This set may stay non-empty even when `featureQualityFloorPassed === true`.
- `featureQualityFloorFailedFeatureIds`
  - Contains only the IDs that satisfy the active failure condition.
  - This set should be empty when `featureQualityFloorPassed === true`.
- `featurePriorityWindow`
  - The leading top-N feature IDs considered first by the floor check.
  - If `quality.featurePriorityWindow` is already present, that exact deduplicated ordered set is reused after filtering to IDs that still exist in the structure.
  - Otherwise the window is derived from structure order as the first `N = max(3, min(5, ceil(featureCount * 0.35)))` feature IDs.
- `qualityFloorRelevantIds`
  - Internal helper only.
  - Precise relationship: it is a subset operand used when deriving `featureQualityFloorFeatureIds`, not an alias for the public field and not a replacement for `featureQualityFloorFailedFeatureIds`.
  - As of March 11, 2026 it is not emitted in `CompilerRunDiagnostics`, iteration-log markers, or public error payloads.

## Term Definitions

- `leading feature`
  - Any feature whose ID is a member of `featurePriorityWindow`.
  - Example: if `featurePriorityWindow = ["F-01", "F-02", "F-03"]`, then `F-04` is not a leading feature even if it is low-substance.
- `bare ID`
  - A feature name that collapses to the normalized feature ID after markdown stripping and alphanumeric normalization, or is empty/placeholder-like.
  - Canonical implementation: `isFeatureNameCollapsed(...)` in `server/prdCompilerFinalizer.ts`.
  - Examples: `name = "F-01"`, `name = "Feature ID: F-01"`, or `name = ""`.
- `placeholder purpose text`
  - Any `purpose` value that fails `hasMeaningfulScalarValue(purpose, 30)`.
  - That includes literal placeholders and ID-echo text, not just the exact string `TODO`.
  - Canonical implementation: `hasMeaningfulScalarValue(...)` and `isPlaceholderLikeText(...)` in `server/prdCompilerFinalizer.ts`.
  - Examples: `purpose = "TODO"`, `purpose = "Purpose"`, `purpose = "Feature ID: F-02"`.
- `low-substance IDs`
  - Feature IDs whose `countSubstantialFeatureFields(feature)` result is `< 4`.
  - Canonical implementation: `countSubstantialFeatureFields(...)` and `snapshotFeatureQuality(...)` in `server/prdCompilerFinalizer.ts`.
  - The metric counts only substantive feature fields:
    - scalar fields must be non-placeholder and meet the minimum length threshold (`purpose >= 30`, most others `>= 20`)
    - `mainFlow` needs at least 3 meaningful steps
    - other array fields need at least 1 meaningful item
    - acceptance criteria must satisfy `hasSubstantiveAcceptanceCriteria(...)`

## Failure Conditions To Preserve

- If any leading feature name collapses to a bare ID, only those collapsed leading IDs belong in `featureQualityFloorFailedFeatureIds`.
- If placeholder purpose text trips the floor, only the leading placeholder-purpose IDs that cross the threshold belong in `featureQualityFloorFailedFeatureIds`.
- If empty main flows trip the floor, only those leading IDs belong in `featureQualityFloorFailedFeatureIds`.
- If thin acceptance criteria trip the floor, only those leading IDs belong in `featureQualityFloorFailedFeatureIds`.
- If the broad low-substance fallback trips the floor, the failing set should contain the low-substance IDs responsible for that broad failure.
  - Current rule: the floor fails when either `lowSubstantialLeadingIds.length >= 2` or `snapshot.lowSubstantialFeatureIds.length >= max(3, ceil(featureCount * 0.2))`.
  - When the broad fallback branch is the tripping branch, `featureQualityFloorFailedFeatureIds` should be `snapshot.lowSubstantialFeatureIds`, not merely the leading subset.
- When the floor passes, `featureQualityFloorFailedFeatureIds` must remain empty even if `featureQualityFloorFeatureIds` still records inspected or lower-severity IDs.

## Follow-Up Work

1. Keep the rejected-repair path aligned with the displayed candidate semantics: if the displayed candidate passed the floor, `featureQualityFloorFailedFeatureIds` must stay empty even when rejected repair diagnostics mention restored feature IDs.
2. Revisit UI labels and artifact naming if `featureQualityFloorFeatureIds` is displayed to users; the field now means "inspected/relevant", not "failed".
3. If a legacy/public `qualityFloorIds` field is ever reintroduced, define it explicitly as either:
   - an alias of `featureQualityFloorFeatureIds`, or
   - a separate internal-helper export with a documented containment contract.

## Test Plan

1. Add or keep a finalizer regression where `featureQualityFloorPassed === true` and assert:
   - `featureQualityFloorFeatureIds` is non-empty for the inspected feature window.
   - `featureQualityFloorFailedFeatureIds` is empty.
2. Add or keep a regression where the floor fails because leading placeholder-purpose IDs cross the threshold and assert:
   - `featureQualityFloorFeatureIds` includes the inspected feature window.
   - `featureQualityFloorFailedFeatureIds` contains only the failing placeholder-purpose IDs.
3. Add or keep a regression where the broad low-substance fallback fails and assert:
   - `featureQualityFloorFailedFeatureIds` contains the low-substance IDs that triggered the broad failure.
   - downstream penalties continue to read only `featureQualityFloorFailedFeatureIds`.
4. Add or keep repair-rejection coverage to assert the degraded repair path does not silently repopulate `featureQualityFloorFailedFeatureIds` when the displayed candidate passed the floor.
5. Conditional backward-compatibility test only if a public `qualityFloorIds` field exists.
   - Current verified status: no public `qualityFloorIds` field is emitted, so no compatibility test is required today.
   - If such a field is reintroduced, assert that existing consumers reading `qualityFloorIds` behave identically to the prior API and that the field's relationship to `featureQualityFloorFeatureIds` is documented exactly.

## Tracking Note

GitHub issue creation was not possible from this workspace on March 11, 2026 because `gh auth status` reported no valid login/token. This local issue file is the tracked reference for now.
