// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_PAGES } from "../extract/fetchReviewPages";
import type { RulesDocument } from "../extract/rules";
import { localModelSet, type CombinerModel } from "../score/combine";
import { getPanelShadowRootForTesting, VerdictPanelElement } from "../ui/panel";
import "../ui/notice";
import { createProgressiveMount, mountResult } from "./mount";
import type { AnalysisResult, OrchestratorDeps } from "./orchestrator";
import { directReviewsCache } from "../storage/reviewsCache";

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
    model: localModelSet(MODEL),
    priors: { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.5, 0.5] },
    isHistoryEnabled: vi.fn().mockResolvedValue(false),
    saveHistory: vi.fn().mockResolvedValue(undefined),
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
          unavailableSignals: [],
          generatedAt: 0,
        },
        featureVector: {} as never,
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
          unavailableSignals: [],
          generatedAt: 0,
        },
        featureVector: {} as never,
      },
    };
    const openTab = vi.fn();
    mountResult(document, result, deps(), { cache: directReviewsCache }, openTab);

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

  it("shows partial results under the busy notice from the moment checking starts", async () => {
    // each page carries its own four reviewers, as a real second page would
    const pageOfReviews = (page: number) =>
      Array.from({ length: 4 }, (_, i) => ({
        rating: 5,
        text: `page ${page} body number ${i} has enough distinguishing words to avoid near duplication`,
        date: `2024-01-0${i + 1}`,
        verified: true,
        reviewerId: `reviewer-${page}-${i}`,
      }));
    let pageNumber = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        pageNumber++;
        const reviews = pageOfReviews(pageNumber);
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              `<script type="application/ld+json">${JSON.stringify({ reviewsData: { reviews } })}</script>`,
            ),
        });
      }),
    );

    const result: AnalysisResult = {
      page: { ...PAGE, productId: "B0PROGRESS1" },
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    mountResult(document, result, deps(), { maxPages: 2, delay: () => Promise.resolve(), cache: directReviewsCache });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    root.querySelector<HTMLButtonElement>(".action")?.click();

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
    mountResult(document, result, deps(), { delay: () => Promise.resolve(), cache: directReviewsCache });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    root.querySelector<HTMLButtonElement>(".action")?.click();

    expect(root.querySelector(".progress")?.textContent).toBe(
      `Reading up to ${DEFAULT_MAX_PAGES} more pages of reviews.`,
    );

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
    mountResult(document, result, deps(), { maxPages: 1, delay: () => Promise.resolve(), cache: directReviewsCache });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    expect(notice).toBeInstanceOf(VerdictNoticeElement);
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    root.querySelector<HTMLButtonElement>(".action")?.click();

    await vi.waitFor(() => {
      expect(document.body.querySelector("verdict-panel")).not.toBeNull();
    });
    expect(document.body.querySelector("verdict-notice")).toBeNull();
  });
});

function okResult(band: "mixed" | "clean" = "mixed"): AnalysisResult {
  return {
    page: PAGE,
    product: PRODUCT,
    reviews: [],
    outcome: {
      status: "ok",
      report: {
        serial: "AAAA-BBBB",
        band,
        claimedRating: 4.6,
        adjustedRating: 3.9,
        totalReviewCount: 100,
        excludedReviewCount: 10,
        estimatedInorganicShare: 0.1,
        confidence: { low: 0.05, high: 0.15 },
        evidence: [],
        unavailableSignals: [],
        generatedAt: 0,
      },
      featureVector: {} as never,
    },
  };
}

