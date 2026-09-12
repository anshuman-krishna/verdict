import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RulesDocument } from "../extract/rules";
import {
  addHistoryEntry,
  deleteAllHistory,
  exportHistoryAsCsv,
  exportHistoryAsJson,
  listHistory,
} from "../storage/history";
import { deriveAllowedHostnames, handleBridgeMessage, type BridgeHandlerOptions } from "./handler";
import { isBridgeRequest } from "./messages";
import { BridgeRateLimiter, RATE_LIMITS } from "./rateLimit";

const AMAZON: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com", "co.uk"],
  fields: {},
};

const RULES: Readonly<Record<string, RulesDocument>> = { amazon: AMAZON };

function options(overrides: Partial<BridgeHandlerOptions> = {}): BridgeHandlerOptions {
  return {
    bundledRules: RULES,
    analyzeUrl: vi.fn().mockRejectedValue(new Error("analyzeUrl should not have been called")),
    ...overrides,
  };
}

describe("isBridgeRequest", () => {
  it("accepts every declared message shape", () => {
    expect(isBridgeRequest({ type: "verdict:history:list" })).toBe(true);
    expect(isBridgeRequest({ type: "verdict:history:clear" })).toBe(true);
    expect(isBridgeRequest({ type: "verdict:analyze", url: "https://amazon.com/dp/x" })).toBe(
      true,
    );
    expect(isBridgeRequest({ type: "verdict:history:export", format: "csv" })).toBe(true);
    expect(isBridgeRequest({ type: "verdict:report:get", id: 3 })).toBe(true);
  });

  it("rejects an analyze request missing its url", () => {
    expect(isBridgeRequest({ type: "verdict:analyze" })).toBe(false);
  });

  it("rejects an unrecognised type, and non object input", () => {
    expect(isBridgeRequest({ type: "verdict:delete:everything" })).toBe(false);
    expect(isBridgeRequest(null)).toBe(false);
    expect(isBridgeRequest("verdict:history:list")).toBe(false);
  });
});

describe("deriveAllowedHostnames", () => {
  it("returns the registry domains for the locales the rules cover", () => {
    expect(deriveAllowedHostnames(RULES)).toEqual(["amazon.com", "amazon.co.uk"]);
  });

  it("drops a locale the registry does not know", () => {
    expect(deriveAllowedHostnames({ amazon: { ...AMAZON, locales: ["com", "invented"] } })).toEqual([
      "amazon.com",
    ]);
  });

  it("returns nothing for a site the registry does not carry", () => {
    expect(deriveAllowedHostnames({ nowhere: { ...AMAZON, site: "nowhere" } })).toEqual([]);
  });

  it("allows every site this build carries rules for", () => {
    const hostnames = deriveAllowedHostnames({
      amazon: { ...AMAZON, locales: ["com"] },
      other: { ...AMAZON, site: "other", locales: ["com"] },
    });
    expect(hostnames).toEqual(["amazon.com"]);
  });

  it("returns nothing when this build carries rules for no site at all", () => {
    expect(deriveAllowedHostnames({})).toEqual([]);
  });
});

