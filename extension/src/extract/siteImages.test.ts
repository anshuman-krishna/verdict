import { describe, expect, it } from "vitest";
import { imageHosts, isStorefrontImageUrl, safeThumbnailUrl, type SiteDefinition } from "./sites";

const site: SiteDefinition = {
  id: "example",
  locales: { com: { host: "www.example.com", domain: "example.com" } },
  productPath: "/dp/([A-Z0-9]{10})",
  productId: "^[A-Z0-9]{10}$",
  reviewPath: "/reviews/{productId}/{pageNumber}",
  imageHosts: ["images.example-cdn.com"],
};

describe("isStorefrontImageUrl", () => {
  it("accepts the storefront host itself", () => {
    expect(isStorefrontImageUrl("https://www.example.com/i/a.jpg", [site])).toBe(true);
  });

  it("accepts a declared cdn host and its subdomains", () => {
    expect(isStorefrontImageUrl("https://images.example-cdn.com/a.jpg", [site])).toBe(true);
    expect(isStorefrontImageUrl("https://eu.images.example-cdn.com/a.jpg", [site])).toBe(true);
  });

  it("rejects a host nobody declared, which is how a thumbnail becomes a beacon", () => {
    expect(isStorefrontImageUrl("https://tracker.example.net/pixel.gif", [site])).toBe(false);
  });

  it("rejects a lookalike host that merely ends with the same letters", () => {
    expect(isStorefrontImageUrl("https://evilwww.example.com.attacker.net/a.jpg", [site])).toBe(
      false,
    );
    expect(isStorefrontImageUrl("https://notwww.example.com/a.jpg", [site])).toBe(false);
  });

  it("rejects every scheme but https", () => {
    for (const url of [
      "http://www.example.com/a.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "file:///etc/passwd",
    ]) {
      expect(isStorefrontImageUrl(url, [site])).toBe(false);
    }
  });

  it("rejects a string that is not a url", () => {
    expect(isStorefrontImageUrl("not a url", [site])).toBe(false);
    expect(isStorefrontImageUrl("", [site])).toBe(false);
  });
});

describe("safeThumbnailUrl", () => {
  it("passes an allowed url through unchanged", () => {
    expect(safeThumbnailUrl("https://www.example.com/a.jpg", [site])).toBe(
      "https://www.example.com/a.jpg",
    );
  });

  it("turns anything else into null rather than a broken image", () => {
    expect(safeThumbnailUrl("https://tracker.example.net/p.gif", [site])).toBeNull();
    expect(safeThumbnailUrl(null, [site])).toBeNull();
  });
});

describe("imageHosts", () => {
  it("covers the storefront hosts even when a site declares no cdn", () => {
    const bare = { ...site, imageHosts: undefined };
    expect(imageHosts([bare])).toEqual(["www.example.com"]);
  });
});
