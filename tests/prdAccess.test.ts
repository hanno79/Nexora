import { describe, expect, it, vi } from "vitest";
import { requireEditablePrdId, requirePrdAccess } from "../server/prdAccess";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(userId?: string) {
  if (!userId) return {} as any;
  return {
    user: {
      claims: {
        sub: userId,
      },
    },
  } as any;
}

function mockStorage(options?: {
  prd?: { id: string; userId: string } | undefined;
  shares?: Array<{ sharedWith: string; permission: string }>;
}) {
  return {
    getPrd: vi.fn().mockResolvedValue(options?.prd),
    getPrdShares: vi.fn().mockResolvedValue(options?.shares ?? []),
  };
}

describe("requirePrdAccess", () => {
  it("returns 401 when user claims are missing", async () => {
    const storage = mockStorage();
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq(), res as any, "prd-1", "view");

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
  });

  it("returns 404 when PRD does not exist", async () => {
    const storage = mockStorage({ prd: undefined });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("u1"), res as any, "prd-1", "view");

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "PRD not found" });
  });

  it("allows owner access without checking shares", async () => {
    const storage = mockStorage({ prd: { id: "prd-1", userId: "owner" } });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("owner"), res as any, "prd-1", "edit");

    expect(result).toEqual({ id: "prd-1", userId: "owner" });
    expect(storage.getPrdShares).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows shared view access when permission is view", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "viewer", permission: "view" }],
    });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("viewer"), res as any, "prd-1", "view");

    expect(result).toEqual({ id: "prd-1", userId: "owner" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows shared edit access when permission is edit", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "editor", permission: "edit" }],
    });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("editor"), res as any, "prd-1", "edit");

    expect(result).toEqual({ id: "prd-1", userId: "owner" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("denies shared view user when edit access is required", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "viewer", permission: "view" }],
    });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("viewer"), res as any, "prd-1", "edit");

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "You don't have permission to access this PRD" });
  });

  it("allows edit when duplicate share rows include edit permission", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [
        { sharedWith: "editor", permission: "view" },
        { sharedWith: "editor", permission: "edit" },
      ],
    });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("editor"), res as any, "prd-1", "edit");

    expect(result).toEqual({ id: "prd-1", userId: "owner" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("denies view when share permission value is invalid", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "viewer", permission: "owner" }],
    });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("viewer"), res as any, "prd-1", "view");

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("accepts case-insensitive edit permission from legacy rows", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "editor", permission: " Edit " }],
    });
    const res = mockRes();

    const result = await requirePrdAccess(storage as any, mockReq("editor"), res as any, "prd-1", "edit");

    expect(result).toEqual({ id: "prd-1", userId: "owner" });
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireEditablePrdId", () => {
  it("returns null without response when ID is missing in optional mode", async () => {
    const storage = mockStorage();
    const res = mockRes();

    const result = await requireEditablePrdId(storage as any, mockReq("u1"), res as any, undefined);

    expect(result).toBeNull();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 when ID is invalid in optional mode", async () => {
    const storage = mockStorage();
    const res = mockRes();

    const result = await requireEditablePrdId(storage as any, mockReq("u1"), res as any, "   ");

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "PRD ID must be a non-empty string" });
  });

  it("returns 400 when ID is missing in required mode", async () => {
    const storage = mockStorage();
    const res = mockRes();

    const result = await requireEditablePrdId(storage as any, mockReq("u1"), res as any, undefined, {
      required: true,
      requiredMessage: "Title and PRD ID are required",
    });

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Title and PRD ID are required" });
  });

  it("returns normalized ID when user has edit access", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "editor", permission: "edit" }],
    });
    const res = mockRes();

    const result = await requireEditablePrdId(storage as any, mockReq("editor"), res as any, " prd-1 ");

    expect(result).toBe("prd-1");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when user has only view share", async () => {
    const storage = mockStorage({
      prd: { id: "prd-1", userId: "owner" },
      shares: [{ sharedWith: "viewer", permission: "view" }],
    });
    const res = mockRes();

    const result = await requireEditablePrdId(storage as any, mockReq("viewer"), res as any, "prd-1");

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "You don't have permission to access this PRD" });
  });
});
