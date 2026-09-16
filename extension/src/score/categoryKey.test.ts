import { describe, expect, it } from "vitest";
import { categoryKeys, categorySlug } from "./categoryKey";

describe("reducing one category segment to a key", () => {
  it("folds case, punctuation and spacing into one shape", () => {
    expect(categorySlug("Home & Kitchen")).toBe("home-kitchen");
    expect(categorySlug("  Coffee, Tea  &  Espresso ")).toBe("coffee-tea-espresso");
    expect(categorySlug("Cell Phones & Accessories")).toBe("cell-phones-accessories");
  });

  it("keeps the letters a script is actually written in", () => {
    expect(categorySlug("Bücher")).toBe("bücher");
    expect(categorySlug("ホーム＆キッチン")).toBe("ホーム-キッチン");
    expect(categorySlug("Éclairage")).toBe("éclairage");
  });

  it("returns nothing for a segment with no letters or digits", () => {
    expect(categorySlug("  ...  ")).toBe("");
  });
});

describe("reading a breadcrumb trail as lookup keys", () => {
  it("returns the narrowest segment first", () => {
    expect(categoryKeys("Home & Kitchen > Coffee > Espresso Machines")).toEqual([
      "espresso-machines",
      "coffee",
      "home-kitchen",
    ]);
  });

  it("reads the separators storefronts actually use", () => {
    expect(categoryKeys("Electronics › Audio")).toEqual(["audio", "electronics"]);
    expect(categoryKeys("Electronics » Audio")).toEqual(["audio", "electronics"]);
    expect(categoryKeys("Electronics / Audio")).toEqual(["audio", "electronics"]);
    expect(categoryKeys("Electronics\nAudio")).toEqual(["audio", "electronics"]);
  });

  it("drops empty segments and repeats rather than looking either up twice", () => {
    expect(categoryKeys("Books >  > Books > Fiction")).toEqual(["fiction", "books"]);
  });

  it("has no keys for a listing that names no category", () => {
    expect(categoryKeys(null)).toEqual([]);
    expect(categoryKeys("")).toEqual([]);
  });
});
