import argparse
import json
import sys
from pathlib import Path

from verdict_research.corpus.dataset import load_jsonl
from verdict_research.model.artifact import LOCAL_SLOT, SLOTS, ArtifactError
from verdict_research.model.audit import Audit, audit_artifact
from verdict_research.model.cli import DEFAULT_OUTPUT


def _print(audit: Audit, corpus: str) -> None:
    point = audit.operating_point
    print(f"model.json {audit.slot} slot against {corpus}")
    print(f"features: {', '.join(sorted(audit.model.coefficients))}")
    print(
        f"rows: {audit.report.evaluated_count} scored, "
        f"{audit.report.imputed_count} with a signal imputed, "
        f"{audit.report.skipped_missing_features_count} skipped for a missing feature"
    )
    if point is None:
        print("operating point: no threshold clears the recall floor")
    else:
        print(
            f"operating point: precision {point.precision:.3f} at recall {point.recall:.3f} "
            f"(threshold {point.threshold:.3f})"
        )
    print(f"expected calibration error: {audit.report.expected_calibration_error:.4f}")
    if not audit.priors_match:
        print(
            f"corpus priors {', '.join(audit.corpus_priors)} are not the ones in schema/priors.json"
        )
    for problem in audit.problems:
        print(f"does not meet section 14: {problem}")
    if not audit.problems:
        print("still meets every section 14 criterion this corpus can measure")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="audit", description="score the exported model.json against a corpus"
    )
    parser.add_argument("corpus", help="labelled examples as jsonl")
    parser.add_argument("--model", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--slot", default=LOCAL_SLOT, choices=list(SLOTS))
    parser.add_argument("--output", help="write the result as json")
    args = parser.parse_args(argv)

    try:
        artifact = json.loads(Path(args.model).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"{args.model}: {error}", file=sys.stderr)
        return 1

    try:
        audit = audit_artifact(artifact, load_jsonl(args.corpus), args.slot)
    except ArtifactError as error:
        print(str(error), file=sys.stderr)
        return 1

    _print(audit, args.corpus)
    if args.output:
        Path(args.output).write_text(
            json.dumps(
                {
                    "slot": audit.slot,
                    "meetsCriteria": not audit.problems,
                    "problems": audit.problems,
                    "priorsMatch": audit.priors_match,
                    "corpusPriors": audit.corpus_priors,
                    "expectedCalibrationError": audit.report.expected_calibration_error,
                    "evaluatedCount": audit.report.evaluated_count,
                    "skippedMissingFeaturesCount": audit.report.skipped_missing_features_count,
                    "imputedCount": audit.report.imputed_count,
                    "precision": None
                    if audit.operating_point is None
                    else audit.operating_point.precision,
                    "recall": None
                    if audit.operating_point is None
                    else audit.operating_point.recall,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"wrote {args.output}")
    return 1 if audit.problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
