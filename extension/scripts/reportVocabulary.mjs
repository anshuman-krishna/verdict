import { BAND_COLORS, BAND_LABELS } from "../src/score/report.ts";
import {
  BASE_HARMONIC,
  MAX_AMPLITUDE,
  MAX_HARMONIC_SPREAD,
  MIN_AMPLITUDE,
} from "../src/ui/rosetteConstants.ts";

// the band scale and the rosette's shape constants, as one document the
// website reads instead of keeping its own copy.
//
// There were three copies: extension/src/score/report.ts, and one each in
// site/src/pages/check and site/src/pages/history, the site ones carrying
// comments saying they were mirrored from the extension "so the two never
// quietly disagree". Nothing checked. Band colours are DESIGN.md section
// 4's and what the bands mean is anshuman's, so the day one changes, the
// panel would show the new colour and the website the old one, for the same
// report, and the only way to notice is to look at both at once.
//
// Generated rather than imported across packages, in the same shape as the
// two documents this repository already hands between packages: model.json
// from research to the extension, and status.json from research to the
// site. Nothing here decides a value; it copies the ones the extension
// already ships.

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

// stable ordering and a trailing newline, so regenerating an unchanged
// vocabulary produces no diff and the check below is about content rather
// than formatting.
export function serialiseReportVocabulary(vocabulary) {
  return `${JSON.stringify(vocabulary, null, 2)}\n`;
}
