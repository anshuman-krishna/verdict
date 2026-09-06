from verdict_research.canary.check import (
    CanaryResult,
    CanaryTarget,
    ExtractionOutcome,
    run_canary,
    summarize,
)

COM_TARGET = CanaryTarget(
    site="amazon",
    locale="com",
    url="https://www.amazon.com/dp/B0EXAMPLE1",
    minimum_expected_reviews=20,
)
FR_TARGET = CanaryTarget(
    site="amazon",
    locale="fr",
    url="https://www.amazon.fr/dp/B0EXAMPLE2",
    minimum_expected_reviews=20,
)


class TestRunCanary:
    def test_classifies_a_healthy_extraction(self):
        results = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=42, rules_version=3),
            now=lambda: 1000.0,
        )
        assert results == [
            CanaryResult(
                site="amazon",
                locale="com",
                url=COM_TARGET.url,
                checked_at=1000.0,
                status="healthy",
                review_count=42,
                rules_version=3,
            )
        ]

    def test_classifies_below_the_targets_floor_as_degraded(self):
        results = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=5, rules_version=3),
            now=lambda: 1000.0,
        )
        assert results[0].status == "degraded"

    def test_classifies_zero_reviews_as_failed_even_though_it_is_above_no_floor(self):
        results = run_canary(
            [CanaryTarget(site="amazon", locale="com", url="x", minimum_expected_reviews=0)],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=0, rules_version=3),
            now=lambda: 1000.0,
        )
        assert results[0].status == "failed"

    def test_a_fetch_error_becomes_a_failed_result_with_no_reviews_or_version(self):
        def fetch_html(url: str) -> str:
            raise TimeoutError("no response")

        results = run_canary(
            [COM_TARGET],
            fetch_html=fetch_html,
            extract=lambda html, url: ExtractionOutcome(review_count=42, rules_version=3),
            now=lambda: 1000.0,
        )
        assert results[0].status == "failed"
        assert results[0].review_count is None
        assert results[0].rules_version is None
        assert results[0].error == "no response"

    def test_one_failing_target_does_not_stop_the_others_from_running(self):
        def extract(html: str, url: str) -> ExtractionOutcome:
            if "B0EXAMPLE1" in url:
                raise ValueError("selector changed")
            return ExtractionOutcome(review_count=30, rules_version=3)

        results = run_canary(
            [COM_TARGET, FR_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=extract,
            now=lambda: 1000.0,
        )
        assert [r.status for r in results] == ["failed", "healthy"]


class TestSummarize:
    def test_reduces_a_run_history_to_one_row_per_site_and_locale(self):
        results = run_canary(
            [COM_TARGET, FR_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=40, rules_version=3),
            now=lambda: 1000.0,
        )
        summaries = summarize(results)
        assert [(s.site, s.locale) for s in summaries] == [("amazon", "com"), ("amazon", "fr")]

    def test_hand_computed_median_across_repeated_checks_of_the_same_target(self):
        first = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=10, rules_version=3),
            now=lambda: 1000.0,
        )
        second = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=50, rules_version=3),
            now=lambda: 2000.0,
        )
        third = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=30, rules_version=4),
            now=lambda: 3000.0,
        )
        summaries = summarize(first + second + third)
        assert len(summaries) == 1
        assert summaries[0].median_reviews_extracted == 30
        # the most recent check wins for last verified, status, and version
        assert summaries[0].last_verified == 3000.0
        assert summaries[0].rules_version == 4

    def test_a_failed_check_is_excluded_from_the_median_but_still_sets_last_verified(self):
        healthy = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=lambda html, url: ExtractionOutcome(review_count=40, rules_version=3),
            now=lambda: 1000.0,
        )

        def failing_extract(html: str, url: str) -> ExtractionOutcome:
            raise ValueError("broke")

        failed = run_canary(
            [COM_TARGET],
            fetch_html=lambda url: "<html></html>",
            extract=failing_extract,
            now=lambda: 2000.0,
        )
        summaries = summarize(healthy + failed)
        assert summaries[0].median_reviews_extracted == 40
        assert summaries[0].status == "failed"
        assert summaries[0].last_verified == 2000.0
