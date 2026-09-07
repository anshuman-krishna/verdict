import argparse
import json
import sys
import time
from pathlib import Path

from verdict_research.corpus.dataset import LabeledExample, load_jsonl
from verdict_research.model.artifact import (
    absent_model_artifact,
    build_model_artifact,
    write_model_artifact_file,
)
from verdict_research.model.pipeline import (
    TrainingRun,
    acceptance_problems,
    acceptance_summary,
    train_pipeline,
)

# PLAN.md week 5's outcome as one command. SPEC.md section 4 calls model.json "a small parameter
# file bundled into the extension at build time", so the default output path is the file
# extension/src/score/model.ts imports; there is no separate copy step to forget.
#
# the corpus this reads is anshuman's (SPEC.md section 12) and so is the choice of features, which
# is why --features is required rather than inferred. --list-features exists so the choice can be
# made from what the corpus actually carries rather than from memory.

DEFAULT_OUTPUT = Path(__file__).resolve().parents[2].parent / "extension/src/score/model.json"


def _feature_names(examples: list[LabeledExample]) -> list[str]:
    names: set[str] = set()
    for example in examples:
        names.update(example.features)
    return sorted(names)


def _print_run(run: TrainingRun, problems: list[str]) -> None:
    point = run.operating_point
    print(f"features: {', '.join(run.feature_names)}")
    print(
        f"rows: {run.sizes.train} train, {run.sizes.calibration} calibration, "
        f"{run.sizes.test} held out, {run.sizes.dropped_incomplete} dropped as incomplete"
    )
    if point is None:
        print("operating point: no threshold clears the recall floor")
    else:
        print(
            f"operating point: precision {point.precision:.3f} at recall {point.recall:.3f} "
            f"(threshold {point.threshold:.3f})"
        )
    print(f"expected calibration error: {run.report.expected_calibration_error:.4f}")
    if problems:
        for problem in problems:
            print(f"does not meet section 14: {problem}")
    else:
        print("meets every section 14 criterion this run can measure")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="train", description="train, calibrate, and export model.json"
    )
    parser.add_argument("corpus", help="labelled examples as jsonl")
    parser.add_argument("--features", help="comma separated feature names the model uses")
    parser.add_argument(
        "--list-features", action="store_true", help="print what the corpus carries"
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--eval-output", help="write the full evaluation report as json")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--test-fraction", type=float, default=0.2)
    parser.add_argument("--calibration-fraction", type=float, default=0.25)
    parser.add_argument("--iterations", type=int, default=2000)
    parser.add_argument("--learning-rate", type=float, default=0.1)
    parser.add_argument("--l2", type=float, default=0.0)
    # a model that misses section 14 is still worth inspecting, but it does not get bundled by
    # accident: writing one takes saying so, and the file then records that it missed.
    parser.add_argument(
        "--write-below-criteria",
        action="store_true",
        help="export even when an acceptance criterion is unmet",
    )
    args = parser.parse_args(argv)

    examples = load_jsonl(args.corpus)
    if args.list_features:
        for name in _feature_names(examples):
            print(name)
        return 0
    if not examples:
        print(f"{args.corpus} holds no examples", file=sys.stderr)
        return 1
    if not args.features:
        print("--features is required, see --list-features", file=sys.stderr)
        return 1

    run = train_pipeline(
        examples,
        [name.strip() for name in args.features.split(",") if name.strip()],
        test_fraction=args.test_fraction,
        calibration_fraction=args.calibration_fraction,
        seed=args.seed,
        learning_rate=args.learning_rate,
        iterations=args.iterations,
        l2=args.l2,
    )
    problems = acceptance_problems(run)
    _print_run(run, problems)

    if args.eval_output:
        Path(args.eval_output).write_text(
            json.dumps(
                {
                    "acceptance": acceptance_summary(run),
                    "curve": [
                        {"threshold": p.threshold, "precision": p.precision, "recall": p.recall}
                        for p in run.report.curve
                    ],
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

    if problems and not args.write_below_criteria:
        print(
            f"not written to {args.output}, pass --write-below-criteria to override",
            file=sys.stderr,
        )
        return 1

    write_model_artifact_file(
        args.output,
        build_model_artifact(run.model, trained_at=time.time(), acceptance=acceptance_summary(run)),
    )
    print(f"wrote {args.output}")
    return 0


def clear(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="clear-model", description="restore the absent model.json"
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--reason", default="no model has been trained yet")
    args = parser.parse_args(argv)
    write_model_artifact_file(args.output, absent_model_artifact(args.reason))
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
