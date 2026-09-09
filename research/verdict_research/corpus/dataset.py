import json
import random
from dataclasses import dataclass, field


@dataclass
class LabeledExample:
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
