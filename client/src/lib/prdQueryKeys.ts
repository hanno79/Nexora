export const PRDS_LIST_QUERY_KEY = ["/api/prds"] as const;

export function getPrdDetailQueryKey(prdId: string | undefined) {
  return ["/api/prds", prdId] as const;
}

export function getPrdVersionsQueryKey(prdId: string | undefined) {
  return ["/api/prds", prdId, "versions"] as const;
}
