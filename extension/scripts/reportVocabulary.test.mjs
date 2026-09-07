import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BAND_COLORS, BAND_LABELS } from "../src/score/report";
import {
  BASE_HARMONIC,
  MAX_AMPLITUDE,
  MAX_HARMONIC_SPREAD,
  MIN_AMPLITUDE,
} from "../src/ui/rosetteConstants";
import {
  VOCABULARY_VERSION,
  buildReportVocabulary,
  serialiseReportVocabulary,
} from "./reportVocabulary.mjs";

const COMMITTED = resolve(
  import.meta.dirname,
  "..",
  "..",
  "site",
  "src",
  "data",
  "reportVocabulary.json",
);

describe("buildReportVocabulary", () => {
  it("carries every band the extension defines, cleanest first", () => {
    expect(buildReportVocabulary().bands.map((band) => band.slug)).toEqual(
      Object.keys(BAND_LABELS),
    );
  });

  it("takes each label and colour from the extension rather than restating them", () => {
    for (const band of buildReportVocabulary().bands) {
      expect(band.label).toBe(BAND_LABELS[band.slug]);
      expect(band.color).toBe(BAND_COLORS[band.slug]);
    }
  });

  it("carries the rosette constants the panel draws with", () => {
    expect(buildReportVocabulary().rosette).toEqual({
      baseHarmonic: BASE_HARMONIC,
      maxHarmonicSpread: MAX_HARMONIC_SPREAD,
      minAmplitude: MIN_AMPLITUDE,
      maxAmplitude: MAX_AMPLITUDE,
    });
  });

  it("is stamped with a version, so the site can refuse one it cannot read", () => {
    expect(buildReportVocabulary().vocabularyVersion).toBe(VOCABULARY_VERSION);
  });

  it("serialises identically twice, so regenerating makes no diff", () => {
    expect(serialiseReportVocabulary(buildReportVocabulary())).toBe(
      serialiseReportVocabulary(buildReportVocabulary()),
    );
  });

  it("ends in a newline", () => {
    expect(serialiseReportVocabulary(buildReportVocabulary()).endsWith("\n")).toBe(true);
  });
});

// the guard that makes any of this worth doing. A band colour is DESIGN.md
// section 4's and what a band means is anshuman's; changing one and
// forgetting to regenerate would leave the panel showing the new colour and
// the website the old one, for the same report, with nothing saying so.
describe("the committed vocabulary the site reads", () => {
  it("is what the extension currently defines", () => {
    expect(readFileSync(COMMITTED, "utf8")).toBe(
      serialiseReportVocabulary(buildReportVocabulary()),
    );
  });
});
