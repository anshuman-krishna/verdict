import { describe, expect, it } from "vitest";
import { ENGLISH, type Catalogue } from "./messages";
import { newTranslator } from "./translator";

describe("newTranslator", () => {
  it("fills placeholders by name", () => {
    const t = newTranslator();
    expect(t.text("panel.summary", { band: "mixed", excluded: 12, total: 400 })).toBe(
      "mixed. 12 of 400 reviews look inorganic.",
    );
  });

  it("groups numbers the way the locale does", () => {
    expect(newTranslator("en-US").number(8124)).toBe("8,124");
    expect(newTranslator("de-DE").number(8124)).toBe("8.124");
    expect(newTranslator("fr-FR").number(8124).replaceAll(" ", " ")).toBe("8 124");
  });

  it("writes a rating with the locale's decimal mark", () => {
    expect(newTranslator("en-US").decimal(4.6, 1)).toBe("4.6");
    expect(newTranslator("de-DE").decimal(4.6, 1)).toBe("4,6");
    expect(newTranslator("pl-PL").decimal(4.6, 1)).toBe("4,6");
  });

  it("keeps the trailing zero a rating needs", () => {
    expect(newTranslator("en-US").decimal(4, 1)).toBe("4.0");
  });

  it("picks the plural form english asks for", () => {
    const t = newTranslator();
    expect(t.count("count.reviews", 1)).toBe("1 review");
    expect(t.count("count.reviews", 0)).toBe("0 reviews");
    expect(t.count("count.reviews", 4200)).toBe("4,200 reviews");
  });

  it("picks the plural form the locale asks for, not english's two", () => {
    // polish wants few for 2 to 4 and many for 5 and up
    const polish: Catalogue = {
      "count.reviews": { one: "jedna", few: "kilka", many: "wiele", other: "recenzji" },
    };
    const t = newTranslator("pl-PL", polish, "pl");
    expect(t.count("count.reviews", 1)).toBe("jedna");
    expect(t.count("count.reviews", 3)).toBe("kilka");
    expect(t.count("count.reviews", 12)).toBe("wiele");
  });

  it("falls back to other when the catalogue has no form for the category", () => {
    const t = newTranslator("pl-PL", { "count.reviews": { other: "recenzji" } }, "pl");
    expect(t.count("count.reviews", 3)).toBe("recenzji");
  });

  it("falls back line by line rather than whole catalogue at a time", () => {
    const partial: Catalogue = { "panel.claimed": "annonce" };
    const t = newTranslator("fr-FR", partial, "fr");
    expect(t.text("panel.claimed")).toBe("annonce");
    expect(t.text("panel.adjusted")).toBe(ENGLISH["panel.adjusted"]);
  });

  it("leaves a placeholder nobody supplied alone rather than printing undefined", () => {
    expect(newTranslator().text("previously.unknown")).toBe("You checked this listing {when}.");
  });

  it("joins a list with the catalogue's own conjunction", () => {
    const t = newTranslator();
    expect(t.join([])).toBe("");
    expect(t.join(["one"])).toBe("one");
    expect(t.join(["one", "two"])).toBe("one and two");
    expect(t.join(["one", "two", "three"])).toBe("one, two and three");
  });

  it("falls back to english formatting when the tag is nonsense", () => {
    const t = newTranslator("not a locale at all");
    expect(t.tag).toBe("en");
    expect(t.number(8124)).toBe("8,124");
  });

  it("dates a check in the reader's own order", () => {
    const noon = Date.UTC(2026, 2, 14, 12);
    expect(newTranslator("en-US").date(noon)).toContain("Mar");
    expect(newTranslator("en-GB").date(noon)).toContain("14");
  });
});

describe("plural forms follow the line, not the reader", () => {
  it("keeps english's singular for a reader whose language has no plural", () => {
    // japanese has one category, which would otherwise pick english's plural form
    const t = newTranslator("ja-JP", {}, "en");
    expect(t.count("when.months", 1)).toBe("a month ago");
    expect(t.count("count.reviews", 1)).toBe("1 review");
  });

  it("uses the catalogue's language for a line the catalogue answered", () => {
    const t = newTranslator("en-US", { "count.pages": { other: "{count} ページ" } }, "ja");
    expect(t.count("count.pages", 1)).toBe("1 ページ");
  });

  it("uses english's rules for a line that fell back to english", () => {
    const t = newTranslator("en-US", {}, "ja");
    expect(t.count("count.pages", 1)).toBe("1 page");
  });
});
