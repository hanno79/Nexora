import type { InsertPrdVersion, Prd } from "@shared/schema";

export type PrdVersionSnapshotSource = Pick<
  Prd,
  "id" | "title" | "description" | "content" | "status" | "structuredContent"
>;

export function getNextPrdVersionNumber(existingVersionCount: number): string {
  if (!Number.isFinite(existingVersionCount) || existingVersionCount < 0) {
    return "v1";
  }
  return `v${Math.floor(existingVersionCount) + 1}`;
}

export function buildPrdVersionSnapshot(
  prd: PrdVersionSnapshotSource,
  versionNumber: string,
  createdBy: string,
): InsertPrdVersion {
  return {
    prdId: prd.id,
    versionNumber,
    title: prd.title,
    description: prd.description ?? null,
    content: prd.content,
    structuredContent: prd.structuredContent ?? null,
    status: prd.status,
    createdBy,
  };
}
