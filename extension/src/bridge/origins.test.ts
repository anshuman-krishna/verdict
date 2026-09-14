import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_SITE_MATCH,
  isTrustedSiteOrigin,
  PRODUCTION_SITE_MATCH,
  senderOrigin,
  withoutDevelopmentOrigins,
} from "./origins";

describe("isTrustedSiteOrigin", () => {
  it("trusts the production site in every build", () => {
    expect(isTrustedSiteOrigin("https://verdict.tools", false)).toBe(true);
    expect(isTrustedSiteOrigin("https://verdict.tools", true)).toBe(true);
  });

  it("trusts localhost on any port only in a development build", () => {
    expect(isTrustedSiteOrigin("http://localhost:4321", true)).toBe(true);
    expect(isTrustedSiteOrigin("http://localhost", true)).toBe(true);
    expect(isTrustedSiteOrigin("http://localhost:4321", false)).toBe(false);
    expect(isTrustedSiteOrigin("http://localhost", false)).toBe(false);
  });

  it("refuses another extension, which is how firefox reaches onMessageExternal", () => {
    expect(isTrustedSiteOrigin("moz-extension://1b2c3d", true)).toBe(false);
    expect(isTrustedSiteOrigin("chrome-extension://abcdefgh", true)).toBe(false);
  });

  it("refuses lookalikes, other schemes, and nothing at all", () => {
    for (const origin of [
      "http://verdict.tools",
      "https://verdict.tools.example",
      "https://evil.verdict.tools",
      "https://verdict.tools:8443",
      "https://localhost:4321",
      "http://localhost.example",
      "http://127.0.0.1:4321",
      "null",
      "",
      undefined,
    ]) {
      expect(isTrustedSiteOrigin(origin, true)).toBe(false);
    }
  });

  it("refuses a string that only parses to localhost", () => {
    expect(isTrustedSiteOrigin("http://localhost:4321/history", true)).toBe(false);
    expect(isTrustedSiteOrigin("http://user@localhost:4321", true)).toBe(false);
  });
});

describe("senderOrigin", () => {
  it("prefers the origin the browser reports", () => {
    expect(senderOrigin({ origin: "https://verdict.tools", url: "https://other.example/x" })).toBe(
      "https://verdict.tools",
    );
  });

  it("falls back to the sender url, and gives up on nothing usable", () => {
    expect(senderOrigin({ url: "https://verdict.tools/history?x=1" })).toBe("https://verdict.tools");
    expect(senderOrigin({ origin: "", url: "not a url" })).toBeUndefined();
    expect(senderOrigin({})).toBeUndefined();
  });
});

describe("withoutDevelopmentOrigins", () => {
  it("drops localhost from externally_connectable and every content script", () => {
    const manifest = withoutDevelopmentOrigins({
      externally_connectable: { matches: [PRODUCTION_SITE_MATCH, DEVELOPMENT_SITE_MATCH] },
      content_scripts: [
        { matches: [PRODUCTION_SITE_MATCH, DEVELOPMENT_SITE_MATCH] },
        { matches: ["https://www.amazon.com/*"] },
      ],
    });

    expect(manifest.externally_connectable?.matches).toEqual([PRODUCTION_SITE_MATCH]);
    expect(manifest.content_scripts?.map((script) => script.matches)).toEqual([
      [PRODUCTION_SITE_MATCH],
      ["https://www.amazon.com/*"],
    ]);
  });

  it("removes a content script left matching nothing, which would match everything", () => {
    const manifest = withoutDevelopmentOrigins({
      content_scripts: [{ matches: [DEVELOPMENT_SITE_MATCH] }, { matches: ["https://www.amazon.com/*"] }],
    });
    expect(manifest.content_scripts).toEqual([{ matches: ["https://www.amazon.com/*"] }]);
  });

  it("leaves a manifest without either key alone", () => {
    expect(withoutDevelopmentOrigins({})).toEqual({});
  });
});
