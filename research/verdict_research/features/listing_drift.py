import math
from dataclasses import dataclass

from verdict_research.features.text_embedding import (
    EMBEDDING_DIMENSIONS,
    cosine_similarity,
    embed_text,
)

# SPEC.md 5.4. two detectors over one embedding: how far each review sits from the current product
# title and category, and where in time the centroid of those embeddings moves.

# cosine 0 means the review shares no more with the title than an unrelated text would. measured on
# synthetic pairs an unrelated review sits at 1.00 to 1.07 and a matching one at 0.44, so this cut
# undercounts rather than over: a review has to align with the listing not at all to be counted.
# SPEC.md 5.4 names no threshold and setting it is anshuman's, so it lives in one place.
DEFAULT_OFF_TOPIC_DISTANCE = 1.0

# below these the split scan is fitting noise
MINIMUM_CHANGE_POINT_REVIEWS = 12
MINIMUM_SEGMENT_REVIEWS = 5

# on the same synthetic pairs a listing that never changed subject scores 0.008 and one that swapped
# products halfway scores 1.008. a date is only worth showing above this, and it is anshuman's.
MINIMUM_REPORTABLE_DRIFT = 0.5


@dataclass
class ReviewForDrift:
    text: str | None


@dataclass
class ChangePoint:
    # the day the later segment starts on, in the same day index space the caller passed in
    day: int
    after_count: int


@dataclass
class ListingDriftResult:
    # none when nothing could be embedded, which is not the same as zero
    off_topic_share: float | None
    off_topic_count: int
    mean_distance: float | None
    change_point: ChangePoint | None
    drift_statistic: float
    embedded_count: int


_ABSENT = ListingDriftResult(
    off_topic_share=None,
    off_topic_count=0,
    mean_distance=None,
    change_point=None,
    drift_statistic=0.0,
    embedded_count=0,
)


# days is parallel to reviews, none where a review carries no date. the change point test runs over
# the dated subset; the distance to the product runs over everything embeddable.
def listing_identity_drift(
    reviews: list[ReviewForDrift],
    days: list[int | None],
    product_text: str,
    dimensions: int = EMBEDDING_DIMENSIONS,
    off_topic_distance: float = DEFAULT_OFF_TOPIC_DISTANCE,
) -> ListingDriftResult:
    embedded: list[tuple[list[float], int | None]] = []
    for index, review in enumerate(reviews):
        if review.text is None or review.text == "":
            continue
        embedding = embed_text(review.text, dimensions)
        if embedding is not None:
            embedded.append((embedding, days[index]))
    if not embedded:
        return _ABSENT

    product = embed_text(product_text, dimensions)
    off_topic_count = 0
    mean_distance = None
    if product is not None:
        total = 0.0
        for embedding, _ in embedded:
            distance = 1 - cosine_similarity(embedding, product)
            total += distance
            if distance >= off_topic_distance:
                off_topic_count += 1
        mean_distance = total / len(embedded)

    dated = sorted(
        ((embedding, day) for embedding, day in embedded if day is not None),
        key=lambda entry: entry[1],
    )
    change_point, drift_statistic = centroid_change_point(dated)

    return ListingDriftResult(
        off_topic_share=None if product is None else off_topic_count / len(embedded),
        off_topic_count=off_topic_count,
        mean_distance=mean_distance,
        change_point=change_point,
        drift_statistic=drift_statistic,
        embedded_count=len(embedded),
    )


# SPEC.md 5.4's cumulative sum test, over the centroid rather than over a scalar reduction of it:
# scan every split with enough reviews either side and take the cosine distance between the two
# segment centroids. bounded in zero to two and needs no variance term, which matters because a
# listing whose reviews are all alike has almost no variance to divide by.
def centroid_change_point(
    dated: list[tuple[list[float], int]],
) -> tuple[ChangePoint | None, float]:
    count = len(dated)
    if count < MINIMUM_CHANGE_POINT_REVIEWS:
        return None, 0.0
    dimensions = len(dated[0][0])

    # prefix sums, so this stays linear: the extension runs it once per bootstrap resample
    total = [0.0] * dimensions
    for embedding, _ in dated:
        for i in range(dimensions):
            total[i] += embedding[i]

    before = [0.0] * dimensions
    widest = 0.0
    split_index = -1
    for k in range(1, count):
        embedding = dated[k - 1][0]
        for i in range(dimensions):
            before[i] += embedding[i]
        if k < MINIMUM_SEGMENT_REVIEWS or k > count - MINIMUM_SEGMENT_REVIEWS:
            continue
        # the cosine of the two segment centroids without materialising either: one pass over the
        # dimensions rather than three, and no allocation inside a loop the bootstrap runs 200 times
        dot = 0.0
        before_squares = 0.0
        after_squares = 0.0
        for i in range(dimensions):
            before_value = before[i]
            after_value = total[i] - before_value
            dot += before_value * after_value
            before_squares += before_value * before_value
            after_squares += after_value * after_value
        if before_squares == 0 or after_squares == 0:
            continue
        distance = 1 - dot / math.sqrt(before_squares * after_squares)
        if distance > widest:
            widest = distance
            split_index = k

    if split_index < 0 or widest < MINIMUM_REPORTABLE_DRIFT:
        return None, widest
    return ChangePoint(day=dated[split_index][1], after_count=count - split_index), widest
