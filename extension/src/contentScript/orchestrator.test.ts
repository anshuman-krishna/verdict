// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { RulesDocument } from "../extract/rules";
import type { CombinerModel } from "../score/combine";
import { analyzePage, checkMoreDeeply, mergeReviews } from "./orchestrator";

const PRIORS = { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.5, 0.5] };

const MODEL: CombinerModel = {
  intercept: -1,
  coefficients: { "ratingDeconvolution.injectedShare": 3 },
  calibration: [],
};

function reviewsJson(count: number, ratingFor: (i: number) => number): string {
  const reviews = Array.from({ length: count }, (_, i) => ({
    rating: ratingFor(i),
    text: `body ${i} has enough distinguishing words to avoid near duplication`,
    date: `2024-01-${String((i % 25) + 1).padStart(2, "0")}`,
    verified: i % 2 === 0,
    reviewerId: `reviewer-${i}`,
  }));
  return JSON.stringify({ reviewsData: { reviews } });
}

function pageHtml(count: number, claimedRating: number | null = 4.6): string {
  const ratingSpan = claimedRating === null ? "" : `<span class="rating">${claimedRating}</span>`;
  return `
    <span class="title">A very good widget</span>
    ${ratingSpan}
    <script type="application/ld+json">${reviewsJson(count, (i) => (i < Math.round(count * 0.83) ? 5 : 1))}</script>
  `;
}

const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com"],
  fields: {
    title: { strategy: "selector", value: ".title" },
    claimedRating: { strategy: "selector", value: ".rating" },
    reviews: { strategy: "embedded-json", path: "$.reviewsData.reviews[*]" },
  },
};

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function deps(overrides: Partial<Parameters<typeof analyzePage>[2]> = {}) {
  return {
    rules: RULES,
    model: MODEL,
    priors: PRIORS,
    isHistoryEnabled: vi.fn().mockResolvedValue(true),
    saveHistory: vi.fn().mockResolvedValue(undefined),
    // these tests check outcome status and history wiring, not the
    // confidence interval, so a small resample count keeps them fast.
    // bootstrap.ts's default of 200 (SPEC.md section 6's number) is worth
    // keeping only where the interval itself is under test, as in
    // buildReport.test.ts.
    bootstrapResamples: 5,
    ...overrides,
  };
}

describe("analyzePage", () => {
  it("returns null for a url that is not an amazon product page", async () => {
    const result = await analyzePage(parse(pageHtml(30)), "https://www.example.com/", deps());
    expect(result).toBeNull();
  });

  it("returns null when no title can be extracted, even on a valid product url", async () => {
    const result = await analyzePage(
      parse(`<script type="application/ld+json">${reviewsJson(30, () => 5)}</script>`),
      "https://www.amazon.com/dp/B0BXYZ1234",
      deps(),
    );
    expect(result).toBeNull();
  });

  it("reports not-enough-data when the page has no claimed rating to adjust", async () => {
    const result = await analyzePage(
      parse(pageHtml(30, null)),
      "https://www.amazon.com/dp/B0BXYZ1234",
      deps(),
    );
    expect(result?.outcome).toEqual({ status: "not-enough-data" });
  });

  it("scores and saves history when history is enabled", async () => {
    const testDeps = deps();
    const result = await analyzePage(
      parse(pageHtml(30)),
      "https://www.amazon.com/dp/B0BXYZ1234",
      testDeps,
    );
    expect(result?.outcome.status).toBe("ok");
    expect(testDeps.saveHistory).toHaveBeenCalledOnce();
    expect(testDeps.saveHistory).toHaveBeenCalledWith(
      expect.objectContaining({ title: "A very good widget" }),
    );
  });

  it("does not save history when history is disabled", async () => {
    const testDeps = deps({ isHistoryEnabled: vi.fn().mockResolvedValue(false) });
    const result = await analyzePage(
      parse(pageHtml(30)),
      "https://www.amazon.com/dp/B0BXYZ1234",
      testDeps,
    );
    expect(result?.outcome.status).toBe("ok");
    expect(testDeps.saveHistory).not.toHaveBeenCalled();
  });
});

