import math
from dataclasses import dataclass


@dataclass
class RatingDeconvolutionResult:
    injected_share: float
    residual_error: float


def rating_deconvolution(
    observed: list[float],
    organic_prior: list[float],
    injection_kernel: list[float],
) -> RatingDeconvolutionResult:
    if len(observed) != 5 or len(organic_prior) != 5 or len(injection_kernel) != 5:
        raise ValueError("rating deconvolution expects five bin histograms")

    diff = [k - p for k, p in zip(injection_kernel, organic_prior, strict=True)]
    residual_from_prior = [o - p for o, p in zip(observed, organic_prior, strict=True)]

    numerator = sum(d * r for d, r in zip(diff, residual_from_prior, strict=True))
    denominator = sum(d * d for d in diff)

    raw_a = 0.0 if denominator == 0 else numerator / denominator
    injected_share = min(1.0, max(0.0, raw_a))

    modeled = [p + injected_share * d for p, d in zip(organic_prior, diff, strict=True)]
    squared_errors = [(o - m) ** 2 for o, m in zip(observed, modeled, strict=True)]
    residual_error = math.sqrt(sum(squared_errors) / len(squared_errors))

    return RatingDeconvolutionResult(injected_share=injected_share, residual_error=residual_error)
