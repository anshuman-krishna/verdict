import { cosineSimilarity, EMBEDDING_DIMENSIONS, embedText } from "./textEmbedding";


export interface ReviewForDrift {
  text: string | null;
}

export interface ListingDriftOptions {
  dimensions?: number;
  offTopicDistance?: number;
  embeddingCache?: WeakMap<ReviewForDrift, number[]>;
}

export interface ChangePoint {
  day: number;
  afterCount: number;
}

export interface ListingDriftResult {
  offTopicShare: number | null;
  offTopicCount: number;
  meanDistance: number | null;
  changePoint: ChangePoint | null;
  driftStatistic: number;
  embeddedCount: number;
}

export const DEFAULT_OFF_TOPIC_DISTANCE = 1;

export const MINIMUM_CHANGE_POINT_REVIEWS = 12;
export const MINIMUM_SEGMENT_REVIEWS = 5;

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

export function centroidChangePoint(
  dated: readonly { embedding: number[]; day: number }[],
): { changePoint: ChangePoint | null; driftStatistic: number } {
  const count = dated.length;
  if (count < MINIMUM_CHANGE_POINT_REVIEWS) {
    return { changePoint: null, driftStatistic: 0 };
  }
  const dimensions = (dated[0] as { embedding: number[] }).embedding.length;

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
