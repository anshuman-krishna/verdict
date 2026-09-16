import json
from pathlib import Path

from tests.test_featurise import snapshot, write_fixture
from verdict_research.corpus.featurise import LabeledFixture
from verdict_research.model.priors_cli import PRIORS_PATH, main
from verdict_research.model.priors_fit import dangling_aliases, fit_priors, priors_document
from verdict_research.schema import Review
from verdict_research.shipped_extractor import ExtractorError, FullExtraction


# five stars for the given share of a hundred reviews, the rest spread below
def listing(five_star_share: float, category: str | None = "Home & Kitchen > Kettles"):
    fives = round(five_star_share * 100)
    rest = 100 - fives
    each = rest // 4
    ratings = [5] * fives + [2] * each + [3] * each + [4] * each + [1] * (rest - 3 * each)
    reviews = [
        Review(rating=rating, text="a review", date="2024-01-01", verified=True, reviewer_id=None)
        for rating in ratings
    ]
    return FullExtraction(
        url="https://www.amazon.com/dp/B0ABCDEF12",
        site="amazon",
        locale="com",
        rules_version=41,
        review_count=len(reviews),
        title="a kettle",
        product=snapshot(category=category),
        reviews=reviews,
    )


def corpus(tmp_path: Path, count: int, label: int = 0) -> list[LabeledFixture]:
    labels = []
    for index in range(count):
        name = f"fixture-{label}-{index}"
        write_fixture(tmp_path, name, f"https://www.amazon.com/dp/B0ABCDEF{index:02d}")
        labels.append(LabeledFixture(name, label))
    return labels


def fit(tmp_path, labels, extract, **kwargs):
    return fit_priors(labels, tmp_path, extract, **dict({"min_reviews": 100}, **kwargs))


class TestFitPriors:
    def test_estimates_every_level_of_the_trail(self, tmp_path):
        labels = corpus(tmp_path, 6)

        result = fit(tmp_path, labels, lambda html, url: listing(0.6))

        assert [estimate.key for estimate in result.estimates] == ["home-kitchen", "kettles"]
        for estimate in result.estimates:
            assert estimate.listing_count == 6
            assert abs(sum(estimate.organic_prior) - 1) < 1e-9
            assert estimate.organic_prior[4] == 0.6

    def test_reads_only_the_listings_labelled_clean(self, tmp_path):
        clean = corpus(tmp_path, 5)
        manipulated = corpus(tmp_path, 5, label=1)
        read: list[str] = []

        def extract(html: str, url: str) -> FullExtraction:
            read.append(url)
            return listing(0.5)

        result = fit(tmp_path, clean + manipulated, extract)

        assert result.clean_listings == 5
        assert len(read) == 5
        assert result.estimates[0].organic_prior[4] == 0.5

    def test_gives_every_listing_the_same_weight(self, tmp_path):
        labels = corpus(tmp_path, 6)
        shares = iter([1.0, 0.2, 0.2, 0.2, 0.2, 0.2])

        # one listing with forty thousand reviews must not become the category
        def extract(html: str, url: str) -> FullExtraction:
            return listing(next(shares))

        result = fit(tmp_path, labels, extract)

        assert abs(result.estimates[0].organic_prior[4] - (1.0 + 0.2 * 5) / 6) < 1e-9

    def test_says_a_category_is_too_thin_rather_than_estimating_it(self, tmp_path):
        labels = corpus(tmp_path, 3)

        result = fit(tmp_path, labels, lambda html, url: listing(0.6), min_listings=5)

        assert result.estimates == []
        assert [thin.key for thin in result.thin] == ["home-kitchen", "kettles"]
        assert "3 listings, 5 wanted" in result.thin[0].reason

    def test_counts_reviews_as_well_as_listings(self, tmp_path):
        labels = corpus(tmp_path, 6)

        result = fit(tmp_path, labels, lambda html, url: listing(0.6), min_reviews=10_000)

        assert result.estimates == []
        assert "600 reviews, 10000 wanted" in result.thin[0].reason

    def test_keeps_going_past_a_page_it_cannot_read(self, tmp_path):
        labels = corpus(tmp_path, 6)
        seen: list[str] = []

        def extract(html: str, url: str) -> FullExtraction:
            seen.append(url)
            if len(seen) == 1:
                raise ExtractorError("node is not on the path")
            return listing(0.6)

        result = fit(tmp_path, labels, extract)

        assert result.clean_listings == 5
        assert "node is not on the path" in result.skipped[0]

    def test_names_a_listing_that_states_no_category(self, tmp_path):
        labels = corpus(tmp_path, 6)

        result = fit(tmp_path, labels, lambda html, url: listing(0.6, category=None))

        assert result.estimates == []
        assert result.default is not None
        assert result.default.listing_count == 6
        assert "states no category" in result.skipped[0]


class TestPriorsDocument:
    existing = {
        "note": "a note anshuman wrote",
        "default": {"organicPrior": [0.2] * 5, "injectionKernel": [0, 0, 0, 0.35, 0.65]},
        "aliases": {"küche-haushalt-wohnen": "home-kitchen"},
        "categories": {},
    }

    def test_keeps_the_note_the_kernel_and_the_aliases(self, tmp_path):
        labels = corpus(tmp_path, 6)
        result = fit(tmp_path, labels, lambda html, url: listing(0.6))

        document = priors_document(result, self.existing, replace_default=False)

        assert document["note"] == self.existing["note"]
        assert document["aliases"] == self.existing["aliases"]
        assert document["default"] == self.existing["default"]
        assert document["categories"]["kettles"]["organicPrior"][4] == 0.6

    def test_replaces_the_fallback_shape_only_when_asked(self, tmp_path):
        labels = corpus(tmp_path, 6)
        result = fit(tmp_path, labels, lambda html, url: listing(0.6))

        document = priors_document(result, self.existing, replace_default=True)

        assert document["default"]["organicPrior"][4] == 0.6
        assert document["default"]["injectionKernel"] == [0, 0, 0, 0.35, 0.65]

    def test_names_an_alias_left_pointing_at_nothing(self):
        document = {"aliases": {"a": "b", "c": "d"}, "categories": {"d": {}}}

        assert dangling_aliases(document) == ["a points at b"]


class TestCli:
    def write_labels(self, tmp_path, labels):
        path = tmp_path / "labels.jsonl"
        path.write_text(
            "\n".join(json.dumps({"fixture": one.fixture, "label": one.label}) for one in labels),
            encoding="utf-8",
        )
        return str(path)

    def test_prints_the_document_and_writes_nothing_by_default(self, tmp_path, capsys):
        labels = corpus(tmp_path, 6)
        before = PRIORS_PATH.read_text(encoding="utf-8")

        code = main(
            [
                self.write_labels(tmp_path, labels),
                "--fixtures",
                str(tmp_path),
                "--min-reviews",
                "100",
            ],
            extract=lambda html, url: listing(0.6),
        )

        assert code == 0
        printed = capsys.readouterr().out
        assert "clean listings read: 6" in printed
        assert "nothing written" in printed
        assert PRIORS_PATH.read_text(encoding="utf-8") == before

    def test_refuses_a_label_file_with_nothing_clean_in_it(self, tmp_path, capsys):
        labels = corpus(tmp_path, 3, label=1)

        code = main(
            [self.write_labels(tmp_path, labels), "--fixtures", str(tmp_path)],
            extract=lambda html, url: listing(0.6),
        )

        assert code == 1
        assert "labels nothing clean" in capsys.readouterr().err
