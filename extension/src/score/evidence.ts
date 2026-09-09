import type { FeatureVector } from "./featureVector";
import type { EvidenceRow, EvidenceStrength } from "./report";


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
    detail: `${result.clusterCount} ${result.clusterCount === 1 ? "cluster" : "clusters"} of near duplicate text, about ${percent} percent of reviews with text.`,
  };
}

const MS_PER_DAY = 86_400_000;

function isoDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

function differentProductRow(vector: FeatureVector): EvidenceRow {
  const result = vector.listingDrift;
  if (result.embeddedCount === 0) {
    return { signal: "different product", strength: "none", value: null, detail: "No review text to compare against the product." };
  }
  const shift = result.changePoint !== null
    ? ` The wording of reviews shifts around ${isoDay(result.changePoint.day)}.`
    : "";
  if (result.offTopicShare === null) {
    return { signal: "different product", strength: "none", value: null, detail: `No product title to compare the reviews against.${shift}` };
  }
  return {
    signal: "different product",
    strength: strengthFromRatio(result.offTopicShare, 0.15, 0.4),
    value: result.offTopicShare,
    detail: `${result.offTopicCount} of ${result.embeddedCount} reviews with text share no wording with the current product title and category.${shift}`,
  };
}

function reviewerNetworkRow(result: NonNullable<FeatureVector["reviewerGraph"]>): EvidenceRow {
  if (result.identifiedReviewCount === 0) {
    return { signal: "reviewer network", strength: "none", value: null, detail: "No reviewer identifiers to check against the network." };
  }
  const share = result.flaggedReviewShare as number;
  const percent = Math.round(share * 100);
  return {
    signal: "reviewer network",
    strength: strengthFromRatio(share, 0.1, 0.3),
    value: share,
    detail: `About ${percent} percent of the reviews here were written by ${result.flaggedReviewerCount} of ${result.knownReviewerCount} accounts that also appear in networks flagged across many products.`,
  };
}

export function buildEvidence(vector: FeatureVector): EvidenceRow[] {
  const rows = [
    ratingShapeRow(vector),
    arrivalTimingRow(vector),
    verificationRow(vector),
    duplicateTextRow(vector),
    differentProductRow(vector),
  ];
  if (vector.reviewerGraph !== null) {
    rows.push(reviewerNetworkRow(vector.reviewerGraph));
  }
  return rows;
}
