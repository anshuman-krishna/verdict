import { describe, expect, it } from "vitest";
import {
  extensionPageProblems,
  reopenProblems,
  siteProblems,
  storefrontPage,
  storefrontProblems,
} from "./browserSmoke.mjs";

describe("the synthetic storefront page", () => {
  it("carries a product with dated reviews in json-ld", () => {
    const html = storefrontPage(3);
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(json["@type"]).toBe("Product");
    expect(json.review).toHaveLength(3);
    expect(json.review[2].datePublished).toBe("2026-01-07");
  });
});

describe("what the storefront has to show", () => {
  it("passes one panel and no errors", () => {
    expect(storefrontProblems({ errors: [], mounted: ["verdict-panel"] })).toEqual([]);
  });

  it("names an error the content script threw, which is how a missing registry looked", () => {
    expect(
      storefrontProblems({ errors: ["Cannot read properties of null (reading 'get')"], mounted: [] }),
    ).toEqual([
      "the storefront content script threw: Cannot read properties of null (reading 'get')",
      "a product page should carry exactly one panel or notice, it carried 0",
    ]);
  });

  it("refuses two notices stacked on each other", () => {
    expect(storefrontProblems({ errors: [], mounted: ["verdict-notice", "verdict-notice"] })).toEqual([
      "a product page should carry exactly one panel or notice, it carried 2 (verdict-notice, verdict-notice)",
    ]);
  });
});

describe("what the website has to get", () => {
  it("passes when the relay is announced", () => {
    expect(siteProblems({ errors: [], relay: "true" })).toEqual([]);
  });

  it("names a missing relay", () => {
    expect(siteProblems({ errors: [], relay: null })).toEqual([
      "verdict.tools never got the relay, so the website cannot reach the extension",
    ]);
  });
});

describe("what the popup and options pages need", () => {
  it("passes a page with a language, one main and one heading", () => {
    expect(
      extensionPageProblems("popup.html", { errors: [], lang: "en", mainCount: 1, headingCount: 1 }),
    ).toEqual([]);
  });

  it("names every gap at once", () => {
    expect(
      extensionPageProblems("options.html", { errors: ["boom"], lang: "", mainCount: 0, headingCount: 2 }),
    ).toEqual([
      "options.html threw: boom",
      "options.html declares no language",
      "options.html has 0 main landmarks, it needs one",
      "options.html has 2 top level headings, it needs one",
    ]);
  });
});

describe("bringing a closed panel back in a real tab", () => {
  it("passes a hidden reading that comes back once", () => {
    expect(reopenProblems({ status: { hidden: true }, reopened: { reopened: true }, mountedAfter: 1 })).toEqual([]);
  });

  it("names each step that did not happen", () => {
    expect(reopenProblems({ status: null, reopened: { reopened: false }, mountedAfter: 0 })).toEqual([
      "after the reader closed it, the tab did not say a reading was hidden",
      "the tab did not bring the closed panel back when asked",
      "bringing the panel back left 0 panels or notices, it should leave one",
    ]);
  });
});