describe("handleBridgeMessage", () => {
  it("rejects a message that is not a recognised bridge request", async () => {
    const response = await handleBridgeMessage({ type: "not:a:thing" }, options());
    expect(response).toEqual({ error: "unrecognised message" });
  });

  it("lists history entries with their report summarized", async () => {
    await deleteAllHistory();
    await addHistoryEntry({
      title: "wireless mouse",
      thumbnailUrl: "https://x/y.jpg",
      report: { band: "mixed", claimedRating: 4.5, adjustedRating: 3.9, estimatedInorganicShare: 0.2 },
    });

    const response = await handleBridgeMessage(
      { type: "verdict:history:list" },
      options(),
    );

    expect(response).toEqual({
      entries: [
        {
          id: expect.any(Number),
          timestamp: expect.any(Number),
          title: "wireless mouse",
          thumbnailUrl: "https://x/y.jpg",
          productKey: null,
          band: "mixed",
          claimedRating: 4.5,
          adjustedRating: 3.9,
          estimatedInorganicShare: 0.2,
        },
      ],
    });
  });

  it("clears history", async () => {
    await addHistoryEntry({ title: "will be cleared", thumbnailUrl: null, report: {} });
    const response = await handleBridgeMessage(
      { type: "verdict:history:clear" },
      options(),
    );
    expect(response).toEqual({ ok: true });

    const after = await handleBridgeMessage(
      { type: "verdict:history:list" },
      options(),
    );
    expect(after).toEqual({ entries: [] });
  });

  it("rejects an analyze request for a domain outside the bundled rules", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://not-a-supported-store.example/product/1" },
      options(),
    );
    expect(response).toEqual({ status: "unsupported-domain" });
  });

  it("rejects a supported domain reached over plain http", async () => {
    const analyzeUrl = vi.fn();
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "http://www.amazon.com/dp/B000000000" },
      options({ analyzeUrl }),
    );
    expect(response).toEqual({ status: "unsupported-domain" });
    expect(analyzeUrl).not.toHaveBeenCalled();
  });

  it("rejects a url whose scheme is not http at all", async () => {
    const analyzeUrl = vi.fn();
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script></script>",
      "file:///etc/passwd",
      "ftp://www.amazon.com/dp/B000000000",
    ]) {
      const response = await handleBridgeMessage(
        { type: "verdict:analyze", url },
        options({ analyzeUrl }),
      );
      expect(response).toEqual({ status: "unsupported-domain" });
    }
    expect(analyzeUrl).not.toHaveBeenCalled();
  });

  it("is not fooled by a supported domain sitting in the userinfo of another host", async () => {
    const analyzeUrl = vi.fn();
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://www.amazon.com@evil.example/dp/B000000000" },
      options({ analyzeUrl }),
    );
    expect(response).toEqual({ status: "unsupported-domain" });
    expect(analyzeUrl).not.toHaveBeenCalled();
  });

  it("rejects an analyze request that is not even a valid url", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "not a url" },
      options(),
    );
    expect(response).toEqual({ status: "unsupported-domain" });
  });

  it("accepts a supported domain, including a www subdomain, and hands it to analyzeUrl", async () => {
    const analyzeUrl = vi.fn().mockResolvedValue({ status: "no-model" });

    const bare = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://amazon.com/dp/B000000000" },
      options({ analyzeUrl }),
    );
    expect(bare).toEqual({ status: "no-model" });
    expect(analyzeUrl).toHaveBeenCalledWith("https://amazon.com/dp/B000000000");

    const withSubdomain = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://www.amazon.co.uk/dp/B000000000" },
      options({ analyzeUrl }),
    );
    expect(withSubdomain).toEqual({ status: "no-model" });
    expect(analyzeUrl).toHaveBeenCalledWith("https://www.amazon.co.uk/dp/B000000000");
  });

  it("never calls analyzeUrl for a domain the bridge already rejected", async () => {
    const analyzeUrl = vi.fn().mockRejectedValue(new Error("must not be called"));
    await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://not-a-supported-store.example/product/1" },
      options({ analyzeUrl }),
    );
    expect(analyzeUrl).not.toHaveBeenCalled();
  });

  it("does not let a lookalike hostname past the dot boundary check", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://evil-amazon.com/dp/x" },
      options(),
    );
    expect(response).toEqual({ status: "unsupported-domain" });
  });
});

