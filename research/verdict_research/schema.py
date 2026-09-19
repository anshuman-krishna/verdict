from dataclasses import dataclass
from typing import Literal

# how wide the window the page named was. none means exact, which is what an absolute date is
DatePrecision = Literal["exact", "day", "week", "month", "year"]

# a date wide enough to be placed on a timeline is one a page named a single day for
TIMELINE_PRECISIONS: frozenset[str] = frozenset({"exact", "day"})


@dataclass
class Review:
    rating: int | None
    text: str | None
    date: str | None
    verified: bool | None
    reviewer_id: str | None
    date_precision: DatePrecision | None = None

    @property
    def has_timeline_date(self) -> bool:
        return self.date is not None and (self.date_precision or "exact") in TIMELINE_PRECISIONS


@dataclass
class ProductSnapshot:
    title: str
    category: str | None
    claimed_rating: float | None
    review_count: int | None
    site: str
    locale: str
    url: str
    thumbnail_url: str | None


def review_from_json(data: dict) -> Review:
    return Review(
        rating=data["rating"],
        text=data["text"],
        date=data["date"],
        verified=data["verified"],
        reviewer_id=data["reviewerId"],
        date_precision=data.get("datePrecision"),
    )


def review_to_json(review: Review) -> dict:
    document = {
        "rating": review.rating,
        "text": review.text,
        "date": review.date,
        "verified": review.verified,
        "reviewerId": review.reviewer_id,
    }
    # exact is the absent case, so a review off a page that writes absolute dates round trips
    if review.date_precision is not None:
        document["datePrecision"] = review.date_precision
    return document


def product_snapshot_from_json(data: dict) -> ProductSnapshot:
    return ProductSnapshot(
        title=data["title"],
        category=data["category"],
        claimed_rating=data["claimedRating"],
        review_count=data["reviewCount"],
        site=data["site"],
        locale=data["locale"],
        url=data["url"],
        thumbnail_url=data["thumbnailUrl"],
    )


def product_snapshot_to_json(snapshot: ProductSnapshot) -> dict:
    return {
        "title": snapshot.title,
        "category": snapshot.category,
        "claimedRating": snapshot.claimed_rating,
        "reviewCount": snapshot.review_count,
        "site": snapshot.site,
        "locale": snapshot.locale,
        "url": snapshot.url,
        "thumbnailUrl": snapshot.thumbnail_url,
    }
