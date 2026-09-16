import argparse
import json
import sys
from pathlib import Path

from verdict_research.corpus.featurise import Extract, LabelFileError, read_label_file
from verdict_research.model.priors_fit import (
    DEFAULT_MIN_LISTINGS,
    DEFAULT_MIN_REVIEWS,
    PriorsFit,
    dangling_aliases,
    fit_priors,
    priors_document,
    write_priors_document,
)
from verdict_research.shipped_extractor import NodeReviewExtractor

DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "extension" / "fixtures"
PRIORS_PATH = Path(__file__).resolve().parents[3] / "schema" / "priors.json"


def _report(fit: PriorsFit, document: dict) -> None:
    print(f"clean listings read: {fit.clean_listings}")
    if fit.default is not None:
        shape = ", ".join(f"{value:.3f}" for value in fit.default.organic_prior)
        print(f"across all of them: {shape}")
    for estimate in fit.estimates:
        shape = ", ".join(f"{value:.3f}" for value in estimate.organic_prior)
        print(
            f"{estimate.key}: {shape}"
            f"  ({estimate.listing_count} listings, {estimate.review_count} reviews)"
        )
    for thin in fit.thin:
        print(f"too thin to estimate {thin.key}: {thin.reason}")
    for skipped in fit.skipped:
        print(f"skipped {skipped}")
    for dangling in dangling_aliases(document):
        print(f"alias with nothing behind it: {dangling}")


def main(argv: list[str] | None = None, extract: Extract | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="priors",
        description="estimate the organic rating shape per category from the clean corpus",
    )
    parser.add_argument("labels", help="anshuman's label file, one json object per line")
    parser.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    parser.add_argument("--min-listings", type=int, default=DEFAULT_MIN_LISTINGS)
    parser.add_argument("--min-reviews", type=int, default=DEFAULT_MIN_REVIEWS)
    parser.add_argument(
        "--replace-default",
        action="store_true",
        help="also replace the fallback shape with the one every clean listing averages to",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="write schema/priors.json, which means the corpus and the model both need rebuilding",
    )
    args = parser.parse_args(argv)

    try:
        labels = read_label_file(Path(args.labels))
    except (LabelFileError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    if not any(label.label == 0 for label in labels):
        print(
            f"{args.labels} labels nothing clean, and the prior is estimated from the clean ones",
            file=sys.stderr,
        )
        return 1

    try:
        fit = fit_priors(
            labels,
            Path(args.fixtures),
            extract or NodeReviewExtractor(),
            min_listings=args.min_listings,
            min_reviews=args.min_reviews,
        )
    except (LabelFileError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1

    with open(PRIORS_PATH, encoding="utf-8") as handle:
        existing = json.load(handle)
    document = priors_document(fit, existing, replace_default=args.replace_default)
    _report(fit, document)

    if not args.write:
        print("\nnothing written. rerun with --write to keep it")
        print(json.dumps(document, indent=2, ensure_ascii=False))
        return 0

    write_priors_document(PRIORS_PATH, document)
    print(f"\nwrote {PRIORS_PATH}")
    print("rebuild the corpus with `just featurise` and retrain, or `just check` will say so")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
