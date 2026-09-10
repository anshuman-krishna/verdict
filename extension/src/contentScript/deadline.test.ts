import { describe, expect, it, vi } from "vitest";
import { callIfSlower, FIRST_PAINT_BUDGET_MS } from "./deadline";

function fakeTimers() {
  const pending: { run: () => void; ms: number; cleared: boolean }[] = [];
  return {
    pending,
    timers: {
      setTimer: (run: () => void, ms: number) => {
        pending.push({ run, ms, cleared: false });
        return pending.length - 1;
      },
      clearTimer: (handle: unknown) => {
        const entry = pending[handle as number];
        if (entry !== undefined) {
          entry.cleared = true;
        }
      },
    },
  };
}

describe("callIfSlower", () => {
  it("holds the first paint budget at 400ms, per SPEC.md section 13", () => {
    expect(FIRST_PAINT_BUDGET_MS).toBe(400);
  });

  it("runs the callback when the deadline passes before the work settles", () => {
    const { pending, timers } = fakeTimers();
    const onSlow = vi.fn();
    callIfSlower(new Promise(() => {}), 400, onSlow, timers);

    expect(pending[0]?.ms).toBe(400);
    pending[0]?.run();

    expect(onSlow).toHaveBeenCalledOnce();
  });

  it("clears the timer once the work settles", async () => {
    const { pending, timers } = fakeTimers();
    const onSlow = vi.fn();
    callIfSlower(Promise.resolve("done"), 400, onSlow, timers);
    await Promise.resolve();
    await Promise.resolve();

    expect(pending[0]?.cleared).toBe(true);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it("clears the timer when the work rejects rather than leaking it", async () => {
    const { pending, timers } = fakeTimers();
    callIfSlower(Promise.reject(new Error("no")), 400, vi.fn(), timers);
    await Promise.resolve();
    await Promise.resolve();

    expect(pending[0]?.cleared).toBe(true);
  });

  it("stays silent when the timer fires after the work already settled", async () => {
    const { pending, timers } = fakeTimers();
    const onSlow = vi.fn();
    callIfSlower(Promise.resolve("done"), 400, onSlow, timers);
    await Promise.resolve();
    await Promise.resolve();
    pending[0]?.run();

    expect(onSlow).not.toHaveBeenCalled();
  });
});
