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
    lo, hi = 1e-6, 1e6
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if policy_fee_pips(sigma, mid, dt_sec, floor_pips, cap_pips).mean() < target_mean_pips:
            lo = mid
        else:
            hi = mid
    return math.sqrt(lo * hi)


def pstar_from_eta(eta: float, c: float = 1.0) -> float:
    """Predicted share of arbitrage opportunities taken: P* = 1 / (eta + c)."""
    return 1.0 / (eta + c)
