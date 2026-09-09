import type { Review } from "../extract/types";


const WORDS = [
  "arrived", "quickly", "quality", "feels", "solid", "battery", "lasts", "about",
  "three", "days", "packaging", "was", "damaged", "but", "the", "item", "fine",
  "would", "buy", "again", "colour", "matches", "photos", "smaller", "than",
  "expected", "instructions", "unclear", "works", "as", "described",
];

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

export function syntheticProductPageHtml(reviews: readonly Review[], title: string): string {
  const payload = JSON.stringify({
    title,
    rating: "4.6",
    reviewCount: String(reviews.length),
    reviews,
  });
  return `<script type="application/ld+json">${payload}</script>`;
}
