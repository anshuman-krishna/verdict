import { BAND_COLORS, BAND_LABELS } from "../src/score/report.ts";
import {
  BASE_HARMONIC,
  MAX_AMPLITUDE,
  MAX_HARMONIC_SPREAD,
  MIN_AMPLITUDE,
} from "../src/ui/rosetteConstants.ts";

// the band scale and rosette constants as one document, replacing three copies that promised in
// comments not to drift and were never checked. change a colour without regenerating and the panel
// and the site show different ones for the same report. nothing here decides a value

export const VOCABULARY_VERSION = 1;

export function buildReportVocabulary() {
  return {
    vocabularyVersion: VOCABULARY_VERSION,
    // ordered from cleanest to worst, which is the order a scale reads in
    // and the order a legend should render
    bands: Object.keys(BAND_LABELS).map((slug) => ({
      slug,
      label: BAND_LABELS[slug],
      color: BAND_COLORS[slug],
    })),
    rosette: {
      baseHarmonic: BASE_HARMONIC,
      maxHarmonicSpread: MAX_HARMONIC_SPREAD,
      minAmplitude: MIN_AMPLITUDE,
      maxAmplitude: MAX_AMPLITUDE,
    },
  };
}

// stable ordering and a trailing newline, so regenerating an unchanged vocabulary produces no diff
// and the check below is about content rather than formatting.
export function serialiseReportVocabulary(vocabulary) {
  return `${JSON.stringify(vocabulary, null, 2)}\n`;
}
