import os
import tempfile

from verdict_research.corpus.dataset import LabeledExample, load_jsonl, save_jsonl, train_test_split


def make_examples(count: int) -> list[LabeledExample]:
    return [
        LabeledExample(
            example_id=f"ex-{i}",
            features={"ratingDeconvolution.injectedShare": i / count},
            label=i % 2,
            metadata={"source": "synthetic"},
        )
        for i in range(count)
    ]


class TestJsonlRoundTrip:
    def test_saves_and_loads_the_same_examples(self):
        examples = make_examples(5)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "corpus.jsonl")
            save_jsonl(examples, path)
            loaded = load_jsonl(path)
        assert loaded == examples

    def test_skips_blank_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "corpus.jsonl")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write('{"exampleId": "a", "features": {}, "label": 1}\n\n')
            loaded = load_jsonl(path)
        assert len(loaded) == 1

    def test_defaults_missing_metadata_to_an_empty_dict(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "corpus.jsonl")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write('{"exampleId": "a", "features": {}, "label": 0}\n')
            loaded = load_jsonl(path)
        assert loaded[0].metadata == {}


class TestTrainTestSplit:
    def test_splits_roughly_by_the_given_fraction(self):
        examples = make_examples(100)
        train, test = train_test_split(examples, test_fraction=0.2, seed=1)
        assert len(test) == 20
        assert len(train) == 80

    def test_every_example_lands_in_exactly_one_side(self):
        examples = make_examples(50)
        train, test = train_test_split(examples, test_fraction=0.3, seed=7)
        train_ids = {e.example_id for e in train}
        test_ids = {e.example_id for e in test}
        assert train_ids.isdisjoint(test_ids)
        assert train_ids | test_ids == {e.example_id for e in examples}

    def test_same_seed_produces_the_same_split(self):
        examples = make_examples(40)
        train_a, test_a = train_test_split(examples, seed=3)
        train_b, test_b = train_test_split(examples, seed=3)
        assert [e.example_id for e in train_a] == [e.example_id for e in train_b]
        assert [e.example_id for e in test_a] == [e.example_id for e in test_b]

    def test_different_seeds_can_produce_different_splits(self):
        examples = make_examples(40)
        _, test_a = train_test_split(examples, seed=1)
        _, test_b = train_test_split(examples, seed=2)
        assert [e.example_id for e in test_a] != [e.example_id for e in test_b]

    def test_rejects_a_fraction_outside_zero_to_one(self):
        examples = make_examples(10)
        for bad in (0, 1, -0.1, 1.5):
            try:
                train_test_split(examples, test_fraction=bad)
                raise AssertionError(f"expected a ValueError for {bad}")
            except ValueError:
                pass
