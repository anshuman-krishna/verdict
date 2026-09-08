import json
from pathlib import Path

import pytest

from verdict_research.corpus.featurise import (
    LabeledFixture,
    LabelFileError,
    Skipped,
    example_id_for,
    featurise,
    featurise_extraction,
    product_text,
    read_fixture_url,
    read_label_file,
)
from verdict_research.features.priors import placeholder_priors
from verdict_research.schema import ProductSnapshot, Review
from verdict_research.shipped_extractor import ExtractorError, FullExtraction

PRIORS = placeholder_priors()


def snapshot(title: str = "a knife set", category: str | None = "kitchen") -> ProductSnapshot:
    return ProductSnapshot(
        title=title,
        category=category,
        claimed_rating=4.6,
        review_count=90,
        site="amazon",
        locale="com",
        url="https://www.amazon.com/dp/B0ABCDEF12",
        thumbnail_url=None,
    )


def reviews(count: int) -> list[Review]:
    return [
        Review(
            rating=5 if index % 3 else 4,
            text=f"the knife set cut cleanly, review number {index}",
            date=f"2024-0{1 + index % 3}-{1 + index % 28:02d}",
            verified=index % 2 == 0,
            reviewer_id=f"reviewer-{index}",
        )
        for index in range(count)
    ]


def extraction(review_list: list[Review], product: ProductSnapshot | None = None) -> FullExtraction:
    return FullExtraction(
        url="https://www.amazon.com/dp/B0ABCDEF12",
        site="amazon",
        locale="com",
        rules_version=41,
        review_count=len(review_list),
        title=None if product is None else product.title,
        product=product,
        reviews=review_list,
    )


def write_labels(path: Path, rows: list[dict]) -> Path:
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return path


def write_fixture(directory: Path, name: str, url: str) -> None:
    (directory / f"{name}.html").write_text("<html></html>", encoding="utf-8")
    (directory / f"{name}.json").write_text(
        json.dumps({"url": url, "layout": "modern", "reviewCount": 90, "claimedRating": 4.6}),
        encoding="utf-8",
    )


class TestReadLabelFile:
    def test_reads_a_label_per_line(self, tmp_path):
        path = write_labels(
            tmp_path / "labels.jsonl",
            [
                {"fixture": "one", "label": 1, "source": "solicitation"},
                {"fixture": "two", "label": 0},
            ],
        )
        labels = read_label_file(path)
        assert [label.fixture for label in labels] == ["one", "two"]
        assert labels[0].source == "solicitation"
        assert labels[1].source is None

    def test_rejects_a_label_that_is_not_zero_or_one(self, tmp_path):
        path = write_labels(tmp_path / "labels.jsonl", [{"fixture": "one", "label": "yes"}])
        with pytest.raises(LabelFileError, match="expected 0 or 1"):
            read_label_file(path)

    # two rows for one page is a disagreement about ground truth
    def test_rejects_the_same_fixture_twice(self, tmp_path):
        path = write_labels(
            tmp_path / "labels.jsonl",
            [{"fixture": "one", "label": 1}, {"fixture": "one", "label": 0}],
        )
        with pytest.raises(LabelFileError, match="a second time"):
            read_label_file(path)

    def test_rejects_a_row_with_no_fixture(self, tmp_path):
        path = write_labels(tmp_path / "labels.jsonl", [{"label": 1}])
        with pytest.raises(LabelFileError, match="no fixture name"):
            read_label_file(path)

    def test_ignores_blank_lines(self, tmp_path):
        path = tmp_path / "labels.jsonl"
        path.write_text('\n{"fixture": "one", "label": 1}\n\n', encoding="utf-8")
        assert len(read_label_file(path)) == 1


class TestReadFixtureUrl:
    def test_reads_the_url_from_the_expectation_file(self, tmp_path):
        write_fixture(tmp_path, "one", "https://www.amazon.fr/dp/B0ABCDEF12")
        assert read_fixture_url(tmp_path, "one") == "https://www.amazon.fr/dp/B0ABCDEF12"

    def test_a_page_with_no_expectation_file_stops_the_run(self, tmp_path):
        (tmp_path / "one.html").write_text("<html></html>", encoding="utf-8")
        with pytest.raises(LabelFileError, match="one.json does not exist"):
            read_fixture_url(tmp_path, "one")

    def test_an_expectation_file_with_no_page_stops_the_run(self, tmp_path):
        (tmp_path / "one.json").write_text("{}", encoding="utf-8")
        with pytest.raises(LabelFileError, match="one.html does not exist"):
            read_fixture_url(tmp_path, "one")


