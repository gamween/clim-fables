"""clim's fee policy for Fables' pool, in float: fee = clamp(ceil(eta * sigma * sqrt(dt / 2) * 1e6), floor, cap).

Same rule as ClimFeeMath with k = 1, sigma per sqrt second, dt the effective arbitrage interval (dteff). Fables' hook
charges at least half its flat fee under an override and at most its cap; clim posts no lower than the flat fee.
"""

import math

import numpy as np


def policy_fee_pips(sigma, eta: float, dt_sec: float, floor_pips: int, cap_pips: int) -> np.ndarray:
    raw = np.ceil(eta * np.asarray(sigma, dtype=np.float64) * math.sqrt(dt_sec / 2.0) * 1e6)
    return np.clip(raw, floor_pips, cap_pips)


def calibrate_eta(sigma, dt_sec: float, floor_pips: int, cap_pips: int, target_mean_pips: float) -> float:
    """eta whose clamped fee averages target_mean_pips over the samples (equal average fee with Fables' keeper)."""
    if not floor_pips < target_mean_pips < cap_pips:
        raise ValueError("target mean must lie strictly between floor and cap")
    if not np.all(np.isfinite(sigma)):
        raise ValueError("sigma must be finite")
    if (
        policy_fee_pips(sigma, 1e6, dt_sec, floor_pips, cap_pips).mean() < target_mean_pips
        or policy_fee_pips(sigma, 1e-6, dt_sec, floor_pips, cap_pips).mean() > target_mean_pips
    ):
        raise ValueError("target mean unreachable for this sigma")
    lo, hi = 1e-6, 1e6
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if policy_fee_pips(sigma, mid, dt_sec, floor_pips, cap_pips).mean() < target_mean_pips:
            lo = mid
        else:
            hi = mid
    return math.sqrt(lo * hi)


def pstar_from_eta(eta: float, c: float = 1.0) -> float:
    """Probability of an arbitrage per interval in the model (MMR 2023): P* = 1 / (eta + c). Model-implied, not
    measured."""
    return 1.0 / (eta + c)


MULTI_VENUE_ESTIMATORS = ("median-close", "venue-range")
SINGLE_VENUE_ESTIMATOR = "binance-1s"


def choose_estimator(results: dict, tolerance_pts: float = 1.0) -> str:
    """The volatility estimator the live desk computes (plan 03 Task 1), from results[name] = {"arbVsKeeperPct",
    "corrKeeper": {"pearson"}} measured at equal average fee with Fables' keeper.

    1. Among the multi-venue estimators, the lower arbitrage loss; within tolerance_pts, the higher Pearson
       correlation with the keeper's fee.
    2. binance-1s (one exchange decides sigma) replaces it only if its loss is lower by more than tolerance_pts:
       clim's pitch is a baseline no single venue controls, so a single-venue estimator must earn its place.
    """
    a, b = MULTI_VENUE_ESTIMATORS
    ra, rb = results[a]["arbVsKeeperPct"], results[b]["arbVsKeeperPct"]
    if abs(ra - rb) < tolerance_pts:
        best = max(MULTI_VENUE_ESTIMATORS, key=lambda k: results[k]["corrKeeper"]["pearson"])
    else:
        best = a if ra < rb else b
    if results[SINGLE_VENUE_ESTIMATOR]["arbVsKeeperPct"] < results[best]["arbVsKeeperPct"] - tolerance_pts:
        return SINGLE_VENUE_ESTIMATOR
    return best
