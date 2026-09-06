import type { Band } from "./report";

// SPEC.md section 16 lists "band boundaries and their names" as an open
// question for anshuman. The five names below already exist in report.ts,
// carried over from DESIGN.md section 4. Evenly spaced quintiles are a
// placeholder boundary set so a probability can be shown as something
// while that decision is pending; it is not itself the decision, the same
// way settings.ts's DEFAULT_HISTORY_ENABLED is a placeholder and not a
// ratified default.
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
