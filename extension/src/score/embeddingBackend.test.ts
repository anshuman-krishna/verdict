import { describe, expect, it } from "vitest";
import {
  backendFromArtifact,
  bundledEmbeddingBackend,
  fromLexicon,
  hashedTerms,
  HASHED_TERMS_IDENTITY,
  LEXICON_ARTIFACT_VERSION,
} from "./embeddingBackend";
import { parseLexicon, type Lexicon } from "./lexicon";
import { cosineSimilarity, EMBEDDING_DIMENSIONS, embedText } from "./textEmbedding";

// kettle, stove and filter on three axes, quantised at 1/127, written by `just lexicon`
const TABLE = "VkxFWAEABAADAAAABAIBPBMAAABrZXR0bGUKc3RvdmUKZmlsdGVyfwAAAAB/AAAAAH8A";

function lexicon(): Lexicon {
  const bytes = Uint8Array.from(atob(TABLE), (character) => character.charCodeAt(0));
  return parseLexicon(bytes) as Lexicon;
}

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifactVersion: LEXICON_ARTIFACT_VERSION,
    present: true,
    identity: "kettles-3d",
    bytes: TABLE,
    ...overrides,
  };
}

describe("hashedTerms", () => {
  it("is the embedding the scorer has always used", () => {
    expect(hashedTerms().embed("a good kettle")).toEqual(embedText("a good kettle"));
  });

  it("names itself with the width it hashes into", () => {
    expect(hashedTerms().identity).toBe(`${HASHED_TERMS_IDENTITY}/${EMBEDDING_DIMENSIONS}`);
    expect(hashedTerms(64).dimensions).toBe(64);
  });
});

describe("fromLexicon", () => {
  it("averages the rows of the words it knows", () => {
    const embedded = fromLexicon(lexicon(), "kettles-3d").embed("kettle stove") as number[];

    expect(embedded[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(embedded[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(embedded[2]).toBe(0);
  });

  it("weighs a word twice when the text says it twice", () => {
    const embedded = fromLexicon(lexicon(), "kettles-3d").embed("kettle kettle stove") as number[];

    expect(embedded[0]).toBeCloseTo(2 / Math.sqrt(5), 12);
    expect(embedded[1]).toBeCloseTo(1 / Math.sqrt(5), 12);
  });

  it("ignores words it does not hold rather than moving the vector", () => {
    const backend = fromLexicon(lexicon(), "kettles-3d");

    expect(backend.embed("sprocket kettle flange")).toEqual(backend.embed("kettle"));
  });

  it("has nothing to say about text with no word it holds", () => {
    expect(fromLexicon(lexicon(), "kettles-3d").embed("sprocket flange")).toBeNull();
  });

  it("puts unrelated words further apart than repeated ones", () => {
    const backend = fromLexicon(lexicon(), "kettles-3d");
    const kettle = backend.embed("kettle") as number[];
    const stove = backend.embed("stove") as number[];
    const again = backend.embed("a kettle, and a kettle") as number[];

    expect(cosineSimilarity(kettle, stove)).toBeCloseTo(0, 6);
    expect(cosineSimilarity(kettle, again)).toBeCloseTo(1, 6);
  });

  it("takes its width from the table", () => {
    expect(fromLexicon(lexicon(), "kettles-3d").dimensions).toBe(4);
  });
});

describe("backendFromArtifact", () => {
  it("reads the table a build bundles", () => {
    const backend = backendFromArtifact(artifact());

    expect(backend.identity).toBe("kettles-3d");
    expect(backend.dimensions).toBe(4);
  });

  it("falls back to hashed terms when no table is bundled", () => {
    expect(backendFromArtifact({ artifactVersion: 1, present: false }).identity).toBe(
      hashedTerms().identity,
    );
  });

  it("falls back rather than shipping a table it cannot parse", () => {
    for (const broken of [
      artifact({ bytes: "bm90IGEgdGFibGU=" }),
      artifact({ bytes: "not base64 at all !!" }),
      artifact({ identity: "" }),
      artifact({ artifactVersion: 99 }),
      "a lexicon",
      null,
    ]) {
      expect(backendFromArtifact(broken).identity).toBe(hashedTerms().identity);
    }
  });

  it("takes the fallback it is handed", () => {
    expect(backendFromArtifact(null, hashedTerms(64)).dimensions).toBe(64);
  });
});

describe("the bundled backend", () => {
  it("is what buildFeatureVector embeds with, and is the same object each time", () => {
    expect(bundledEmbeddingBackend()).toBe(bundledEmbeddingBackend());
  });

  it("scores text on any build, table or no table", () => {
    expect(bundledEmbeddingBackend().embed("a good kettle")).not.toBeNull();
  });
});
