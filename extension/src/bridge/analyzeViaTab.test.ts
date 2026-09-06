import { describe, expect, it, vi } from "vitest";
import type { ReportOutcome } from "../score/buildReport";
import { analyzeViaHiddenTab, type TabRelayDeps } from "./analyzeViaTab";

// a controllable stand in for setTimeout/clearTimeout, so timeout
// behaviour is deterministic instead of racing real timers.
function fakeTimer() {
  let scheduled: (() => void) | null = null;
  let cleared = false;
  return {
    setTimeoutImpl: (handler: () => void): unknown => {
      scheduled = handler;
      return "the-only-handle";
    },
    clearTimeoutImpl: (handle: unknown): void => {
      expect(handle).toBe("the-only-handle");
      cleared = true;
    },
    fire: (): void => {
      scheduled?.();
    },
    wasCleared: () => cleared,
  };
}

function baseDeps(overrides: Partial<TabRelayDeps> = {}): TabRelayDeps {
  return {
    createTab: vi.fn().mockResolvedValue(1),
    removeTab: vi.fn().mockResolvedValue(undefined),
    addResultListener: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe("analyzeViaHiddenTab", () => {
  it("creates a tab at the given url and resolves with the matching result", async () => {
    let listener: ((tabId: number, outcome: ReportOutcome | null) => void) | undefined;
    const createTab = vi.fn().mockResolvedValue(42);
    const removeTab = vi.fn().mockResolvedValue(undefined);
    const addResultListener = vi.fn((l) => {
      listener = l;
      return () => {};
    });

    const promise = analyzeViaHiddenTab("https://www.amazon.com/dp/x", {
      createTab,
      removeTab,
      addResultListener,
    });

    // let createTab's promise settle before the listener fires
    await Promise.resolve();
    await Promise.resolve();
    listener?.(42, { status: "no-model" });

    await expect(promise).resolves.toEqual({ status: "no-model" });
    expect(createTab).toHaveBeenCalledWith("https://www.amazon.com/dp/x");
    expect(removeTab).toHaveBeenCalledWith(42);
  });

  it("ignores a result reported for a different tab", async () => {
    let listener: ((tabId: number, outcome: ReportOutcome | null) => void) | undefined;
    const addResultListener = vi.fn((l) => {
      listener = l;
      return () => {};
    });

    const promise = analyzeViaHiddenTab("https://www.amazon.com/dp/x", baseDeps({
      createTab: vi.fn().mockResolvedValue(1),
      addResultListener,
    }));

    await Promise.resolve();
    await Promise.resolve();
    listener?.(999, { status: "ok", report: {} as never });
    listener?.(1, { status: "no-model" });

    await expect(promise).resolves.toEqual({ status: "no-model" });
  });

  it("resolves not-a-product-page when the content script found nothing to analyze", async () => {
    let listener: ((tabId: number, outcome: ReportOutcome | null) => void) | undefined;
    const addResultListener = vi.fn((l) => {
      listener = l;
      return () => {};
    });

    const promise = analyzeViaHiddenTab("https://www.amazon.com/s?k=x", baseDeps({ addResultListener }));
    await Promise.resolve();
    await Promise.resolve();
    listener?.(1, null);

    await expect(promise).resolves.toEqual({ status: "not-a-product-page" });
  });

  it("resolves timed-out and still removes the tab when no result ever arrives", async () => {
    const timer = fakeTimer();
    const removeTab = vi.fn().mockResolvedValue(undefined);

    const promise = analyzeViaHiddenTab(
      "https://www.amazon.com/dp/x",
      baseDeps({
        removeTab,
        setTimeoutImpl: timer.setTimeoutImpl,
        clearTimeoutImpl: timer.clearTimeoutImpl,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    timer.fire();

    await expect(promise).resolves.toEqual({ status: "timed-out" });
    expect(removeTab).toHaveBeenCalledWith(1);
  });

  it("unsubscribes and clears the timer once settled, and ignores anything after", async () => {
    let listener: ((tabId: number, outcome: ReportOutcome | null) => void) | undefined;
    const unsubscribe = vi.fn();
    const removeTab = vi.fn().mockResolvedValue(undefined);
    const timer = fakeTimer();
    const addResultListener = vi.fn((l) => {
      listener = l;
      return unsubscribe;
    });

    const promise = analyzeViaHiddenTab(
      "https://www.amazon.com/dp/x",
      baseDeps({
        removeTab,
        addResultListener,
        setTimeoutImpl: timer.setTimeoutImpl,
        clearTimeoutImpl: timer.clearTimeoutImpl,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    listener?.(1, { status: "no-model" });
    // a late, spurious second message for the same tab after settling
    listener?.(1, { status: "not-enough-data" });
    // and a timeout firing after settling too
    timer.fire();

    await expect(promise).resolves.toEqual({ status: "no-model" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(removeTab).toHaveBeenCalledOnce();
    expect(timer.wasCleared()).toBe(true);
  });
});
