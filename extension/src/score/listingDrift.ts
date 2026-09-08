import { cosineSimilarity, EMBEDDING_DIMENSIONS, embedText } from "./textEmbedding";

// SPEC.md 5.4. two detectors over one embedding: how far each review sits from the current product
// title and category, and where in time the centroid of those embeddings moves.

export interface ReviewForDrift {
  text: string | null;
}

export interface ListingDriftOptions {
  dimensions?: number;
  offTopicDistance?: number;
  // keyed by object identity, the same trade textNearDuplication.ts's signatureCache makes: a
  // bootstrap resample draws the same review objects repeatedly
  embeddingCache?: WeakMap<ReviewForDrift, number[]>;
}

export interface ChangePoint {
  // the day the later segment starts on, in the day index space the caller passed in
  day: number;
  afterCount: number;
}

export interface ListingDriftResult {
  // null when nothing could be embedded, which is not the same as zero
  offTopicShare: number | null;
  offTopicCount: number;
  meanDistance: number | null;
  changePoint: ChangePoint | null;
  driftStatistic: number;
  embeddedCount: number;
}

// cosine 0 means the review shares no more with the title than an unrelated text would. measured on
// synthetic pairs an unrelated review sits at 1.00 to 1.07 and a matching one at 0.44, so this cut
// undercounts rather than over: a review has to align with the listing not at all to be counted.
// SPEC.md 5.4 names no threshold and setting it is anshuman's, so it lives in one place.
export const DEFAULT_OFF_TOPIC_DISTANCE = 1;

// below this the split scan is fitting noise
export const MINIMUM_CHANGE_POINT_REVIEWS = 12;
export const MINIMUM_SEGMENT_REVIEWS = 5;

// on the same synthetic pairs a listing that never changed subject scores 0.008 and one that swapped
// products halfway scores 1.008. a date is only worth showing above this, and it is anshuman's.
export const MINIMUM_REPORTABLE_DRIFT = 0.5;

const ABSENT: ListingDriftResult = {
  offTopicShare: null,
  offTopicCount: 0,
  meanDistance: null,
  changePoint: null,
  driftStatistic: 0,
  embeddedCount: 0,
};

function embeddingFor(
  review: ReviewForDrift,
  dimensions: number,
  cache: WeakMap<ReviewForDrift, number[]> | undefined,
): number[] | null {
  const cached = cache?.get(review);
  if (cached !== undefined && cached.length === dimensions) {
    return cached;
  }
  if (review.text === null || review.text.length === 0) {
    return null;
  }
  const embedding = embedText(review.text, dimensions);
  if (embedding !== null) {
    cache?.set(review, embedding);
  }
  return embedding;
}

// days is parallel to reviews, null where a review carries no date. the change point runs over the
// dated subset; the distance to the product runs over everything embeddable.
export function listingIdentityDrift(
  reviews: readonly ReviewForDrift[],
  days: readonly (number | null)[],
  productText: string,
  options: ListingDriftOptions = {},
): ListingDriftResult {
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const offTopicDistance = options.offTopicDistance ?? DEFAULT_OFF_TOPIC_DISTANCE;

  const embedded: { embedding: number[]; day: number | null }[] = [];
  for (const [index, review] of reviews.entries()) {
    const embedding = embeddingFor(review, dimensions, options.embeddingCache);
    if (embedding !== null) {
      embedded.push({ embedding, day: days[index] ?? null });
    }
  }
  if (embedded.length === 0) {
    return ABSENT;
  }

  const product = embedText(productText, dimensions);
  let offTopicCount = 0;
  let meanDistance: number | null = null;
  if (product !== null) {
    let total = 0;
    for (const entry of embedded) {
      const distance = 1 - cosineSimilarity(entry.embedding, product);
      total += distance;
      if (distance >= offTopicDistance) {
        offTopicCount++;
      }
    }
    meanDistance = total / embedded.length;
  }

  const dated = embedded
    .filter((entry): entry is { embedding: number[]; day: number } => entry.day !== null)
    .sort((a, b) => a.day - b.day);
  const { changePoint, driftStatistic } = centroidChangePoint(dated);

  return {
    offTopicShare: product === null ? null : offTopicCount / embedded.length,
    offTopicCount,
    meanDistance,
    changePoint,
    driftStatistic,
    embeddedCount: embedded.length,
  };
}

// SPEC.md 5.4's cumulative sum test, over the centroid rather than over a scalar reduction of it:
// scan every split with enough reviews either side and take the cosine distance between the two
// segment centroids. bounded in zero to two and needs no variance term, which matters because a
// listing whose reviews are all alike has almost no variance to divide by.
export function centroidChangePoint(
  dated: readonly { embedding: number[]; day: number }[],
): { changePoint: ChangePoint | null; driftStatistic: number } {
  const count = dated.length;
  if (count < MINIMUM_CHANGE_POINT_REVIEWS) {
    return { changePoint: null, driftStatistic: 0 };
  }
  const dimensions = (dated[0] as { embedding: number[] }).embedding.length;

  // prefix sums, so this stays linear: buildReport.ts runs it once per bootstrap resample
  const total = new Array<number>(dimensions).fill(0);
  for (const entry of dated) {
    for (let i = 0; i < dimensions; i++) {
      total[i] = (total[i] as number) + (entry.embedding[i] as number);
    }
  }

  const before = new Array<number>(dimensions).fill(0);
  let widest = 0;
  let splitIndex = -1;
  for (let k = 1; k < count; k++) {
    const embedding = (dated[k - 1] as { embedding: number[] }).embedding;
    for (let i = 0; i < dimensions; i++) {
      before[i] = (before[i] as number) + (embedding[i] as number);
    }
    if (k < MINIMUM_SEGMENT_REVIEWS || k > count - MINIMUM_SEGMENT_REVIEWS) {
      continue;
    }
    // the cosine of the two segment centroids without materialising either: one pass over the
    // dimensions rather than three, and no allocation inside a loop the bootstrap runs 200 times
    let dot = 0;
    let beforeSquares = 0;
    let afterSquares = 0;
    for (let i = 0; i < dimensions; i++) {
      const beforeValue = before[i] as number;
      const afterValue = (total[i] as number) - beforeValue;
      dot += beforeValue * afterValue;
      beforeSquares += beforeValue * beforeValue;
      afterSquares += afterValue * afterValue;
    }
    if (beforeSquares === 0 || afterSquares === 0) {
      continue;
    }
    const distance = 1 - dot / Math.sqrt(beforeSquares * afterSquares);
    if (distance > widest) {
      widest = distance;
      splitIndex = k;
    }
  }

  if (splitIndex < 0 || widest < MINIMUM_REPORTABLE_DRIFT) {
    return { changePoint: null, driftStatistic: widest };
  }
  return {
    changePoint: {
      day: (dated[splitIndex] as { day: number }).day,
      afterCount: count - splitIndex,
    },
    driftStatistic: widest,
  };
}
