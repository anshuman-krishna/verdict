import json
import random
from dataclasses import dataclass, field

# CLAUDE.md reserves the label corpus and its methodology to anshuman:
# what counts as a positive label, how solicitation groups were read, what
# goes in the negative set. None of that is decided here. This is the
# mechanical layer underneath it: a record shape, JSONL read and write,
# and a deterministic split, the same kind of plumbing PLAN.md week one
# built for reviews before any signal existed to score them.
#
# SPEC.md section 12: "a held out test set is created once, never looked
# at during development, and used only for the final report." Nothing in
# this file enforces that discipline, a function cannot, but train_test_
# split's docstring says so because calling it twice on the same real
# corpus with different seeds is exactly how that rule gets broken by
# accident.


@dataclass
class LabeledExample:
    # opaque to this module: a hash or a row number, never a reviewer id
    # or a product id. what identifies a review or a product is extraction
    # and cache territory (extract/, storage/), not the corpus.
    example_id: str
    features: dict[str, float | None]
    label: int
    metadata: dict[str, str] = field(default_factory=dict)


def load_jsonl(path: str) -> list[LabeledExample]:
    examples = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            examples.append(
                LabeledExample(
                    example_id=data["exampleId"],
                    features=data["features"],
                    label=data["label"],
                    metadata=data.get("metadata", {}),
                )
            )
    return examples


def save_jsonl(examples: list[LabeledExample], path: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        for example in examples:
            row = {
                "exampleId": example.example_id,
                "features": example.features,
                "label": example.label,
                "metadata": example.metadata,
            }
            handle.write(json.dumps(row))
            handle.write("\n")


# a deterministic shuffle and split, seeded so the same corpus and seed
# always produce the same two sets. Meant for iterating during
# development on a scratch or synthetic corpus. The real held out set
# SPEC.md section 12 describes is a one time act, not a repeatable
# function call: whoever runs this against the actual labelled corpus to
# create that set should run it exactly once, record the seed and the
# resulting example ids somewhere durable, and then stop calling it again
# on that corpus.
def train_test_split(
    examples: list[LabeledExample], test_fraction: float = 0.2, seed: int = 0
) -> tuple[list[LabeledExample], list[LabeledExample]]:
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be between 0 and 1, exclusive")
    shuffled = list(examples)
    random.Random(seed).shuffle(shuffled)
    test_count = round(len(shuffled) * test_fraction)
    test_set = shuffled[:test_count]
    train_set = shuffled[test_count:]
    return train_set, test_set
