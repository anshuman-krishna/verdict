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
from verdict_research.features.priors import priors_document_digest, priors_for
from verdict_research.shipped_extractor import NodeReviewExtractor

DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "extension" / "fixtures"


def _summarise(run: FeaturisationRun) -> None:
    labels = Counter(example.label for example in run.examples)
    locales = Counter(example.metadata.get("locale", "") for example in run.examples)
    keys = Counter(example.metadata.get("priorsKey", "") for example in run.examples)
    print(f"rows: {len(run.examples)} written, {len(run.skipped)} skipped")
    print(f"labels: {labels[1]} manipulated, {labels[0]} clean")
    spread = ", ".join(f"{name or 'unplaced'} {count}" for name, count in sorted(locales.items()))
    print(f"locales: {spread}")
    print(f"priors: document {priors_document_digest()}")
    placed = ", ".join(f"{name or 'default'} {count}" for name, count in sorted(keys.items()))
    print(f"priors used: {placed}")
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
            priors_for,
        )
    except (LabelFileError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1

    save_jsonl(run.examples, args.output)
    _summarise(run)
    if args.print_mapping:
        for label in labels:
            print(f"{label.fixture} -> {example_id_for(label.fixture)}")
    print(
        "these features were computed against schema/priors.json as it stands now. "
        "rebuild this corpus whenever that document changes, because a row scored under one "
        "prior and a model trained under another are not measuring the same thing"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
