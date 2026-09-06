// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_PAGES } from "../extract/fetchReviewPages";
import type { RulesDocument } from "../extract/rules";
import type { CombinerModel } from "../score/combine";
import { getPanelShadowRootForTesting, VerdictPanelElement } from "../ui/panel";
import "../ui/notice";
import { mountResult } from "./mount";
import type { AnalysisResult, OrchestratorDeps } from "./orchestrator";

const PAGE = { site: "amazon" as const, locale: "com", productId: "B0EXAMPLE1" };
const PRODUCT = {
  title: "A very good widget",
  category: null,
  claimedRating: 4.6,
  reviewCount: null,
  site: "amazon" as const,
  locale: "com",
  url: "https://www.amazon.com/dp/B0EXAMPLE1",
  thumbnailUrl: null,
};

const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com"],
  fields: { reviews: { strategy: "embedded-json", path: "$.reviewsData.reviews[*]" } },
};

const MODEL: CombinerModel = {
  intercept: -1,
  coefficients: { "ratingDeconvolution.injectedShare": 3 },
  calibration: [],
};

function deps(): OrchestratorDeps {
  return {
    rules: RULES,
    model: MODEL,
    priors: { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.5, 0.5] },
    isHistoryEnabled: vi.fn().mockResolvedValue(false),
    saveHistory: vi.fn().mockResolvedValue(undefined),
    // these tests exercise mounting and the check-more-deeply flow, not
    // the confidence interval, so a small resample count keeps them fast.
    bootstrapResamples: 5,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("mountResult", () => {
  it("mounts a verdict-panel for an ok outcome", () => {
    const result: AnalysisResult = {
      page: PAGE,
      product: PRODUCT,
      reviews: [],
      outcome: {
        status: "ok",
        report: {
          serial: "AAAA-BBBB",
          band: "mixed",
          claimedRating: 4.6,
          adjustedRating: 3.9,
          totalReviewCount: 100,
          excludedReviewCount: 10,
          estimatedInorganicShare: 0.1,
          confidence: { low: 0.05, high: 0.15 },
          evidence: [],
          generatedAt: 0,
        },
      },
    };
    mountResult(document, result, deps());
    expect(document.body.querySelector("verdict-panel")).not.toBeNull();
    expect(document.body.querySelector("verdict-notice")).toBeNull();
  });

  it("opens the extension's popup page when the full report button is clicked", () => {
    const result: AnalysisResult = {
      page: PAGE,
      product: PRODUCT,
      reviews: [],
      outcome: {
        status: "ok",
        report: {
          serial: "AAAA-BBBB",
          band: "mixed",
          claimedRating: 4.6,
          adjustedRating: 3.9,
          totalReviewCount: 100,
          excludedReviewCount: 10,
          estimatedInorganicShare: 0.1,
          confidence: { low: 0.05, high: 0.15 },
          evidence: [],
          generatedAt: 0,
        },
      },
    };
    const openTab = vi.fn();
    mountResult(document, result, deps(), {}, openTab);

    const panel = document.body.querySelector("verdict-panel") as InstanceType<
      typeof VerdictPanelElement
    >;
    const root = getPanelShadowRootForTesting(panel);
    root.querySelector<HTMLButtonElement>(".full-report")?.click();

    expect(openTab).toHaveBeenCalledOnce();
    expect(openTab.mock.calls[0]?.[0]).toContain("popup.html");
  });

  it("mounts a verdict-notice with a check more deeply action for not-enough-data", () => {
    const result: AnalysisResult = {
      page: PAGE,
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    mountResult(document, result, deps());
    expect(document.body.querySelector("verdict-panel")).toBeNull();
    expect(document.body.querySelector("verdict-notice")).not.toBeNull();
  });

  it("mounts nothing for missing-features or no-model outcomes", () => {
    for (const outcome of [
      { status: "missing-features" as const, missing: ["x"] },
      { status: "no-model" as const },
    ]) {
      document.body.innerHTML = "";
      mountResult(document, { page: PAGE, product: PRODUCT, reviews: [], outcome }, deps());
      expect(document.body.children).toHaveLength(0);
    }
  });

  // SPEC.md section 13: "verdict never shows a spinner longer than 400 ms
  // without showing partial results underneath." A review fetch is spaced
  // at least 800ms per page, so the busy notice has to carry something
  // from the moment it appears, and has to keep it current as pages land.
  it("shows partial results under the busy notice from the moment checking starts", async () => {
    const reviews = Array.from({ length: 4 }, (_, i) => ({
      rating: 5,
      text: `body number ${i} has enough distinguishing words to avoid near duplication`,
      date: `2024-01-0${i + 1}`,
      verified: true,
      reviewerId: `reviewer-${i}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            `<script type="application/ld+json">${JSON.stringify({ reviewsData: { reviews } })}</script>`,
          ),
      }),
    );

    const result: AnalysisResult = {
      // fetchReviewPages caches by product id and fake-indexeddb keeps that
      // cache for the whole file, so every test that fetches needs its own.
      page: { ...PAGE, productId: "B0PROGRESS1" },
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    mountResult(document, result, deps(), { maxPages: 2, delay: () => Promise.resolve() });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    root.querySelector<HTMLButtonElement>(".action")?.click();

    // synchronously after the click, before any page has come back
    expect(root.querySelector(".progress")?.textContent).toBe(
      "Reading up to 2 more pages of reviews.",
    );

    await vi.waitFor(() => {
      expect(root.querySelector(".progress")?.textContent).toBe(
        "2 of 2 pages read, 8 reviews so far.",
      );
    });
  });

  it("defaults the progress line to the fetcher's own page cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve("") }));
    const result: AnalysisResult = {
      page: { ...PAGE, productId: "B0PROGRESS2" },
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    mountResult(document, result, deps(), { delay: () => Promise.resolve() });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    root.querySelector<HTMLButtonElement>(".action")?.click();

    expect(root.querySelector(".progress")?.textContent).toBe(
      `Reading up to ${DEFAULT_MAX_PAGES} more pages of reviews.`,
    );

    // every page came back empty, so the run ends back on a fresh notice.
    // waited on rather than left running, so the chain cannot settle into
    // a later test's document.
    await vi.waitFor(() => {
      expect(document.body.querySelector("verdict-notice")).not.toBe(notice);
    });
  });

  it("checking more deeply replaces the notice with a panel once enough data is fetched", async () => {
    const reviews = Array.from({ length: 30 }, (_, i) => ({
      rating: i < 25 ? 5 : 1,
      text: `body number ${i} has enough distinguishing words to avoid near duplication`,
      date: `2024-01-${String((i % 25) + 1).padStart(2, "0")}`,
      verified: i % 2 === 0,
      reviewerId: `reviewer-${i}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            `<script type="application/ld+json">${JSON.stringify({ reviewsData: { reviews } })}</script>`,
          ),
      }),
    );

    const result: AnalysisResult = {
      page: PAGE,
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    mountResult(document, result, deps(), { maxPages: 1, delay: () => Promise.resolve() });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    expect(notice).toBeInstanceOf(VerdictNoticeElement);
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    root.querySelector<HTMLButtonElement>(".action")?.click();

    // let the checkMoreDeeply promise chain settle
    await vi.waitFor(() => {
      expect(document.body.querySelector("verdict-panel")).not.toBeNull();
    });
    expect(document.body.querySelector("verdict-notice")).toBeNull();
  });
});
