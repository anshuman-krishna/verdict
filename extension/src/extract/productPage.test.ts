import { describe, expect, it } from "vitest";
import { parseAmazonProductUrl, reviewPageUrl } from "./productPage";

describe("parseAmazonProductUrl", () => {
  it("parses a /dp/ url on each of the four supported locales", () => {
    expect(parseAmazonProductUrl("https://www.amazon.com/Some-Title/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "com",
      productId: "B0BXYZ1234",
    });
    expect(parseAmazonProductUrl("https://www.amazon.fr/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "fr",
      productId: "B0BXYZ1234",
    });
    expect(parseAmazonProductUrl("https://www.amazon.de/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "de",
      productId: "B0BXYZ1234",
    });
    expect(parseAmazonProductUrl("https://www.amazon.co.uk/dp/B0BXYZ1234")).toEqual({
      site: "amazon",
      locale: "co.uk",
      productId: "B0BXYZ1234",
    });
  });

  it("parses the /gp/product/ url shape and query strings after the id", () => {
    const result = parseAmazonProductUrl(
      "https://www.amazon.com/gp/product/B0BXYZ1234?th=1&psc=1",
    );
    expect(result).toEqual({ site: "amazon", locale: "com", productId: "B0BXYZ1234" });
  });

  it("upper cases a lower case asin in the path", () => {
    expect(parseAmazonProductUrl("https://www.amazon.com/dp/b0bxyz1234")).toEqual({
      site: "amazon",
      locale: "com",
      productId: "B0BXYZ1234",
    });
  });

  it("returns null for an unsupported host", () => {
    expect(parseAmazonProductUrl("https://www.example.com/dp/B0BXYZ1234")).toBeNull();
  });

  it("returns null for a non product page on a supported host", () => {
    expect(parseAmazonProductUrl("https://www.amazon.com/s?k=widgets")).toBeNull();
    expect(parseAmazonProductUrl("https://www.amazon.com/gp/cart/view.html")).toBeNull();
  });

  it("returns null for a malformed url instead of throwing", () => {
    expect(parseAmazonProductUrl("not a url")).toBeNull();
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
