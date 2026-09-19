import { describe, expect, it } from "vitest";
import {
  LEXICON_HEADER_BYTES,
  LEXICON_VERSION,
  lexiconBytes,
  parseLexicon,
} from "./lexicon";

const SCALE = 1 / 127;

function table(
  tokens: readonly string[],
  rows: readonly (readonly number[])[],
  overrides: { version?: number; dimensions?: number; tokenCount?: number; scale?: number } = {},
): Uint8Array {
  const names = new TextEncoder().encode(tokens.join("\n"));
  const dimensions = overrides.dimensions ?? (rows[0]?.length ?? 0);
  const flat = rows.flat();
  const bytes = new Uint8Array(LEXICON_HEADER_BYTES + names.length + flat.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("VLEX"), 0);
  view.setUint16(4, overrides.version ?? LEXICON_VERSION, true);
  view.setUint16(6, dimensions, true);
  view.setUint32(8, overrides.tokenCount ?? tokens.length, true);
  view.setFloat32(12, overrides.scale ?? SCALE, true);
  view.setUint32(16, names.length, true);
  bytes.set(names, LEXICON_HEADER_BYTES);
  new Int8Array(bytes.buffer, LEXICON_HEADER_BYTES + names.length, flat.length).set(flat);
  return bytes;
}

const KETTLE = table(
  ["kettle", "stove"],
  [
    [127, 0, 0, 0],
    [0, -127, 0, 0],
  ],
);

describe("parseLexicon", () => {
  it("reads the header the builder writes", () => {
    const lexicon = parseLexicon(KETTLE);

    expect(lexicon?.version).toBe(LEXICON_VERSION);
    expect(lexicon?.dimensions).toBe(4);
    expect(lexicon?.tokenCount).toBe(2);
  });

  it("returns a row at full scale for a token it holds", () => {
    const row = parseLexicon(KETTLE)?.row("kettle") as number[];

    expect(row).toHaveLength(4);
    expect(row[0]).toBeCloseTo(1, 6);
    expect(row.slice(1)).toEqual([0, 0, 0]);
  });

  it("keeps the sign of a negative value", () => {
    expect((parseLexicon(KETTLE)?.row("stove") as number[])[1]).toBeCloseTo(-1, 6);
  });

  it("has nothing for a token it does not hold", () => {
    expect(parseLexicon(KETTLE)?.row("sprocket")).toBeNull();
  });

  it("refuses anything that does not start with the magic", () => {
    const wrong = Uint8Array.from(KETTLE);
    wrong[0] = 0x58;

    expect(parseLexicon(wrong)).toBeNull();
  });

  it("refuses a version this build does not know how to read", () => {
    expect(parseLexicon(table(["kettle"], [[127, 0]], { version: 99 }))).toBeNull();
  });

  it("refuses a table whose length does not match what it declares", () => {
    expect(parseLexicon(KETTLE.subarray(0, KETTLE.length - 1))).toBeNull();
  });

  it("refuses a table that names more tokens than it stores", () => {
    expect(parseLexicon(table(["kettle", "stove"], [[127, 0, 0, 0], [0, -127, 0, 0]], {
      tokenCount: 3,
    }))).toBeNull();
  });

  it("refuses a table that names the same token twice", () => {
    expect(parseLexicon(table(["kettle", "kettle"], [[127, 0], [0, 127]]))).toBeNull();
  });

  it("refuses bytes too short to hold a header", () => {
    expect(parseLexicon(new Uint8Array(4))).toBeNull();
  });
});

describe("lexiconBytes", () => {
  it("decodes what the builder base64 encodes", () => {
    const encoded = btoa(String.fromCharCode(...KETTLE));

    expect(lexiconBytes(encoded)).toEqual(KETTLE);
  });

  it("returns nothing for text that is not base64", () => {
    expect(lexiconBytes("not base64 at all !!")).toBeNull();
  });
});
