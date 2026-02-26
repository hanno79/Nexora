import { describe, expect, it } from "vitest";
import { GuidedSessionStore } from "../server/guidedSessionStore";

describe("GuidedSessionStore", () => {
  it("returns context for session owner", () => {
    let now = 1_000;
    const store = new GuidedSessionStore<{ step: string }>(5_000, () => now);
    store.create("s1", "owner-1", { step: "q1" });

    const result = store.get("s1", "owner-1");

    expect(result.status).toBe("ok");
    expect(result.context).toEqual({ step: "q1" });
  });

  it("denies access for different users", () => {
    const store = new GuidedSessionStore<{ step: string }>(5_000, () => 1_000);
    store.create("s1", "owner-1", { step: "q1" });

    const result = store.get("s1", "owner-2");

    expect(result.status).toBe("forbidden");
    expect(store.size()).toBe(1);
  });

  it("expires sessions and removes them on access", () => {
    let now = 10_000;
    const store = new GuidedSessionStore<{ step: string }>(1_000, () => now);
    store.create("s1", "owner-1", { step: "q1" });

    now = 11_500;
    const result = store.get("s1", "owner-1");

    expect(result.status).toBe("expired");
    expect(store.size()).toBe(0);
  });

  it("refreshes ttl for active sessions", () => {
    let now = 1_000;
    const store = new GuidedSessionStore<{ step: string }>(1_000, () => now);
    store.create("s1", "owner-1", { step: "q1" });

    now = 1_900;
    expect(store.get("s1", "owner-1").status).toBe("ok");

    now = 2_500;
    expect(store.get("s1", "owner-1").status).toBe("ok");
  });

  it("consumes session on finalize-style access", () => {
    const store = new GuidedSessionStore<{ step: string }>(5_000, () => 1_000);
    store.create("s1", "owner-1", { step: "q1" });

    const consumed = store.consume("s1", "owner-1");
    const after = store.get("s1", "owner-1");

    expect(consumed.status).toBe("ok");
    expect(after.status).toBe("not_found");
    expect(store.size()).toBe(0);
  });
});
