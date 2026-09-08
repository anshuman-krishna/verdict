import argparse
import sys
from collections import Counter
from pathlib import Path

from verdict_research.corpus.dataset import save_jsonl
from verdict_research.corpus.featurise import (
    Extract,
    FeaturisationRun,
    LabelFileError,
    example_id_for,
    featurise,
    read_label_file,
)
from verdict_research.features.feature_vector import FeatureVectorInputs
from verdict_research.features.priors import placeholder_priors, priors_digest
from verdict_research.shipped_extractor import NodeReviewExtractor

# turns anshuman's labels plus the saved pages they name into the corpus.jsonl `just train` reads.
# it writes features and labels only: no url, no title, no reviewer id, nothing that identifies a
# listing. The fixture to row mapping is printed rather than stored, so tracing a row back needs
# this run's output and the corpus alone is not a list of products.

DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "extension" / "fixtures"


def _summarise(run: FeaturisationRun, priors: FeatureVectorInputs) -> None:
    labels = Counter(example.label for example in run.examples)
    locales = Counter(example.metadata.get("locale", "") for example in run.examples)
    print(f"rows: {len(run.examples)} written, {len(run.skipped)} skipped")
    print(f"labels: {labels[1]} manipulated, {labels[0]} clean")
    spread = ", ".join(f"{name or 'unplaced'} {count}" for name, count in sorted(locales.items()))
    print(f"locales: {spread}")
    print(f"priors: {priors_digest(priors)}")
    for skipped in run.skipped:
        print(f"skipped {skipped.fixture}: {skipped.reason}")


def main(argv: list[str] | None = None, extract: Extract | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="featurise", description="build the training corpus from labelled fixtures"
    )
    parser.add_argument("labels", help="anshuman's label file, one json object per line")
    parser.add_argument("--output", required=True, help="where to write the corpus jsonl")
    parser.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    parser.add_argument(
        "--print-mapping",
        action="store_true",
        help="print which fixture produced which row id",
    )
    args = parser.parse_args(argv)

    priors = placeholder_priors()
    try:
        labels = read_label_file(Path(args.labels))
    except (LabelFileError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    if not labels:
        print(f"{args.labels} holds no labels", file=sys.stderr)
        return 1

    try:
        run = featurise(
            labels,
            Path(args.fixtures),
            extract or NodeReviewExtractor(),
            priors,
        )
    except (LabelFileError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1

    save_jsonl(run.examples, args.output)
    _summarise(run, priors)
    if args.print_mapping:
        for label in labels:
            print(f"{label.fixture} -> {example_id_for(label.fixture)}")
    # the priors are still the flat placeholders from schema/priors.json, and every feature in this
    # corpus was computed against them. said on every run rather than in a docstring, because a
    # model trained on one set of priors and shipped against another is not visible in model.json.
    print(
        "these features were computed against the provisional priors in schema/priors.json; "
        "SPEC.md 5.1 wants per category priors from the negative corpus, and this corpus has to be "
        "rebuilt when they exist"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
