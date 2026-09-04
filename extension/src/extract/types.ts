export interface Review {
  rating: number | null;
  text: string | null;
  date: string | null;
  verified: boolean | null;
  reviewerId: string | null;
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
