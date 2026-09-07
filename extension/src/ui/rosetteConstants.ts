// DESIGN.md section 7's rosette shape constants, in a module of their own
// with no imports at all.
//
// Two things read them: ui/rosette.ts, which draws the panel's rosette, and
// scripts/reportVocabulary.mjs, which publishes them to the website so its
// report block draws the same curve. The second reads this file with node,
// which runs typescript by stripping the types and does not rewrite an
// extensionless import, so a module it reads cannot have runtime imports.
// That constraint is the only reason these are not in rosette.ts beside the
// function that uses them.
//
// The exact mapping from a feature vector to harmonics and amplitude is not
// spelled out in DESIGN.md, so these are a proposal, not a ratified spec
// line.
export const BASE_HARMONIC = 3;
export const MAX_HARMONIC_SPREAD = 4;
export const MIN_AMPLITUDE = 0.15;
export const MAX_AMPLITUDE = 0.8;
