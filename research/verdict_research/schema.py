from dataclasses import dataclass


@dataclass
class Review:
    rating: int | None
    text: str | None
    date: str | None
    verified: bool | None
    reviewer_id: str | None


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
    )


def review_to_json(review: Review) -> dict:
    return {
        "rating": review.rating,
        "text": review.text,
        "date": review.date,
        "verified": review.verified,
        "reviewerId": review.reviewer_id,
    }


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
