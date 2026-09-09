from verdict_research.features.priors import (
    PLACEHOLDER_INJECTION_KERNEL,
    PLACEHOLDER_ORGANIC_PRIOR,
    placeholder_priors,
    priors_digest,
)


def test_both_are_five_bin_histograms_that_sum_to_one():
    assert len(PLACEHOLDER_ORGANIC_PRIOR) == 5
    assert len(PLACEHOLDER_INJECTION_KERNEL) == 5
    assert abs(sum(PLACEHOLDER_ORGANIC_PRIOR) - 1) < 1e-9
    assert abs(sum(PLACEHOLDER_INJECTION_KERNEL) - 1) < 1e-9


def test_concentrates_the_injection_kernel_on_four_and_five_stars():
    assert PLACEHOLDER_INJECTION_KERNEL[:3] == [0.0, 0.0, 0.0]
    assert PLACEHOLDER_INJECTION_KERNEL[4] > PLACEHOLDER_INJECTION_KERNEL[3]


def test_carries_the_product_text_the_drift_signal_needs():
    assert placeholder_priors("a knife set kitchen").product_text == "a knife set kitchen"


def test_the_digest_changes_when_the_priors_do():
    base = placeholder_priors()
    changed = placeholder_priors()
    changed.injection_kernel = [0, 0, 0.1, 0.3, 0.6]
    assert priors_digest(base) != priors_digest(changed)


def test_the_digest_is_stable_across_calls():
    assert priors_digest(placeholder_priors()) == priors_digest(placeholder_priors("anything"))
