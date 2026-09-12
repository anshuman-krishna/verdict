import { describe, expect, it } from "vitest";
import {
  SITES,
  allowedDomains,
  contentScriptMatches,
  parseProductUrl,
  reviewPageUrl,
  siteForHost,
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
