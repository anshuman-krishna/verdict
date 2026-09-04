import pytest

from verdict_research.features.rating_deconvolution import rating_deconvolution

ORGANIC_PRIOR = [0.1, 0.1, 0.2, 0.3, 0.3]
INJECTION_KERNEL = [0.0, 0.0, 0.0, 0.3, 0.7]


def test_fits_zero_share_when_observed_matches_organic_prior():
    result = rating_deconvolution(ORGANIC_PRIOR, ORGANIC_PRIOR, INJECTION_KERNEL)
    assert result.injected_share == pytest.approx(0, abs=1e-10)
    assert result.residual_error == pytest.approx(0, abs=1e-10)


def test_fits_full_share_when_observed_matches_injection_kernel():
    result = rating_deconvolution(INJECTION_KERNEL, ORGANIC_PRIOR, INJECTION_KERNEL)
    assert result.injected_share == pytest.approx(1, abs=1e-10)
    assert result.residual_error == pytest.approx(0, abs=1e-10)


def test_fits_half_share_for_an_exact_midpoint_mixture():
    midpoint = [(p + k) / 2 for p, k in zip(ORGANIC_PRIOR, INJECTION_KERNEL, strict=True)]
    result = rating_deconvolution(midpoint, ORGANIC_PRIOR, INJECTION_KERNEL)
    assert result.injected_share == pytest.approx(0.5, abs=1e-10)
    assert result.residual_error == pytest.approx(0, abs=1e-10)


def test_clamps_share_to_one_and_reports_leftover_residual():
    beyond = [k + (k - p) for k, p in zip(INJECTION_KERNEL, ORGANIC_PRIOR, strict=True)]
    result = rating_deconvolution(beyond, ORGANIC_PRIOR, INJECTION_KERNEL)
    assert result.injected_share == 1
    assert result.residual_error == pytest.approx(0.20976176963403026, abs=1e-10)


def test_fits_a_non_trivial_share_with_residual_for_a_noisy_histogram():
    observed = [0.05, 0.08, 0.12, 0.35, 0.4]
    result = rating_deconvolution(observed, ORGANIC_PRIOR, INJECTION_KERNEL)
    assert result.injected_share == pytest.approx(0.2863636363636365, abs=1e-10)
    assert result.residual_error == pytest.approx(0.027419303087755188, abs=1e-10)


def test_raises_on_a_histogram_that_is_not_five_bins():
    with pytest.raises(ValueError):
        rating_deconvolution([1, 2, 3], ORGANIC_PRIOR, INJECTION_KERNEL)
