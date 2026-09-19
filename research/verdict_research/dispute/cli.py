import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from verdict_research.dispute.document import (
    DocumentError,
    ReportDocument,
    parse_report_document,
)
from verdict_research.dispute.reproduce import Reproduction, reproduce
from verdict_research.model.artifact import ArtifactError
from verdict_research.model.cli import DEFAULT_OUTPUT


def _stamp(value: float | None) -> str:
    if value is None:
        return "not recorded"
    return datetime.fromtimestamp(value / 1000, tz=UTC).date().isoformat()


def _provenance_lines(document: ReportDocument) -> list[str]:
    provenance = document.provenance
    if provenance is None:
        return ["produced by: not recorded, this check predates provenance"]
    trained = provenance.get("modelTrainedAt")
    return [
        f"produced by: verdict {provenance.get('extensionVersion', 'not recorded')}",
        f"read with: {provenance.get('rulesSite', 'not recorded')} rules version "
        f"{provenance.get('rulesVersion', 'not recorded')}",
        f"scored with: model {provenance.get('modelDigest', 'not recorded')}, trained "
        f"{_stamp(trained if isinstance(trained, int | float) else None)}",
        f"text embedded by: {provenance.get('embedding', 'not recorded')}",
    ]


def _print(document: ReportDocument, result: Reproduction) -> None:
    serial = document.serial or "unserialled"
    print(f"report {serial}: {document.title or 'no title recorded'}")
    print(f"reading: {document.band or 'not recorded'}")
    for line in _provenance_lines(document):
        print(line)
    print()

    if result.probability is None:
        print("rerun: not possible")
    elif result.agrees:
        print(
            f"rerun: reproduces exactly, {result.probability:.6f} against the {result.slot} model"
        )
    else:
        print(
            f"rerun: {result.probability:.6f} against the {result.slot} model, where the "
            f"report recorded {result.claimed_probability:.6f}"
        )
    print()

    print("what the model weighed, largest first")
    if not result.contributions:
        print("  nothing, the document carries no feature the model reads")
    for row in result.contributions:
        filled = " (filled from the sketch, this page did not carry it)" if row.imputed else ""
        print(
            f"  {row.key}: {row.value:.6f} x {row.coefficient:+.6f} = "
            f"{row.contribution:+.6f}{filled}"
        )
    print(f"  intercept: {result.intercept:+.6f}")

    if document.absent_signals:
        print()
        print(f"the platform does not record: {', '.join(document.absent_signals)}")
    if document.unavailable_signals:
        print(f"the page did not carry: {', '.join(document.unavailable_signals)}")

    for problem in result.problems:
        print()
        print(f"note: {problem}")


def _json(document: ReportDocument, result: Reproduction) -> str:
    return (
        json.dumps(
            {
                "serial": document.serial,
                "title": document.title,
                "band": document.band,
                "slot": result.slot,
                "claimedProbability": result.claimed_probability,
                "rerunProbability": result.probability,
                "difference": result.difference,
                "reproduces": result.agrees,
                "intercept": result.intercept,
                "contributions": [
                    {
                        "key": row.key,
                        "value": row.value,
                        "coefficient": row.coefficient,
                        "contribution": row.contribution,
                        "imputed": row.imputed,
                    }
                    for row in result.contributions
                ],
                "absentSignals": document.absent_signals,
                "unavailableSignals": document.unavailable_signals,
                "problems": result.problems,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dispute",
        description="run an exported report again, signal by signal",
    )
    parser.add_argument("report", help="a report exported from verdict as json")
    parser.add_argument("--model", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--output", help="write the result as json")
    args = parser.parse_args(argv)

    try:
        data = json.loads(Path(args.report).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"{args.report}: {error}", file=sys.stderr)
        return 1

    try:
        document = parse_report_document(data)
    except DocumentError as error:
        print(str(error), file=sys.stderr)
        return 1

    try:
        artifact = json.loads(Path(args.model).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"{args.model}: {error}", file=sys.stderr)
        return 1

    try:
        result = reproduce(document, artifact)
    except ArtifactError as error:
        print(str(error), file=sys.stderr)
        return 1

    _print(document, result)
    if args.output:
        Path(args.output).write_text(_json(document, result), encoding="utf-8")
        print()
        print(f"wrote {args.output}")
    return 0 if result.agrees else 1


if __name__ == "__main__":
    raise SystemExit(main())
