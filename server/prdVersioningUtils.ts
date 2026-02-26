import type { InsertPrdVersion, Prd } from "@shared/schema";

interface PrdVersionSource {
  id: string;
  title: string;
  description: string | null;
  content: string;
  status: string;
  structuredContent?: unknown;
}

export function getNextPrdVersionNumber(existingVersionCount: number): string {
  if (!Number.isFinite(existingVersionCount) || existingVersionCount < 0) {
    return "v1";
  }
  return `v${Math.floor(existingVersionCount) + 1}`;
}

export function buildPrdVersionSnapshot(
  prd: PrdVersionSource,
  versionNumber: string,
  createdBy: string,
): InsertPrdVersion {
  return {
    prdId: prd.id,
    versionNumber,
    title: prd.title,
    description: prd.description ?? null,
    content: prd.content,
    structuredContent: (prd.structuredContent ?? null) as any,
    status: prd.status,
    createdBy,
  };
}
