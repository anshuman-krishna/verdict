import { describe, expect, it } from "vitest";
import {
  SITES,
  absentSignalsFor,
  allowedDomains,
  canFetchReviewPages,
  contentScriptMatches,
  isDraftSite,
  localeForHost,
  parseProductUrl,
  reviewPageCap,
  reviewPageUrl,
  reviewSourceOf,
  siteForHost,
  siteIdsMatchedBy,
  subjectOf,
  supportedContentScriptMatches,
  withoutDraftPlatforms,
  type SiteDefinition,
} from "./sites";

describe("parseProductUrl", () => {
  it("parses a /dp/ url on each of the four supported locales", () => {
    expect(parseProductUrl("https://www.amazon.com/Some-Title/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "com",
      productId: "B0BXYZ1234",
    });
    expect(parseProductUrl("https://www.amazon.fr/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "fr",
      productId: "B0BXYZ1234",
    });
    expect(parseProductUrl("https://www.amazon.de/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "de",
      productId: "B0BXYZ1234",
    });
    expect(parseProductUrl("https://www.amazon.co.uk/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "co.uk",
      productId: "B0BXYZ1234",
    });
  });

  it("parses the /gp/product/ url shape and query strings after the id", () => {
    const result = parseProductUrl(
      "https://www.amazon.com/gp/product/B0BXYZ1234?th=1&psc=1",
    );
    expect(result).toEqual({ site: "amazon", locale: "com", productId: "B0BXYZ1234" });
  });

  it("upper cases a lower case asin in the path", () => {
    expect(parseProductUrl("https://www.amazon.com/dp/b0bxyz1234")).toEqual({
      site: "amazon",
      locale: "com",
      productId: "B0BXYZ1234",
    });
  });

  it("returns null for an unsupported host", () => {
    expect(parseProductUrl("https://www.example.com/dp/B0BXYZ1234")).toBeNull();
  });

  it("returns null for a non product page on a supported host", () => {
    expect(parseProductUrl("https://www.amazon.com/s?k=widgets")).toBeNull();
    expect(parseProductUrl("https://www.amazon.com/gp/cart/view.html")).toBeNull();
  });

  it("returns null for a malformed url instead of throwing", () => {
    expect(parseProductUrl("not a url")).toBeNull();
  });
});

describe("reviewPageUrl", () => {
  it("builds a product-reviews url for the page's own host and locale", () => {
    const page = { site: "amazon" as const, locale: "co.uk", productId: "B0BXYZ1234" };
    expect(reviewPageUrl(page, 2)).toBe(
      "https://www.amazon.co.uk/product-reviews/B0BXYZ1234/?pageNumber=2",
    );
  });
});

const SECOND: SiteDefinition[] = [
  ...SITES,
  {
    id: "shopfront",
    locales: {
      us: { host: "shop.example.com", domain: "example.com" },
      ie: { host: "shop.example.ie", domain: "example.ie" },
    },
    productPath: "/item/(\\d{6})(?:[/?]|$)",
    productId: "^\\d{6}$",
    reviewPath: "/item/{productId}/reviews?p={pageNumber}",
  },
];

describe("a storefront the registry gained without a code change", () => {
  it("parses its product urls", () => {
    expect(parseProductUrl("https://shop.example.com/item/123456", SECOND)).toEqual({
      site: "shopfront",
      locale: "us",
      productId: "123456",
    });
  });

  it("builds its review page urls from its own template", () => {
    const page = { site: "shopfront", locale: "ie", productId: "123456" };

    expect(reviewPageUrl(page, 3, SECOND)).toBe(
      "https://shop.example.ie/item/123456/reviews?p=3",
    );
  });

  it("adds its hosts to the content script matches", () => {
    expect(contentScriptMatches(SECOND)).toContain("https://shop.example.com/*");
    expect(contentScriptMatches(SECOND)).toContain("https://www.amazon.com/*");
  });

  it("adds its domains to the bridge allowlist", () => {
    expect(allowedDomains("shopfront", ["us", "ie"], SECOND)).toEqual([
      "example.com",
      "example.ie",
    ]);
  });

  it("leaves amazon parsing untouched", () => {
    expect(parseProductUrl("https://www.amazon.com/dp/B0BXYZ1234", SECOND)?.site).toBe("amazon");
  });

  it("does not answer for a host no site declares", () => {
    expect(parseProductUrl("https://shop.example.fr/item/123456", SECOND)).toBeNull();
  });
});

describe("reviewPageCap", () => {
  it("reads the storefront's own paging ceiling from the registry", () => {
    expect(reviewPageCap("amazon")).toBe(10);
  });

  it("stays shallow for a storefront that never declared one", () => {
    expect(reviewPageCap("shopfront", SECOND)).toBe(5);
  });

  it("is shallow for a site the registry does not carry at all", () => {
    expect(reviewPageCap("nowhere")).toBe(5);
  });
});

describe("localeForHost", () => {
  it("names which locale of a storefront a host is", () => {
    expect(localeForHost("www.amazon.de")).toBe("de");
    expect(localeForHost("www.amazon.co.jp")).toBe("co.jp");
    expect(localeForHost("www.amazon.com")).toBe("com");
  });

  it("is null for a host the registry does not carry", () => {
    expect(localeForHost("www.example.com")).toBeNull();
  });
});

