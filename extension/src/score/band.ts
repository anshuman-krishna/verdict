import type { Band } from "./report";

// equal fifths, a placeholder
const BAND_ORDER: readonly Band[] = [
  "clean",
  "mostly-clean",
  "mixed",
  "doubtful",
  "heavily-manipulated",
];

export function bandFromProbability(probability: number): Band {
  const clamped = Math.min(1, Math.max(0, probability));
  const index = Math.min(BAND_ORDER.length - 1, Math.floor(clamped * BAND_ORDER.length));
  return BAND_ORDER[index] as Band;
}
