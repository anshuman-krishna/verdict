// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReviewPages } from "../src/extract/fetchReviewPages";
import { resolveField } from "../src/extract/interpreter";
import type { FieldRule } from "../src/extract/rules";
import type { ProductSnapshot, Review } from "../src/extract/types";
import { getPref, setPref } from "../src/storage/prefs";
import {
  cacheKey,
  getCachedReviews,
  setCachedReviews,
} from "../src/storage/reviewsCache";

// this is the build gate from PRIVACY.md section 3: the five ways the
// default analysis path could reach the network are stubbed to throw, and
// every currently existing module that runs on that path is exercised
// against them. a future module that calls out unexpectedly fails this test
// instead of shipping silently.

function throwingStub(name: string) {
  return vi.fn(() => {
    throw new Error(`unexpected network call: ${name}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", throwingStub("fetch"));
  vi.stubGlobal("XMLHttpRequest", throwingStub("XMLHttpRequest"));
  vi.stubGlobal("WebSocket", throwingStub("WebSocket"));
  vi.stubGlobal("EventSource", throwingStub("EventSource"));
  vi.stubGlobal("navigator", { sendBeacon: throwingStub("navigator.sendBeacon") });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const product: ProductSnapshot = {
  title: "a product",
  category: "kitchen",
  claimedRating: 4.6,
  reviewCount: 100,
  site: "amazon",
  locale: "com",
  url: "https://www.amazon.com/dp/B000EXAMPLE",
  thumbnailUrl: null,
};

const review: Review = {
  rating: 5,
  text: "great",
  date: "2026-01-01",
  verified: true,
  reviewerId: "r-1",
};

describe("the default analysis path makes no network requests", () => {
  it("resolves fields with the rules interpreter without touching the network", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <script type="application/ld+json">{ "title": "a product" }</script>
      <div data-hook="review">first review</div>
    `;
    const embeddedJsonRule: FieldRule = { strategy: "embedded-json", path: "$.title" };
    expect(resolveField(container, embeddedJsonRule)).toEqual(["a product"]);

    const selectorRule: FieldRule = { strategy: "selector", value: "[data-hook='review']" };
    expect(resolveField(container, selectorRule)).toEqual(["first review"]);
  });

  it("reads and writes the local caches without touching the network", async () => {
    await setCachedReviews("no-network-product", "amazon", [review], product);
    const cached = await getCachedReviews("no-network-product", "amazon");
    expect(cached?.reviews).toEqual([review]);

    await setPref("historyEnabled", true);
    await expect(getPref<boolean>("historyEnabled")).resolves.toBe(true);

    await expect(cacheKey("another-product", "amazon")).resolves.toEqual(expect.any(String));
  });

  it("runs fetchReviewPages driven only by an injected fetcher, never the real network", async () => {
    const reviews = await fetchReviewPages({
      productId: "no-network-fetch",
      site: "amazon",
      product,
      fetchPage: async () => [review],
      maxPages: 1,
      delay: async () => {},
    });
    expect(reviews).toEqual([review]);
  });

  it("fails if something does call out, proving the stubs actually trap a request", () => {
    expect(() => fetch("https://example.com")).toThrow(/unexpected network call/);
    expect(() => new XMLHttpRequest()).toThrow(/unexpected network call/);
    expect(() => new WebSocket("wss://example.com")).toThrow(/unexpected network call/);
    expect(() => new EventSource("https://example.com")).toThrow(/unexpected network call/);
    expect(() => navigator.sendBeacon("https://example.com")).toThrow(/unexpected network call/);
  });
});
