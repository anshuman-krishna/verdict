import type { Review } from "../extract/types";

// load for the timing harness, not data. Nothing here is a fixture and
// nothing here carries a label: the corpus in extension/fixtures and the
// labelled corpus in research/ are both hand built (SPEC.md section 12).
// What this has to be realistic about is only the shape that costs time:
// how many reviews, how much text each carries, how many of them are near
// duplicates of each other, and how far apart their dates are, since those
// four are what the minhash, the burst detector, and the bootstrap all
// scale on.

const WORDS = [
  "arrived", "quickly", "quality", "feels", "solid", "battery", "lasts", "about",
  "three", "days", "packaging", "was", "damaged", "but", "the", "item", "fine",
  "would", "buy", "again", "colour", "matches", "photos", "smaller", "than",
  "expected", "instructions", "unclear", "works", "as", "described",
];

// a small deterministic generator, so a slow run is reproducible and a
// timing regression can be re-measured against the same load.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticLoadOptions {
  count: number;
  seed?: number;
  // share of reviews that repeat an earlier review's text, which is what
  // gives the near duplication clustering something to do
  duplicateShare?: number;
  wordsPerReview?: number;
  daysSpanned?: number;
}

export function syntheticReviews(options: SyntheticLoadOptions): Review[] {
  const random = mulberry32(options.seed ?? 1);
  const duplicateShare = options.duplicateShare ?? 0.2;
  const wordsPerReview = options.wordsPerReview ?? 40;
  const daysSpanned = options.daysSpanned ?? 365;
  const start = Date.UTC(2024, 0, 1);

  const reviews: Review[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const duplicate = index > 0 && random() < duplicateShare;
    const text = duplicate
      ? (reviews[Math.floor(random() * reviews.length)]?.text ?? "")
      : sentence(random, wordsPerReview);
    const day = Math.floor(random() * daysSpanned);
    reviews.push({
      rating: 1 + Math.floor(random() * 5),
      text,
      date: new Date(start + day * 86_400_000).toISOString().slice(0, 10),
      verified: random() < 0.7,
      reviewerId: `reviewer-${index}`,
    });
  }
  return reviews;
}

function sentence(random: () => number, words: number): string {
  const parts: string[] = [];
  for (let index = 0; index < words; index += 1) {
    parts.push(WORDS[Math.floor(random() * WORDS.length)] as string);
  }
  return parts.join(" ");
}

// the same reviews as an embedded json block, so the timing run goes
// through the real extraction path rather than starting from objects the
// extractor never had to find.
export function syntheticProductPageHtml(reviews: readonly Review[], title: string): string {
  const payload = JSON.stringify({
    title,
    rating: "4.6",
    reviewCount: String(reviews.length),
    reviews,
  });
  return `<script type="application/ld+json">${payload}</script>`;
}
