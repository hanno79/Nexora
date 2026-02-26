import { isDeepStrictEqual } from "node:util";
import type { InsertPrd, Prd } from "@shared/schema";

const VERSION_SNAPSHOT_FIELDS = ["title", "description", "content", "structuredContent"] as const;
type VersionSnapshotField = (typeof VERSION_SNAPSHOT_FIELDS)[number];

/**
 * Snapshot only when content-relevant fields actually changed.
 * Metadata/integration updates should not produce new versions.
 */
export function shouldCreatePrdVersionSnapshot(
  currentPrd: Pick<Prd, VersionSnapshotField>,
  data: Partial<InsertPrd>
): boolean {
  for (const field of VERSION_SNAPSHOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      continue;
    }

    const previousValue = (currentPrd as any)[field];
    const nextValue = (data as any)[field];

    if (field === "structuredContent") {
      if (!isDeepStrictEqual(previousValue ?? null, nextValue ?? null)) {
        return true;
      }
      continue;
    }

    if (previousValue !== nextValue) {
      return true;
    }
  }

  return false;
}