describe("siteForHost", () => {
  it("names the storefront a page belongs to before anything is parsed", () => {
    expect(siteForHost("www.amazon.co.uk")?.id).toBe("amazon");
  });

  it("works for a host with no product on it", () => {
    expect(siteForHost("www.amazon.de")?.id).toBe("amazon");
  });

  it("is null for a host the registry does not carry", () => {
    expect(siteForHost("www.example.com")).toBeNull();
  });

  it("does not match a lookalike host", () => {
    expect(siteForHost("www.amazon.com.evil.example")).toBeNull();
    expect(siteForHost("amazon.com")).toBeNull();
  });

  it("agrees with the content script matches, so every matched page has a site", () => {
    for (const match of contentScriptMatches()) {
      const hostname = new URL(match.replace("/*", "/")).hostname;
      expect(siteForHost(hostname), hostname).not.toBeNull();
    }
  });
});

// the registry carries platforms that are not storefronts, so these are the properties the
// rest of the extension reads off one rather than assuming
const PLATFORMS: SiteDefinition[] = [
  ...SITES,
  {
    id: "atlas",
    subject: "place",
    status: "draft",
    pathPrefix: "/places",
    locales: { us: { host: "maps.example.com", domain: "example.com" } },
    productPath: "/places/venue/(0x[0-9a-f]+)(?:[/?]|$)",
    productId: "^0x[0-9a-f]+$",
    idCase: "preserve",
    reviewSource: "page-only",
    absentSignals: ["verificationConcentration"],
  },
];

describe("a platform that is not a storefront", () => {
  it("keeps an id whose case carries meaning", () => {
    expect(parseProductUrl("https://maps.example.com/places/venue/0xab12cd", PLATFORMS)).toEqual({
      site: "atlas",
      locale: "us",
      productId: "0xab12cd",
    });
  });

  it("still upper cases an id for a platform that did not ask to keep it", () => {
    expect(parseProductUrl("https://www.amazon.com/dp/b0bxyz1234", PLATFORMS)?.productId)
      .toBe("B0BXYZ1234");
  });

  it("names what it reviews, and a storefront reviews products", () => {
    expect(subjectOf("atlas", PLATFORMS)).toBe("place");
    expect(subjectOf("amazon", PLATFORMS)).toBe("product");
    expect(subjectOf("nowhere", PLATFORMS)).toBe("product");
  });

  it("names the signals it structurally does not record", () => {
    expect(absentSignalsFor("atlas", PLATFORMS)).toEqual(["verificationConcentration"]);
    expect(absentSignalsFor("amazon", PLATFORMS)).toEqual([]);
  });

  it("says no deeper read is available when it has no review page url", () => {
    expect(reviewSourceOf("atlas", PLATFORMS)).toBe("page-only");
    expect(canFetchReviewPages("atlas", PLATFORMS)).toBe(false);
    expect(canFetchReviewPages("amazon", PLATFORMS)).toBe(true);
  });

  it("refuses to invent a review page url it was never given", () => {
    const page = { site: "atlas", locale: "us", productId: "0xab12cd" };
    expect(() => reviewPageUrl(page, 2, PLATFORMS)).toThrow(/no review page url/);
  });

  it("is matched under its own path, so the rest of the host is not read", () => {
    expect(contentScriptMatches(PLATFORMS)).toContain("https://maps.example.com/places/*");
    expect(contentScriptMatches(PLATFORMS)).not.toContain("https://maps.example.com/*");
  });

  it("does not claim a page on its host outside its own path", () => {
    expect(parseProductUrl("https://maps.example.com/search?q=widgets", PLATFORMS)).toBeNull();
  });
});

describe("a draft platform", () => {
  it("is matched in a development build and not in a production one", () => {
    expect(isDraftSite("atlas", PLATFORMS)).toBe(true);
    expect(contentScriptMatches(PLATFORMS)).toContain("https://maps.example.com/places/*");
    expect(supportedContentScriptMatches(PLATFORMS))
      .not.toContain("https://maps.example.com/places/*");
  });

  it("is the registry's own state, not a guess", () => {
    expect(isDraftSite("amazon")).toBe(false);
    expect(isDraftSite("google-maps")).toBe(true);
  });

  it("is stripped from a production manifest", () => {
    const manifest = {
      content_scripts: [
        { matches: [...contentScriptMatches()] },
        { matches: ["https://verdict.tools/*"] },
      ],
    };
    withoutDraftPlatforms(manifest);
    expect(manifest.content_scripts[0]?.matches).toEqual([...supportedContentScriptMatches()]);
    expect(manifest.content_scripts[1]?.matches).toEqual(["https://verdict.tools/*"]);
  });

  it("drops a content script left with nothing to match", () => {
    const draftOnly = SITES.filter((site) => site.status === "draft");
    const manifest = { content_scripts: [{ matches: draftOnly.flatMap((site) =>
      Object.values(site.locales).map((entry) => `https://${entry.host}${site.pathPrefix ?? ""}/*`)
    ) }] };
    withoutDraftPlatforms(manifest);
    expect(manifest.content_scripts).toEqual([]);
  });
});

// the bridge answers for what the content script runs on, so a stripped platform is
// unreachable from the website as well as from a tab
describe("siteIdsMatchedBy", () => {
  it("names the platforms a manifest actually runs on", () => {
    expect(siteIdsMatchedBy(supportedContentScriptMatches())).toEqual(["amazon"]);
    expect(siteIdsMatchedBy(contentScriptMatches())).toEqual(["amazon", "google-maps"]);
  });

  it("names nothing for a manifest that matches no platform", () => {
    expect(siteIdsMatchedBy(["https://verdict.tools/*"])).toEqual([]);
  });
});
