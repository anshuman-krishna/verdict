import { describe, expect, it } from "vitest";
import { pseudoCatalogue, pseudoText } from "./pseudo";
import { MESSAGE_IDS } from "./messages";
import { newTranslator } from "./translator";

describe("pseudoText", () => {
  it("accents the words so an untranslated line is visible at a glance", () => {
    expect(pseudoText("close")).toMatch(/^\[ç|\[/);
    expect(pseudoText("close")).not.toContain("close");
  });

  it("leaves placeholders alone, since they are not words", () => {
    expect(pseudoText("kept {count}")).toContain("{count}");
  });

  it("brackets the line so a clipped one shows its missing end", () => {
    const marked = pseudoText("abc");
    expect(marked.startsWith("[")).toBe(true);
    expect(marked.endsWith("]")).toBe(true);
  });

  it("runs longer than english, which is where layouts break", () => {
    expect(pseudoText("a short line").length).toBeGreaterThan("a short line".length * 1.3);
  });
});

describe("pseudoCatalogue", () => {
  it("covers every line, which is the point of it", () => {
    expect(Object.keys(pseudoCatalogue()).sort()).toEqual([...MESSAGE_IDS].sort());
  });

  it("still counts, so plurals stay testable under it", () => {
    const t = newTranslator("en", pseudoCatalogue(), "qps");
    expect(t.count("count.reviews", 1)).toContain("1");
    expect(t.count("count.reviews", 1)).not.toBe(t.count("count.reviews", 9));
  });
});