describe("analyzePage, reputation lookup (SPEC.md section 4, opt in)", () => {
  it("never calls fetch when no reputation deps are supplied at all", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const result = await analyzePage(parse(pageHtml(30)), "https://www.amazon.com/dp/B0BXYZ1234", deps());
    expect(result?.outcome.status).toBe("ok");
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not call fetch when isEnabled resolves false", async () => {
    const fetchImpl = vi.fn();
    const testDeps = deps({
      reputation: { isEnabled: vi.fn().mockResolvedValue(false), endpoint: "https://x", salt: "s", fetchImpl },
    });
    await analyzePage(parse(pageHtml(30)), "https://www.amazon.com/dp/B0BXYZ1234", testDeps);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("looks up reviewer ids and appends a reviewer network evidence row when enabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matches: {} }),
    });
    const testDeps = deps({
      reputation: {
        isEnabled: vi.fn().mockResolvedValue(true),
        endpoint: "https://api.verdict.tools/v1/reputation/lookup",
        salt: "test-salt",
        fetchImpl,
      },
    });

    const result = await analyzePage(parse(pageHtml(30)), "https://www.amazon.com/dp/B0BXYZ1234", testDeps);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.verdict.tools/v1/reputation/lookup",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result?.outcome.status).toBe("ok");
    if (result?.outcome.status !== "ok") {
      throw new Error("expected ok");
    }
    const row = result.outcome.report.evidence.find((r) => r.signal === "reviewer network");
    expect(row).toMatchObject({ strength: "weak", value: 0 });
  });

  it("saves the reviewer network row into the history entry too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ matches: {} }) });
    const testDeps = deps({
      reputation: {
        isEnabled: vi.fn().mockResolvedValue(true),
        endpoint: "https://x",
        salt: "s",
        fetchImpl,
      },
    });
    await analyzePage(parse(pageHtml(30)), "https://www.amazon.com/dp/B0BXYZ1234", testDeps);
    const savedReport = vi.mocked(testDeps.saveHistory).mock.calls[0]?.[0]?.report as {
      evidence: { signal: string }[];
    };
    expect(savedReport.evidence.some((r) => r.signal === "reviewer network")).toBe(true);
  });
});

describe("mergeReviews", () => {
  it("drops a fetched review sharing a reviewer id and date with an existing one", () => {
    const existing = [{ rating: 5, text: "a", date: "2024-01-01", verified: true, reviewerId: "r1" }];
    const fetched = [
      { rating: 5, text: "a duplicate copy", date: "2024-01-01", verified: true, reviewerId: "r1" },
      { rating: 1, text: "b", date: "2024-01-02", verified: false, reviewerId: "r2" },
    ];
    expect(mergeReviews(existing, fetched)).toEqual([existing[0], fetched[1]]);
  });

  it("keeps reviews with no reviewer id or date, since they cannot be matched", () => {
    const existing = [{ rating: 5, text: "a", date: null, verified: null, reviewerId: null }];
    const fetched = [{ rating: 4, text: "b", date: null, verified: null, reviewerId: null }];
    expect(mergeReviews(existing, fetched)).toHaveLength(2);
  });
});

describe("checkMoreDeeply", () => {
  it("fetches additional pages, merges them in, and re-scores", async () => {
    const page = { site: "amazon" as const, locale: "com", productId: "B0BXYZ1234" };
    const product = {
      title: "A very good widget",
      category: null,
      claimedRating: 4.6,
      reviewCount: null,
      site: "amazon" as const,
      locale: "com",
      url: "https://www.amazon.com/dp/B0BXYZ1234",
      thumbnailUrl: null,
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(`<script type="application/ld+json">${reviewsJson(30, (i) => (i < 25 ? 5 : 1))}</script>`),
    });

    const testDeps = deps();
    const result = await checkMoreDeeply(page, product, [], testDeps, {
      maxPages: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: () => Promise.resolve(),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.amazon.com/product-reviews/B0BXYZ1234/?pageNumber=1",
    );
    expect(result.reviews).toHaveLength(30);
    expect(result.outcome.status).toBe("ok");
  });
});