describe("createProgressiveMount, SPEC.md section 13 first paint", () => {
  it("shows a waiting notice when the analysis outruns the budget", () => {
    createProgressiveMount(document, deps()).waiting();
    expect(document.body.querySelector("verdict-notice")).not.toBeNull();
  });

  it("shows nothing at all when a result already arrived in time", () => {
    const mount = createProgressiveMount(document, deps());
    mount.show(okResult(), []);
    mount.waiting();
    expect(document.body.querySelector("verdict-notice")).toBeNull();
    expect(document.body.querySelectorAll("verdict-panel")).toHaveLength(1);
  });

  it("replaces the waiting notice with the panel once a stage lands", () => {
    const mount = createProgressiveMount(document, deps());
    mount.waiting();
    mount.show(okResult(), ["reviewer network"]);
    expect(document.body.querySelector("verdict-notice")).toBeNull();
    expect(document.body.querySelector("verdict-panel")).not.toBeNull();
  });

  it("names what is still being read while the estimate is provisional", () => {
    const mount = createProgressiveMount(document, deps());
    mount.show(okResult(), ["reviewer network"]);
    const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
    const root = getPanelShadowRootForTesting(panel);
    expect(root.querySelector(".pending")?.textContent).toContain("reviewer network");
  });

  it("updates the one panel in place rather than stacking a second", () => {
    const mount = createProgressiveMount(document, deps());
    mount.show(okResult("mixed"), ["reviewer network"]);
    mount.show(okResult("clean"), []);
    expect(document.body.querySelectorAll("verdict-panel")).toHaveLength(1);
    const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
    const root = getPanelShadowRootForTesting(panel);
    expect(root.querySelector(".summary")?.textContent).toContain("clean");
    expect(root.querySelector(".pending")).toBeNull();
  });

  it("never reopens a panel the reader closed while it was still provisional", () => {
    const mount = createProgressiveMount(document, deps());
    mount.show(okResult(), ["reviewer network"]);
    const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".close")?.click();

    mount.show(okResult(), []);

    expect(document.body.querySelector("verdict-panel")).toBeNull();
  });

  it("never reopens after the waiting notice was closed either", () => {
    const mount = createProgressiveMount(document, deps());
    mount.waiting();
    const notice = document.body.querySelector("verdict-notice") as HTMLElement;
    notice.dispatchEvent(new CustomEvent("verdict:close", { bubbles: true, composed: true }));

    mount.show(okResult(), []);

    expect(document.body.querySelector("verdict-panel")).toBeNull();
    expect(document.body.querySelector("verdict-notice")).toBeNull();
  });

  it("holds back the not-enough-data notice until nothing is pending", () => {
    const mount = createProgressiveMount(document, deps());
    const thin: AnalysisResult = { ...okResult(), outcome: { status: "not-enough-data" } };
    mount.show(thin, ["reviewer network"]);
    expect(document.body.querySelector("verdict-notice")).toBeNull();

    mount.show(thin, []);
    expect(document.body.querySelector("verdict-notice")).not.toBeNull();
  });
});

describe("createProgressiveMount, settling after a failure", () => {
  it("drops the provisional wording when the analysis never finishes", () => {
    const mount = createProgressiveMount(document, deps());
    mount.show(okResult(), ["reviewer network"]);
    mount.settle();
    const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
    expect(getPanelShadowRootForTesting(panel).querySelector(".pending")).toBeNull();
  });

  it("clears a waiting notice that nothing will ever replace", () => {
    const mount = createProgressiveMount(document, deps());
    mount.waiting();
    mount.settle();
    expect(document.body.querySelector("verdict-notice")).toBeNull();
  });
});

const REPORT = {
  serial: "AAAA-BBBB",
  band: "mixed" as const,
  claimedRating: 4.6,
  adjustedRating: 3.9,
  totalReviewCount: 100,
  excludedReviewCount: 10,
  estimatedInorganicShare: 0.1,
  confidence: { low: 0.05, high: 0.15 },
  evidence: [],
  unavailableSignals: [],
  generatedAt: 0,
};

describe("where the full report button goes", () => {
  it("opens the popup at the report the panel was showing", () => {
    const openTab = vi.fn();
    const result: AnalysisResult = {
      page: PAGE,
      product: PRODUCT,
      reviews: [],
      outcome: { status: "ok", report: REPORT, featureVector: {} as never },
    };
    mountResult(document, result, deps(), { cache: directReviewsCache }, openTab);

    const panel = document.body.querySelector("verdict-panel") as InstanceType<
      typeof VerdictPanelElement
    >;
    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".full-report")?.click();

    expect(openTab).toHaveBeenCalledWith(expect.stringContaining(`#${REPORT.serial}`));
  });
});
