import { describe, expect, it } from "vitest";
import {
  PRDS_LIST_QUERY_KEY,
  getPrdDetailQueryKey,
  getPrdVersionsQueryKey,
} from "../client/src/lib/prdQueryKeys";

describe("prdQueryKeys", () => {
  it("uses stable schema for PRD list and detail keys", () => {
    expect(PRDS_LIST_QUERY_KEY).toEqual(["/api/prds"]);
    expect(getPrdDetailQueryKey("prd-123")).toEqual(["/api/prds", "prd-123"]);
    expect(getPrdVersionsQueryKey("prd-123")).toEqual(["/api/prds", "prd-123", "versions"]);
  });

  it("keeps detail key format consistent across query and invalidation usage", () => {
    const fromQuery = getPrdDetailQueryKey("prd-abc");
    const fromInvalidation = getPrdDetailQueryKey("prd-abc");

    expect(fromQuery).toEqual(fromInvalidation);
    expect(fromQuery[0]).toBe("/api/prds");
    expect(fromQuery[1]).toBe("prd-abc");
  });

  it("keeps versions key format consistent across query and invalidation usage", () => {
    const fromQuery = getPrdVersionsQueryKey("prd-xyz");
    const fromInvalidation = getPrdVersionsQueryKey("prd-xyz");

    expect(fromQuery).toEqual(fromInvalidation);
    expect(fromQuery).toEqual(["/api/prds", "prd-xyz", "versions"]);
  });
});