describe("rate limiting", () => {
  const rules: RulesDocument = {
    version: 1,
    site: "amazon",
    locales: ["com"],
    fields: {},
  };

  function options(rateLimiter: BridgeRateLimiter, origin: string | undefined): BridgeHandlerOptions {
    return {
      bundledRules: { amazon: rules },
      analyzeUrl: async () => ({ status: "not-a-product-page" }) as const,
      rateLimiter,
      origin,
    };
  }

  it("rejects a request past the limit without touching storage or a tab", async () => {
    const limiter = new BridgeRateLimiter(() => 1_000);
    const analyzeUrl = vi.fn(async () => ({ status: "not-a-product-page" }) as const);
    const deps = {
      bundledRules: { amazon: rules },
      analyzeUrl,
      rateLimiter: limiter,
      origin: "https://verdict.tools",
    };
    const request = { type: "verdict:analyze", url: "https://www.amazon.com/dp/B0ABCDEF12" };

    for (let index = 0; index < RATE_LIMITS["verdict:analyze"].limit; index += 1) {
      await handleBridgeMessage(request, deps);
    }
    const callsBefore = analyzeUrl.mock.calls.length;

    expect(await handleBridgeMessage(request, deps)).toEqual({ error: "rate limited" });
    expect(analyzeUrl.mock.calls.length).toBe(callsBefore);
  });

  it("refuses a sender whose origin the runtime did not report", async () => {
    const limiter = new BridgeRateLimiter(() => 1_000);
    expect(
      await handleBridgeMessage({ type: "verdict:history:list" }, options(limiter, undefined)),
    ).toEqual({ error: "unknown origin" });
  });

  it("spends no allowance on an unrecognised message", async () => {
    const limiter = new BridgeRateLimiter(() => 1_000);
    const deps = options(limiter, "https://verdict.tools");
    for (let index = 0; index < 500; index += 1) {
      await handleBridgeMessage({ type: "verdict:nonsense" }, deps);
    }
    expect(
      await handleBridgeMessage(
        { type: "verdict:analyze", url: "https://www.amazon.com/dp/B0ABCDEF12" },
        deps,
      ),
    ).not.toEqual({ error: "rate limited" });
  });

  it("limits each origin separately", async () => {
    const limiter = new BridgeRateLimiter(() => 1_000);
    const request = { type: "verdict:analyze", url: "https://www.amazon.com/dp/B0ABCDEF12" };
    for (let index = 0; index < RATE_LIMITS["verdict:analyze"].limit; index += 1) {
      await handleBridgeMessage(request, options(limiter, "http://localhost:4321"));
    }
    expect(await handleBridgeMessage(request, options(limiter, "http://localhost:4321"))).toEqual({
      error: "rate limited",
    });
    expect(
      await handleBridgeMessage(request, options(limiter, "https://verdict.tools")),
    ).not.toEqual({ error: "rate limited" });
  });
});

describe("history export", () => {
  function options(): BridgeHandlerOptions {
    return {
      bundledRules: RULES,
      analyzeUrl: async () => ({ status: "not-a-product-page" }) as const,
    };
  }

  beforeEach(async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: { band: "clean" } });
  });

  it("returns the same json the options page writes", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:history:export", format: "json" },
      options(),
    );
    expect((response as { content: string }).content).toBe(await exportHistoryAsJson());
  });

  it("returns the same csv the options page writes", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:history:export", format: "csv" },
      options(),
    );
    expect((response as { content: string }).content).toBe(await exportHistoryAsCsv());
  });

  it("names the file so two exports do not overwrite each other", async () => {
    const response = (await handleBridgeMessage(
      { type: "verdict:history:export", format: "csv" },
      options(),
    )) as { filename: string; format: string };
    expect(response.filename).toMatch(/^verdict-history-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(response.format).toBe("csv");
  });

  it("rejects a format it does not produce", async () => {
    expect(
      await handleBridgeMessage({ type: "verdict:history:export", format: "pdf" }, options()),
    ).toEqual({ error: "unrecognised message" });
  });

  it("rejects a request with no format at all", async () => {
    expect(await handleBridgeMessage({ type: "verdict:history:export" }, options())).toEqual({
      error: "unrecognised message",
    });
  });

  it("returns nothing that could be review text", async () => {
    const response = (await handleBridgeMessage(
      { type: "verdict:history:export", format: "json" },
      options(),
    )) as { content: string };
    expect(response.content).not.toContain("reviews");
  });
});

describe("verdict:report:get", () => {
  const stored = {
    serial: "7QK2-M4P9",
    band: "mixed",
    claimedRating: 4.6,
    adjustedRating: 3.9,
    totalReviewCount: 120,
    excludedReviewCount: 30,
    estimatedInorganicShare: 0.25,
    confidence: { low: 0.18, high: 0.33 },
    evidence: [{ signal: "arrival timing", strength: "moderate", detail: "two bursts.", value: 0.12 }],
    unavailableSignals: [],
    generatedAt: 1_700_000_000_000,
  };

  it("returns the whole report for a check the user made", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: stored });
    const [entry] = await listHistory();

    const response = await handleBridgeMessage(
      { type: "verdict:report:get", id: entry?.id },
      options(),
    );

    expect(response).toEqual({ report: stored });
  });

  it("returns nothing for an id the user has no check for", async () => {
    await deleteAllHistory();
    await expect(
      handleBridgeMessage({ type: "verdict:report:get", id: 9999 }, options()),
    ).resolves.toEqual({ report: null });
  });

  it("returns nothing rather than a half report an older build stored", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: { band: "mixed" } });
    const [entry] = await listHistory();

    await expect(
      handleBridgeMessage({ type: "verdict:report:get", id: entry?.id }, options()),
    ).resolves.toEqual({ report: null });
  });

  it("refuses a request whose id is not a whole number", async () => {
    for (const id of ["1", 1.5, null, undefined, Number.NaN]) {
      await expect(handleBridgeMessage({ type: "verdict:report:get", id }, options())).resolves.toEqual(
        { error: "unrecognised message" },
      );
    }
  });
});