class TestExampleId:
    # the corpus must not be a list of products
    def test_the_row_id_is_not_the_fixture_name(self):
        assert "B0ABCDEF12" not in example_id_for("B0ABCDEF12")

    def test_the_same_fixture_always_gets_the_same_id(self):
        assert example_id_for("one") == example_id_for("one")
        assert example_id_for("one") != example_id_for("two")


class TestProductText:
    def test_joins_the_title_and_category(self):
        assert product_text(snapshot()) == "a knife set kitchen"

    def test_a_product_with_no_category_is_its_title(self):
        assert product_text(snapshot(category=None)) == "a knife set"


class TestFeaturiseExtraction:
    def test_produces_the_flat_feature_names_the_model_reads(self):
        result = featurise_extraction(
            extraction(reviews(60), snapshot()), LabeledFixture("one", 1), PRIORS
        )
        assert not isinstance(result, Skipped)
        assert result.label == 1
        assert "ratingDeconvolution.injectedShare" in result.features
        assert "listingDrift.driftStatistic" in result.features

    def test_carries_the_locale_and_rules_version_but_no_url(self):
        result = featurise_extraction(
            extraction(reviews(60), snapshot()),
            LabeledFixture("one", 1, source="solicitation"),
            PRIORS,
        )
        assert not isinstance(result, Skipped)
        assert result.metadata["locale"] == "com"
        assert result.metadata["rulesVersion"] == "41"
        assert result.metadata["source"] == "solicitation"
        assert "amazon.com" not in json.dumps(result.metadata)

    # SPEC.md section 6 shows no score under the thresholds, so the model must not be fitted there
    def test_skips_a_listing_under_the_minimum_data_thresholds(self):
        result = featurise_extraction(
            extraction(reviews(5), snapshot()), LabeledFixture("one", 1), PRIORS
        )
        assert result == Skipped("one", "below the minimum data thresholds")

    def test_skips_a_page_extraction_found_no_product_on(self):
        result = featurise_extraction(
            extraction(reviews(60), None), LabeledFixture("one", 0), PRIORS
        )
        assert result == Skipped("one", "extraction found no product")

    def test_records_which_priors_the_features_were_computed_against(self):
        result = featurise_extraction(
            extraction(reviews(60), snapshot()), LabeledFixture("one", 1), PRIORS
        )
        assert not isinstance(result, Skipped)
        assert len(result.metadata["priors"]) == 8


class TestFeaturise:
    def test_featurises_every_labelled_page(self, tmp_path):
        write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
        write_fixture(tmp_path, "two", "https://www.amazon.fr/dp/B0ABCDEF13")
        run = featurise(
            [LabeledFixture("one", 1), LabeledFixture("two", 0)],
            tmp_path,
            lambda html, url: extraction(reviews(60), snapshot()),
            PRIORS,
        )
        assert len(run.examples) == 2
        assert run.skipped == []

    # one unreadable page is a gap in the corpus, not the end of the run
    def test_an_extractor_failure_skips_one_page_and_keeps_going(self, tmp_path):
        write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
        write_fixture(tmp_path, "two", "https://www.amazon.fr/dp/B0ABCDEF13")

        def extract(html: str, url: str) -> FullExtraction:
            if "amazon.com" in url:
                raise ExtractorError("node is not on the path")
            return extraction(reviews(60), snapshot())

        run = featurise(
            [LabeledFixture("one", 1), LabeledFixture("two", 0)], tmp_path, extract, PRIORS
        )
        assert len(run.examples) == 1
        assert run.skipped[0].fixture == "one"
        assert "node is not on the path" in run.skipped[0].reason

    def test_a_missing_page_stops_the_run(self, tmp_path):
        with pytest.raises(LabelFileError):
            featurise(
                [LabeledFixture("absent", 1)],
                tmp_path,
                lambda html, url: extraction(reviews(60), snapshot()),
                PRIORS,
            )

    def test_the_page_url_is_what_the_extractor_is_given(self, tmp_path):
        write_fixture(tmp_path, "one", "https://www.amazon.de/dp/B0ABCDEF12")
        seen: list[str] = []

        def extract(html: str, url: str) -> FullExtraction:
            seen.append(url)
            return extraction(reviews(60), snapshot())

        featurise([LabeledFixture("one", 1)], tmp_path, extract, PRIORS)
        assert seen == ["https://www.amazon.de/dp/B0ABCDEF12"]
