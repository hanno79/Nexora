import { describe, expect, it, vi } from "vitest";
import {
  __getToastListenerCountForTests,
  subscribeToastState,
  toast,
} from "../client/src/hooks/use-toast";

describe("use-toast subscription store", () => {
  it("deduplicates listener registration and unsubscribes cleanly", () => {
    const initialCount = __getToastListenerCountForTests();
    const listener = vi.fn();

    const unsub1 = subscribeToastState(listener);
    expect(__getToastListenerCountForTests()).toBe(initialCount + 1);

    const unsub2 = subscribeToastState(listener);
    expect(__getToastListenerCountForTests()).toBe(initialCount + 1);

    const created = toast({ title: "test-toast" });
    expect(listener).toHaveBeenCalled();

    unsub2();
    expect(__getToastListenerCountForTests()).toBe(initialCount);

    // Idempotent cleanup
    unsub1();
    expect(__getToastListenerCountForTests()).toBe(initialCount);

    created.dismiss();
  });
});
