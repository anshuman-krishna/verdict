// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_PAGES } from "../extract/fetchReviewPages";
import type { RulesDocument } from "../extract/rules";
import { reviewPageCap } from "../extract/sites";
import { localModelSet, type CombinerModel } from "../score/combine";
import { getPanelShadowRootForTesting, VerdictPanelElement } from "../ui/panel";
import "../ui/notice";
import {
  createProgressiveMount,
  everyPageReadMessage,
  mountResult,
  nextReadDepth,
  pageOnlyMessage,
  notEnoughReviewsMessage,
  removeMountedElements,
} from "./mount";
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
    priors: () => ({
      inputs: { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.5, 0.5] },
      key: null,
    }),
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
          probability: 0.5,
          claimedRating: 4.6,
          adjustedRating: 3.9,
          totalReviewCount: 100,
          excludedReviewCount: 10,
          estimatedInorganicShare: 0.1,
          confidence: { low: 0.05, high: 0.15 },
          evidence: [],
          unavailableSignals: [],
          absentSignals: [],
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
          probability: 0.5,
          claimedRating: 4.6,
          adjustedRating: 3.9,
          totalReviewCount: 100,
          excludedReviewCount: 10,
          estimatedInorganicShare: 0.1,
          confidence: { low: 0.05, high: 0.15 },
          evidence: [],
          unavailableSignals: [],
          absentSignals: [],
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

  it("says something for every outcome, since silence reads as no product page", () => {
    for (const outcome of [
      { status: "missing-features" as const, missing: ["x"] },
      { status: "no-model" as const },
      { status: "unreadable" as const },
    ]) {
      document.body.innerHTML = "";
      mountResult(document, { page: PAGE, product: PRODUCT, reviews: [], outcome }, deps());
      expect(document.body.querySelector("verdict-notice")).not.toBeNull();
    }
  });

  it("offers the status page for a listing it could not read", async () => {
    mountResult(
      document,
      { page: PAGE, product: null, reviews: [], outcome: { status: "unreadable" } },
      deps(),
    );

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    expect(root.querySelector(".message")?.textContent).toBe("Verdict could not read this page.");
    expect(root.querySelector<HTMLAnchorElement>(".link")?.href).toBe(
      "https://verdict.tools/status",
    );
  });

  it("names the signals it could not read", async () => {
    mountResult(
      document,
      {
        page: PAGE,
        product: PRODUCT,
        reviews: [],
        outcome: { status: "missing-features", missing: ["rating shape", "arrival timing"] },
      },
      deps(),
    );

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    expect(root.querySelector(".message")?.textContent).toContain("rating shape, arrival timing");
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

  it("draws nothing, and stops asking the storefront, once the reader has left", async () => {
    let answerFirstPage = (): void => {};
    const firstPage = new Promise<void>((resolve) => {
      answerFirstPage = resolve;
    });
    const reviews = Array.from({ length: 30 }, (_, i) => ({
      rating: i < 25 ? 5 : 1,
      text: `body number ${i} has enough distinguishing words to avoid near duplication`,
      date: `2024-01-${String((i % 25) + 1).padStart(2, "0")}`,
      verified: i % 2 === 0,
      reviewerId: `reviewer-${i}`,
    }));
    const page = `<script type="application/ld+json">${JSON.stringify({ reviewsData: { reviews } })}</script>`;
    const fetchImpl = vi.fn(async () => {
      await firstPage;
      return { ok: true, status: 200, text: () => Promise.resolve(page) };
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result: AnalysisResult = {
      page: PAGE,
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    mountResult(document, result, deps(), { maxPages: 5, delay: () => Promise.resolve(), cache: directReviewsCache });

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice") as InstanceType<typeof VerdictNoticeElement>;
    getNoticeShadowRootForTesting(notice).querySelector<HTMLButtonElement>(".action")?.click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    // what a soft navigation does to everything verdict drew
    removeMountedElements(document);
    answerFirstPage();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(document.body.querySelector("verdict-panel")).toBeNull();
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
        probability: 0.5,
        claimedRating: 4.6,
        adjustedRating: 3.9,
        totalReviewCount: 100,
        excludedReviewCount: 10,
        estimatedInorganicShare: 0.1,
        confidence: { low: 0.05, high: 0.15 },
        evidence: [],
        unavailableSignals: [],
        absentSignals: [],
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
  probability: 0.5,
  claimedRating: 4.6,
  adjustedRating: 3.9,
  totalReviewCount: 100,
  excludedReviewCount: 10,
  estimatedInorganicShare: 0.1,
  confidence: { low: 0.05, high: 0.15 },
  evidence: [],
  unavailableSignals: [],
  absentSignals: [],
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

describe("what the not enough reviews notice says", () => {
  it("gives the count, so the reader knows how thin it was", () => {
    expect(notEnoughReviewsMessage(12)).toBe("Not enough reviews to judge this one. 12 reviews found.");
  });

  it("counts one review as one", () => {
    expect(notEnoughReviewsMessage(1)).toBe("Not enough reviews to judge this one. 1 review found.");
  });

  it("says none found rather than leaving the number out", () => {
    expect(notEnoughReviewsMessage(0)).toContain("0 reviews found");
  });

  it("groups a large count the way the rest of the panel does", () => {
    expect(notEnoughReviewsMessage(8431)).toContain("8,431 reviews");
  });

  it("says a page only platform has nothing further, rather than counting pages it never read", () => {
    const result: AnalysisResult = {
      page: { site: "google-maps", locale: "com", productId: "0xab12cd" },
      product: PRODUCT,
      reviews: [],
      outcome: { status: "not-enough-data" },
    };
    const message = pageOnlyMessage(result);
    expect(message).toContain("no further pages");
    expect(message).not.toContain("0 pages");
  });
});

describe("what a second check more deeply is allowed to do, SPEC.md section 9", () => {
  const thin = (fetch?: AnalysisResult["fetch"]): AnalysisResult => ({
    page: PAGE,
    product: PRODUCT,
    reviews: [],
    outcome: { status: "not-enough-data" },
    ...(fetch === undefined ? {} : { fetch }),
  });

  it("reads five pages before anything has been fetched", () => {
    expect(nextReadDepth(thin(), { cache: directReviewsCache })).toBe(DEFAULT_MAX_PAGES);
  });

  it("goes to the storefront's own ceiling once five pages were not enough", () => {
    const depth = nextReadDepth(
      thin({ pagesFetched: 5, maxPages: 5, stoppedBecause: "complete" }),
      { cache: directReviewsCache },
    );
    expect(depth).toBe(reviewPageCap(PAGE.site));
    expect(depth).toBeGreaterThan(DEFAULT_MAX_PAGES);
  });

  it("offers nothing deeper on a platform with no review page url", () => {
    const placePage = { site: "google-maps", locale: "com", productId: "0xab12cd" };
    expect(nextReadDepth({ ...thin(), page: placePage }, { cache: directReviewsCache })).toBeNull();
  });

  it("offers nothing deeper once the listing ran out of pages", () => {
    for (const stoppedBecause of ["exhausted", "repeated"] as const) {
      expect(
        nextReadDepth(thin({ pagesFetched: 3, maxPages: 5, stoppedBecause }), {
          cache: directReviewsCache,
        }),
      ).toBeNull();
    }
  });

  it("offers nothing deeper once the ceiling itself was reached", () => {
    const cap = reviewPageCap(PAGE.site);
    expect(
      nextReadDepth(thin({ pagesFetched: cap, maxPages: cap, stoppedBecause: "complete" }), {
        cache: directReviewsCache,
      }),
    ).toBeNull();
  });

  it("asks again at the same depth when the storefront stopped answering", () => {
    expect(
      nextReadDepth(thin({ pagesFetched: 2, maxPages: 5, stoppedBecause: "failed" }), {
        cache: directReviewsCache,
      }),
    ).toBe(5);
  });

  it("renders a notice with no action rather than a button that reads nothing", async () => {
    mountResult(document, thin({ pagesFetched: 3, maxPages: 5, stoppedBecause: "exhausted" }), deps());

    const { getNoticeShadowRootForTesting, VerdictNoticeElement } = await import("../ui/notice");
    const notice = document.body.querySelector("verdict-notice");
    const root = getNoticeShadowRootForTesting(notice as InstanceType<typeof VerdictNoticeElement>);
    expect(root.querySelector(".action")).toBeNull();
    expect(root.querySelector(".message")?.textContent).toContain("every page this listing has");
  });

  it("says how far it read rather than claiming the listing is out of pages", () => {
    const cap = reviewPageCap(PAGE.site);
    const message = everyPageReadMessage(
      thin({ pagesFetched: cap, maxPages: cap, stoppedBecause: "complete" }),
    );
    expect(message).toContain(`${cap} pages`);
    expect(message).toContain("as deep as Verdict reads");
  });
});

describe("removeMountedElements", () => {
  it("takes down a panel", () => {
    document.body.innerHTML = "<verdict-panel></verdict-panel>";
    removeMountedElements(document);
    expect(document.querySelector("verdict-panel")).toBeNull();
  });

  it("takes down a notice", () => {
    document.body.innerHTML = "<verdict-notice></verdict-notice>";
    removeMountedElements(document);
    expect(document.querySelector("verdict-notice")).toBeNull();
  });

  it("takes down more than one at a time", () => {
    document.body.innerHTML =
      "<verdict-panel></verdict-panel><verdict-notice></verdict-notice><verdict-notice></verdict-notice>";
    removeMountedElements(document);
    expect(document.body.children).toHaveLength(0);
  });

  it("leaves the storefront's own page alone", () => {
    document.body.innerHTML = '<div id="productTitle">a product</div><verdict-panel></verdict-panel>';
    removeMountedElements(document);
    expect(document.getElementById("productTitle")).not.toBeNull();
  });

  it("does nothing when nothing is mounted", () => {
    document.body.innerHTML = "<div>just the page</div>";
    expect(() => removeMountedElements(document)).not.toThrow();
    expect(document.body.children).toHaveLength(1);
  });
});

describe("saving a listing from the panel", () => {
  const VECTOR = {
    meetsMinimumData: true,
    ratingDeconvolution: { injectedShare: 0.1, residualError: 0.01 },
    temporalBurst: { bursts: [], burstFraction: 0, burstCount: 0, largestBurstShare: 0 },
    verificationConcentration: null,
    textNearDuplication: { duplicateReviewShare: 0, clusterCount: 0, largestClusterShare: 0 },
    listingDrift: {
      offTopicShare: null,
      offTopicCount: 0,
      meanDistance: null,
      changePoint: null,
      driftStatistic: 0,
      embeddedCount: 0,
    },
    reviewerGraph: null,
  } as never;

  function okResult(): AnalysisResult {
    return {
      page: PAGE,
      product: PRODUCT,
      productKey: "key-1",
      reviews: [],
      outcome: {
        status: "ok",
        report: {
          serial: "AAAA-BBBB",
          band: "mixed",
          probability: 0.5,
          claimedRating: 4.6,
          adjustedRating: 3.9,
          totalReviewCount: 100,
          excludedReviewCount: 10,
          estimatedInorganicShare: 0.1,
          confidence: { low: 0.05, high: 0.15 },
          evidence: [],
          unavailableSignals: [],
          absentSignals: [],
          generatedAt: 0,
        },
        featureVector: VECTOR,
      },
    };
  }

  function pressWatch(): void {
    const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".watch-toggle")?.click();
  }

  it("asks the port to save it, with the local key and never the url", () => {
    const watchToggle = vi.fn().mockResolvedValue({ watching: true, entry: null, changes: [] });

    mountResult(document, okResult(), { ...deps(), watchToggle });
    pressWatch();

    expect(watchToggle).toHaveBeenCalledWith(
      expect.objectContaining({
        watching: true,
        productKey: "key-1",
        site: "amazon",
        title: "A very good widget",
      }),
    );
    expect(JSON.stringify(watchToggle.mock.calls[0])).not.toContain("amazon.com/dp");
  });

  it("redraws the panel with what the port answered", async () => {
    const watchToggle = vi.fn().mockResolvedValue({
      watching: true,
      entry: {
        productKey: "key-1",
        site: "amazon",
        title: "A very good widget",
        thumbnailUrl: null,
        savedAt: Date.now(),
        lastSeenAt: Date.now(),
        checkCount: 1,
        baseline: { at: 0, band: null, probability: null, claimedRating: null, adjustedRating: null, totalReviewCount: null, features: null },
        latest: { at: 0, band: null, probability: null, claimedRating: null, adjustedRating: null, totalReviewCount: null, features: null },
      },
      changes: [],
    });

    mountResult(document, okResult(), { ...deps(), watchToggle });
    pressWatch();
    await vi.waitFor(() => {
      const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
      const toggle = getPanelShadowRootForTesting(panel).querySelector(".watch-toggle");
      expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("leaves the panel alone when the port refuses", async () => {
    const watchToggle = vi.fn().mockRejectedValue(new Error("no room"));

    mountResult(document, okResult(), { ...deps(), watchToggle });
    pressWatch();
    await Promise.resolve();

    const panel = document.body.querySelector("verdict-panel") as VerdictPanelElement;
    const toggle = getPanelShadowRootForTesting(panel).querySelector(".watch-toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("does nothing at all on a build with no watchlist port", () => {
    mountResult(document, okResult(), deps());

    expect(() => pressWatch()).not.toThrow();
  });
});
