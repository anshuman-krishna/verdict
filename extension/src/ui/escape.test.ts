import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escape";

describe("escapeHtml", () => {
  it("escapes the quotes an attribute value can be broken out of", () => {
    expect(escapeHtml(`x" onerror="alert(1)`)).toBe("x&quot; onerror=&quot;alert(1)");
    expect(escapeHtml("x' onerror='alert(1)")).toBe("x&#39; onerror=&#39;alert(1)");
  });

  it("escapes the angle brackets a tag can be opened with", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes the ampersand first, so an escape cannot be double decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("a perfectly normal product name")).toBe(
      "a perfectly normal product name",
    );
  });
});
