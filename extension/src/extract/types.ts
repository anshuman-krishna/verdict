import type { DatePrecision } from "./normalise";

export interface Review {
  rating: number | null;
  text: string | null;
  date: string | null;
  verified: boolean | null;
  reviewerId: string | null;
  // absent means exact, so a review stored before dates carried a width still reads
  datePrecision?: DatePrecision;
}

// a date wide enough to be placed on a timeline is one a page named a single day for
const TIMELINE_PRECISIONS: ReadonlySet<DatePrecision> = new Set(["exact", "day"]);

export function hasTimelineDate(review: Review): review is Review & { date: string } {
  return review.date !== null && TIMELINE_PRECISIONS.has(review.datePrecision ?? "exact");
}

export function hasDate(review: Review): review is Review & { date: string } {
  return review.date !== null;
}

export interface ProductSnapshot {
  title: string;
  category: string | null;
  claimedRating: number | null;
  reviewCount: number | null;
  site: string;
  locale: string;
  url: string;
  thumbnailUrl: string | null;
}
