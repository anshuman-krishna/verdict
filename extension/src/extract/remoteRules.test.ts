import { describe, expect, it } from "vitest";
import { isSafeSiteId, remoteRulesCacheKey, remoteRulesUrl } from "./remoteRules";

describe("remoteRulesUrl", () => {
  it("names one file per site under the rules directory", () => {
    expect(remoteRulesUrl("amazon")).toBe("https://verdict.tools/rules/amazon.json");
    expect(remoteRulesUrl("google-maps")).toBe("https://verdict.tools/rules/google-maps.json");
  });

  it("refuses an id that would climb out of the rules directory", () => {
    expect(() => remoteRulesUrl("../../secrets")).toThrow();
    expect(() => remoteRulesUrl("a/b")).toThrow();
  });

  it("refuses an id that would change the host", () => {
    expect(() => remoteRulesUrl("//evil.example.com/x")).toThrow();
    expect(() => remoteRulesUrl("amazon?x=1")).toThrow();
  });

  it("refuses an id that is empty or shouting", () => {
    expect(() => remoteRulesUrl("")).toThrow();
    expect(() => remoteRulesUrl("Amazon")).toThrow();
  });
});

describe("remoteRulesCacheKey", () => {
  it("keeps one cache entry per site, so one site cannot overwrite another", () => {
    expect(remoteRulesCacheKey("amazon")).not.toBe(remoteRulesCacheKey("ebay"));
  });

  it("refuses the same ids the url does", () => {
    expect(() => remoteRulesCacheKey("../x")).toThrow();
  });
});

describe("isSafeSiteId", () => {
  it("accepts the shape the registry uses", () => {
    expect(isSafeSiteId("amazon")).toBe(true);
    expect(isSafeSiteId("google-maps")).toBe(true);
  });

  it("rejects anything with a separator, a dot, or a capital in it", () => {
    for (const bad of ["a/b", "a.b", "A", "a b", "", "a:b"]) {
      expect(isSafeSiteId(bad), bad).toBe(false);
    }
  });
});
