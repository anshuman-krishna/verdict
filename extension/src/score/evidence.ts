import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import type { FeatureVector } from "./featureVector";
import type { EvidenceMessage, EvidenceRow, EvidenceStrength } from "./report";
import { SIGNAL_NAMES } from "./combine";

function strengthFromRatio(value: number, weak: number, moderate: number): EvidenceStrength {
  if (value < weak) {
    return "weak";
  }
  if (value < moderate) {
    return "moderate";
  }
  return "strong";
}

export function renderEvidenceMessages(
  messages: readonly EvidenceMessage[],
  translator: Translator = ENGLISH_TRANSLATOR,
): string {
  return messages
    .map((message) =>
      message.count === undefined
        ? translator.text(message.id, message.params)
        : translator.count(message.id, message.count, message.params)
    )
    .join(" ");
}

function row(
  feature: keyof typeof SIGNAL_NAMES,
  strength: EvidenceStrength,
  value: number | null,
  messages: EvidenceMessage[],
): EvidenceRow {
  return {
    signal: SIGNAL_NAMES[feature] as string,
    strength,
    value,
    messages,
    detail: renderEvidenceMessages(messages),
  };
}

function percentOf(share: number): number {
  return Math.round(share * 100);
}

function ratingShapeRow(vector: FeatureVector): EvidenceRow {
  const result = vector.ratingDeconvolution;
  if (result === null) {
    return row("ratingDeconvolution", "none", null, [{ id: "evidence.ratingShape.none" }]);
  }
  return row(
    "ratingDeconvolution",
    strengthFromRatio(result.injectedShare, 0.15, 0.35),
    result.injectedShare,
    [{ id: "evidence.ratingShape.share", params: { percent: percentOf(result.injectedShare) } }],
  );
}

function arrivalTimingRow(vector: FeatureVector): EvidenceRow {
  const result = vector.temporalBurst;
  if (result === null) {
    return row("temporalBurst", "none", null, [{ id: "evidence.arrivalTiming.none" }]);
  }
  if (result.burstCount === 0) {
    return row("temporalBurst", "weak", 0, [{ id: "evidence.arrivalTiming.quiet" }]);
  }
  return row(
    "temporalBurst",
    strengthFromRatio(result.burstFraction, 0.05, 0.2),
    result.burstFraction,
    [
      {
        id: "evidence.arrivalTiming.bursts",
        count: result.burstCount,
        params: { percent: percentOf(result.burstFraction) },
      },
    ],
  );
}

function verificationRow(vector: FeatureVector): EvidenceRow {
  const result = vector.verificationConcentration;
  if (result === null || result.lift === null) {
    return row("verificationConcentration", "none", null, [
      { id: "evidence.verification.none" },
    ]);
  }
  const lift = result.lift;
  return row("verificationConcentration", strengthFromRatio(lift, 1.3, 2), lift, [
    { id: "evidence.verification.lift", params: { lift: ENGLISH_TRANSLATOR.decimal(lift, 1) } },
  ]);
}

function duplicateTextRow(vector: FeatureVector): EvidenceRow {
  const result = vector.textNearDuplication;
  if (result.duplicateReviewShare === null) {
    return row("textNearDuplication", "none", null, [{ id: "evidence.duplicateText.none" }]);
  }
  return row(
    "textNearDuplication",
    strengthFromRatio(result.duplicateReviewShare, 0.05, 0.15),
    result.duplicateReviewShare,
    [
      {
        id: "evidence.duplicateText.clusters",
        count: result.clusterCount,
        params: { percent: percentOf(result.duplicateReviewShare) },
      },
    ],
  );
}

const MS_PER_DAY = 86_400_000;

function isoDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

function differentProductRow(vector: FeatureVector): EvidenceRow {
  const result = vector.listingDrift;
  if (result.embeddedCount === 0) {
    return row("listingDrift", "none", null, [{ id: "evidence.differentProduct.none" }]);
  }
  const shift: EvidenceMessage[] = result.changePoint === null
    ? []
    : [{
      id: "evidence.differentProduct.shift",
      params: { day: isoDay(result.changePoint.day) },
    }];
  if (result.offTopicShare === null) {
    return row("listingDrift", "none", null, [
      { id: "evidence.differentProduct.noTitle" },
      ...shift,
    ]);
  }
  return row(
    "listingDrift",
    strengthFromRatio(result.offTopicShare, 0.15, 0.4),
    result.offTopicShare,
    [
      {
        id: "evidence.differentProduct.share",
        count: result.offTopicCount,
        params: { embedded: result.embeddedCount },
      },
      ...shift,
    ],
  );
}

function reviewerNetworkRow(result: NonNullable<FeatureVector["reviewerGraph"]>): EvidenceRow {
  if (result.identifiedReviewCount === 0) {
    return row("reviewerGraph", "none", null, [{ id: "evidence.reviewerNetwork.none" }]);
  }
  const share = result.flaggedReviewShare as number;
  return row("reviewerGraph", strengthFromRatio(share, 0.1, 0.3), share, [
    {
      id: "evidence.reviewerNetwork.share",
      params: {
        percent: percentOf(share),
        flagged: result.flaggedReviewerCount,
        known: result.knownReviewerCount,
      },
    },
  ]);
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
