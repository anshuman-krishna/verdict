import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  embedText,
  terms,
  tokenize,
} from "./textEmbedding";

describe("tokenize", () => {
  it("splits on everything that is not a letter or a number", () => {
    expect(tokenize("Great phone-case, 10/10!")).toEqual(["great", "phone", "case", "10", "10"]);
  });

  it("keeps accented and non latin words whole", () => {
    expect(tokenize("Trés bien, qualité 品質")).toEqual(["trés", "bien", "qualité", "品質"]);
  });

  it("returns nothing for text with no alphanumerics", () => {
    expect(tokenize("!!! ... ???")).toEqual([]);
  });
});

describe("terms", () => {
  it("adds adjacent bigrams after the unigrams", () => {
    expect(terms(["phone", "case", "black"])).toEqual([
      "phone",
      "case",
      "black",
      "phone case",
      "case black",
    ]);
  });

  it("adds no bigram to a single token", () => {
    expect(terms(["phone"])).toEqual(["phone"]);
  });
});

describe("embedText", () => {
  it("returns a unit vector of the requested width", () => {
    const vector = embedText("a solid usb cable", EMBEDDING_DIMENSIONS);
    expect(vector).not.toBeNull();
    expect((vector as number[]).length).toBe(EMBEDDING_DIMENSIONS);
    expect(cosineSimilarity(vector as number[], vector as number[])).toBeCloseTo(1, 12);
  });

  it("is null when there is nothing to embed", () => {
    expect(embedText("   ")).toBeNull();
  });

  it("ignores punctuation and case", () => {
    expect(embedText("Fast charging cable!")).toEqual(embedText("fast, charging cable"));
  });

  it("scores related text above unrelated text", () => {
    const product = embedText("stainless steel kitchen knife set") as number[];
    const onTopic = embedText("the kitchen knife set is sharp stainless steel") as number[];
    const offTopic = embedText("battery lasted two days on my phone") as number[];
    expect(cosineSimilarity(onTopic, product)).toBeGreaterThan(
      cosineSimilarity(offTopic, product),
    );
  });

  it("separates word order, which a bag of single words could not", () => {
    const a = embedText("case phone") as number[];
    const b = embedText("phone case") as number[];
    expect(cosineSimilarity(a, b)).toBeLessThan(1);
  });
});