describe("the product key the site groups by", () => {
  it("carries the hash the extension stored, and never anything else about the product", async () => {
    await deleteAllHistory();
    await addHistoryEntry({
      title: "a product",
      thumbnailUrl: null,
      report: null,
      productKey: "f".repeat(64),
    });

    const response = (await handleBridgeMessage({ type: "verdict:history:list" }, options())) as {
      entries: { productKey: string | null }[];
    };

    expect(response.entries[0]?.productKey).toBe("f".repeat(64));
  });

  it("reports no key for a check saved before keys existed", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: null });

    const response = (await handleBridgeMessage({ type: "verdict:history:list" }, options())) as {
      entries: { productKey: string | null }[];
    };

    expect(response.entries[0]?.productKey).toBeNull();
  });
});

describe("verdict:report:export", () => {
  beforeEach(async () => {
    await deleteAllHistory();
  });

  const stored = {
    serial: "7QK2-M4P9",
    band: "mixed",
    claimedRating: 4.6,
    adjustedRating: 3.9,
    totalReviewCount: 120,
    excludedReviewCount: 30,
    estimatedInorganicShare: 0.25,
    confidence: { low: 0.18, high: 0.33 },
    evidence: [],
    unavailableSignals: [],
    generatedAt: 1_700_000_000_000,
  };

  it("is a recognised request only with a whole id and a known format", () => {
    expect(isBridgeRequest({ type: "verdict:report:export", id: 1, format: "text" })).toBe(true);
    expect(isBridgeRequest({ type: "verdict:report:export", id: 1, format: "csv" })).toBe(false);
    expect(isBridgeRequest({ type: "verdict:report:export", id: 1.5, format: "text" })).toBe(false);
    expect(isBridgeRequest({ type: "verdict:report:export", format: "text" })).toBe(false);
  });

  it("returns the report as text, named after its serial", async () => {
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: stored });
    const [entry] = await listHistory();
    const response = await handleBridgeMessage(
      { type: "verdict:report:export", id: entry?.id, format: "text" },
      options(),
    );
    expect(response).toMatchObject({ filename: "verdict-report-7qk2-m4p9.txt" });
    expect((response as { content: string }).content).toContain("VERDICT REPORT");
  });

  it("returns the report as json", async () => {
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: stored });
    const [entry] = await listHistory();
    const response = await handleBridgeMessage(
      { type: "verdict:report:export", id: entry?.id, format: "json" },
      options(),
    );
    const parsed = JSON.parse((response as { content: string }).content);
    expect(parsed.report.serial).toBe("7QK2-M4P9");
    expect(parsed.title).toBe("a product");
  });

  it("returns nothing for an id that is not there, never another entry", async () => {
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: stored });
    const response = await handleBridgeMessage(
      { type: "verdict:report:export", id: 999_999, format: "text" },
      options(),
    );
    expect(response).toEqual({ filename: "", content: "" });
  });

  it("returns nothing for an entry whose report cannot be read", async () => {
    await addHistoryEntry({ title: "a product", thumbnailUrl: null, report: { nope: true } });
    const [entry] = await listHistory();
    const response = await handleBridgeMessage(
      { type: "verdict:report:export", id: entry?.id, format: "text" },
      options(),
    );
    expect(response).toEqual({ filename: "", content: "" });
  });

  it("is rate limited like the other exports", () => {
    expect(RATE_LIMITS["verdict:report:export"].limit).toBe(12);
  });
});
