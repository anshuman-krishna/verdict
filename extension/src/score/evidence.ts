import type { FeatureVector } from "./featureVector";
import type { EvidenceRow, EvidenceStrength } from "./report";

// SPEC.md section 2 promises "the evidence, one expandable row per signal,
// in plain language", and DESIGN.md's panel mock names the four rows this
// produces: rating shape, arrival timing, duplicate text, different
// product. Neither document sets the weak/moderate/strong cut points, so
// the thresholds below are a proposal, in the same spirit as rosette.ts's
// harmonic mapping: not a ratified spec line, and expected to move once
// SPEC.md section 16's open questions are settled. DESIGN.md section 10
// governs the wording: statistical, never accusatory.

function strengthFromRatio(value: number, weak: number, moderate: number): EvidenceStrength {
  if (value < weak) {
    return "weak";
  }
  if (value < moderate) {
    return "moderate";
  }
  return "strong";
}

function ratingShapeRow(vector: FeatureVector): EvidenceRow {
  const result = vector.ratingDeconvolution;
  if (result === null) {
    return { signal: "rating shape", strength: "none", value: null, detail: "No star ratings to compare against an expected shape." };
  }
  const percent = Math.round(result.injectedShare * 100);
  return {
    signal: "rating shape",
    strength: strengthFromRatio(result.injectedShare, 0.15, 0.35),
    value: result.injectedShare,
    detail: `The rating distribution is consistent with about ${percent} percent of reviews being added outside the organic pattern.`,
  };
}

function arrivalTimingRow(vector: FeatureVector): EvidenceRow {
  const result = vector.temporalBurst;
  if (result === null) {
    return { signal: "arrival timing", strength: "none", value: null, detail: "No dated reviews to place on a timeline." };
  }
  if (result.burstCount === 0) {
    return { signal: "arrival timing", strength: "weak", value: 0, detail: "No unusual clustering in when reviews arrived." };
  }
  const percent = Math.round(result.burstFraction * 100);
  return {
    signal: "arrival timing",
    strength: strengthFromRatio(result.burstFraction, 0.05, 0.2),
    value: result.burstFraction,
    detail: `${result.burstCount} unusual arrival ${result.burstCount === 1 ? "burst" : "bursts"}, covering about ${percent} percent of reviews.`,
  };
}

function verificationRow(vector: FeatureVector): EvidenceRow {
  const result = vector.verificationConcentration;
  if (result === null || result.lift === null) {
    return { signal: "verification pattern", strength: "none", value: null, detail: "Not enough reviews in unusual arrival windows to compare verification rates." };
  }
  const lift = result.lift;
  return {
    signal: "verification pattern",
    strength: strengthFromRatio(lift, 1.3, 2),
    value: lift,
    detail: `Unverified reviews are about ${lift.toFixed(1)}x as common among five star reviews inside unusual arrival windows as elsewhere.`,
  };
}

function duplicateTextRow(vector: FeatureVector): EvidenceRow {
  const result = vector.textNearDuplication;
  if (result.duplicateReviewShare === null) {
    return { signal: "duplicate text", strength: "none", value: null, detail: "No review text to compare." };
  }
  const percent = Math.round(result.duplicateReviewShare * 100);
  return {
    signal: "duplicate text",
    strength: strengthFromRatio(result.duplicateReviewShare, 0.05, 0.15),
    value: result.duplicateReviewShare,
    // SPEC.md 5.5: "review farms increasingly generate text with language
    // models, so near duplication is a decaying signal", stated in the
    // methodology page copy, not repeated here per row.
    detail: `${result.clusterCount} ${result.clusterCount === 1 ? "cluster" : "clusters"} of near duplicate text, about ${percent} percent of reviews with text.`,
  };
}

// SPEC.md 5.4, listing identity drift, is not built yet (SPEC.md section 16
// open question 2, the embedding model bundle size decision). SPEC.md
// section 13's failure table already covers this exact case for when the
// embedding model fails to load at runtime: "skip signal 5.4, widen
// confidence band, note it in the evidence." this row is that note.
function differentProductRow(): EvidenceRow {
  return {
    signal: "different product",
    strength: "none",
    value: null,
    detail: "This check is not available in this release.",
  };
}

export function buildEvidence(vector: FeatureVector): EvidenceRow[] {
  return [
    ratingShapeRow(vector),
    arrivalTimingRow(vector),
    verificationRow(vector),
    duplicateTextRow(vector),
    differentProductRow(),
  ];
}
