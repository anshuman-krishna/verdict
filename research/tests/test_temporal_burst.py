import pytest

from verdict_research.features.temporal_burst import (
    Burst,
    detect_temporal_bursts,
    poisson_quantile,
)


def test_poisson_quantile_is_zero_for_lambda_zero():
    assert poisson_quantile(0, 0.99) == 0


def test_poisson_quantile_matches_known_values():
    assert poisson_quantile(1, 0.99) == 4
    assert poisson_quantile(2, 0.99) == 6
    assert poisson_quantile(5, 0.99) == 11
    assert poisson_quantile(10, 0.99) == 18


def test_flags_a_single_three_day_spike_as_one_burst():
    daily = [2] * 30 + [50, 50, 50] + [2] * 7
    result = detect_temporal_bursts(daily)
    assert result.bursts == [Burst(start_day=30, end_day=32, review_count=150)]
    assert result.burst_count == 1
    assert result.burst_fraction == pytest.approx(0.6696428571428571, abs=1e-10)
    assert result.largest_burst_share == pytest.approx(0.6696428571428571, abs=1e-10)


def test_reports_two_separate_bursts_when_baseline_returns_between_them():
    daily = [3] * 30 + [40] + [3] * 10 + [60, 60] + [3] * 10
    result = detect_temporal_bursts(daily)
    assert result.bursts == [
        Burst(start_day=30, end_day=30, review_count=40),
        Burst(start_day=41, end_day=42, review_count=120),
    ]
    assert result.burst_count == 2
    assert result.burst_fraction == pytest.approx(0.5161290322580645, abs=1e-10)
    assert result.largest_burst_share == pytest.approx(0.3870967741935484, abs=1e-10)


def test_flags_nothing_for_a_flat_series():
    result = detect_temporal_bursts([5] * 40)
    assert result.burst_count == 0
    assert result.burst_fraction == 0


def test_flags_nothing_and_stays_safe_for_an_all_zero_series():
    result = detect_temporal_bursts([0] * 10)
    assert result.bursts == []
    assert result.burst_fraction == 0
    assert result.burst_count == 0
    assert result.largest_burst_share == 0


def test_never_flags_day_zero():
    result = detect_temporal_bursts([1000])
    assert result.burst_count == 0
