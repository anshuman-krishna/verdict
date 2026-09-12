import { describe, expect, it, vi } from "vitest";
import type { ReportOutcome } from "../score/buildReport";
import type { ProgressiveMount } from "./mount";
import type { AnalysisResult } from "./orchestrator";
import { createSession } from "./session";

const A = "https://www.amazon.com/dp/B0ABCDEFGH";
const B = "https://www.amazon.com/dp/B0HGFEDCBA";
const NOT_A_PRODUCT = "https://www.amazon.com/s?k=headphones";

function result(outcome: ReportOutcome): AnalysisResult {
  return {
    page: { site: "amazon", locale: "com", productId: "B0ABCDEFGH" },
    product: null,
    reviews: [],
    outcome,
  };
}

const OK = result({ status: "not-enough-data" });
const UNREADABLE = result({ status: "unreadable" });

function mount(): ProgressiveMount {
  return { waiting: vi.fn(), show: vi.fn(), settle: vi.fn() };
}

function harness(analyse: (href: string) => Promise<AnalysisResult | null>) {
  const teardown = vi.fn();
  const report = vi.fn();
  const mounts: ProgressiveMount[] = [];
  const session = createSession({
    analyse: (href) => analyse(href),
    createMount: () => {
      const made = mount();
      mounts.push(made);
      return made;
    },
    teardown,
    report,
    delay: async () => {},
    settleMs: 0,
    retryDelaysMs: [0, 0],
  });
  return { session, teardown, report, mounts };
}

describe("createSession", () => {
  it("analyses the first url it is given", async () => {
    const analyse = vi.fn(async () => OK);
    const { session, report } = harness(analyse);
    await session.visit(A);
    expect(analyse).toHaveBeenCalledWith(A);
    expect(report).toHaveBeenCalledWith(OK.outcome);
  });

  it("takes the panel down before reading the listing navigated to", async () => {
    const order: string[] = [];
    const { session, teardown } = harness(async () => {
      order.push("analyse");
      return OK;
    });
    teardown.mockImplementation(() => order.push("teardown"));
    await session.visit(A);
    await session.visit(B);
    expect(order.indexOf("teardown")).toBeLessThan(order.indexOf("analyse"));
  });

  it("re-reads when the listing changes", async () => {
    const analyse = vi.fn(async () => OK);
    const { session } = harness(analyse);
    await session.visit(A);
    await session.visit(B);
    expect(analyse).toHaveBeenCalledTimes(2);
    expect(analyse).toHaveBeenLastCalledWith(B);
  });

  it("ignores a url change that is still the same listing", async () => {
    const analyse = vi.fn(async () => OK);
    const { session, teardown } = harness(analyse);
    await session.visit(A);
    teardown.mockClear();
    await session.visit(`${A}?ref=sr_1_3`);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(teardown).not.toHaveBeenCalled();
  });

  it("clears the panel when the page stops being a listing", async () => {
    const { session, teardown } = harness(async (href) => (href === A ? OK : null));
    await session.visit(A);
    teardown.mockClear();
    await session.visit(NOT_A_PRODUCT);
    expect(teardown).toHaveBeenCalled();
  });

  it("retries an unreadable page, since the dom may not have swapped yet", async () => {
    let calls = 0;
    const { session, report } = harness(async () => {
      calls += 1;
      return calls < 3 ? UNREADABLE : OK;
    });
    await session.visit(B);
    expect(calls).toBe(3);
    expect(report).toHaveBeenCalledWith(OK.outcome);
  });

  it("gives up after the retries and says the page could not be read", async () => {
    const analyse = vi.fn(async () => UNREADABLE);
    const { session, report } = harness(analyse);
    await session.visit(B);
    expect(analyse).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledWith(UNREADABLE.outcome);
  });

  it("leaves nothing on screen from an attempt that read nothing", async () => {
    let calls = 0;
    const { session, teardown } = harness(async () => {
      calls += 1;
      return calls < 3 ? UNREADABLE : OK;
    });
    await session.visit(B);
    expect(teardown).toHaveBeenCalledTimes(3);
  });

  it("reports a url that is no listing at all as nothing", async () => {
    const { session, report } = harness(async () => null);
    await session.visit(NOT_A_PRODUCT);
    expect(report).toHaveBeenCalledWith(null);
  });

  it("does not mount a result the user has already navigated past", async () => {
    let release: (value: AnalysisResult) => void = () => {};
    const slow = new Promise<AnalysisResult>((resolve) => {
      release = resolve;
    });
    const { session, mounts, report } = harness(async (href) =>
      href === A ? slow : OK
    );
    const first = session.visit(A);
    await session.visit(B);
    release(OK);
    await first;
    expect(report).toHaveBeenCalledTimes(1);
    expect(mounts[0]?.settle).not.toHaveBeenCalled();
  });

  it("survives an analysis that throws", async () => {
    const { session, report } = harness(async () => {
      throw new Error("the page fought back");
    });
    await expect(session.visit(B)).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(null);
  });
});
