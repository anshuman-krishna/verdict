import { BAND_COLORS, BAND_LABELS } from "../src/score/report.ts";
import {
  BASE_HARMONIC,
  MAX_AMPLITUDE,
  MAX_HARMONIC_SPREAD,
  MIN_AMPLITUDE,
} from "../src/ui/rosetteConstants.ts";


export const VOCABULARY_VERSION = 1;

export function buildReportVocabulary() {
  return {
    vocabularyVersion: VOCABULARY_VERSION,
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

export function serialiseReportVocabulary(vocabulary) {
  return `${JSON.stringify(vocabulary, null, 2)}\n`;
}
