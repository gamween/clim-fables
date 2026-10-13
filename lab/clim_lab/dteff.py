"""Effective arbitrage interval on a sub-second chain.

On Robinhood Chain blocks come every ~0.1 s, but arbitrageurs do not act every block: what sets LP losses is how often
they actually trade. The model's block time Δt is replaced by an effective interval, estimated two ways:

1. Frequency inversion: arbitrage events per second = P_trade / Δt with P_trade = 1 / (eta + c),
   eta = gamma / (sigma sqrt(Δt / 2)); c = 1 (Poisson blocks, MMR 2023) or 0.824 (fixed blocks, Nezlobin-Tassy 2025).
   The rate falls as Δt grows, so the observed rate gives one Δt.
2. Delays: seconds from the venue price leaving the pool's band to the arbitrage landing. Their mean is Δt for
   Poisson arrivals and Δt / 2 for fixed ones.
"""

import math

import numpy as np

from .data import SecondSeries

DT_MIN = 1e-3
DT_MAX = 1e5


def arb_rate(dt: float, gamma: float, sigma: float, c: float = 1.0) -> float:
    eta = gamma / (sigma * math.sqrt(dt / 2.0))
    return 1.0 / (dt * (eta + c))


def solve_dt(rate: float, gamma: float, sigma: float, c: float = 1.0) -> float:
    """The Δt (seconds) whose predicted arbitrage rate equals `rate` (events per second)."""
    if not rate > 0:
        raise ValueError("rate must be positive")
    if not (math.isfinite(rate) and math.isfinite(gamma) and math.isfinite(sigma)) or gamma < 0 or sigma <= 0:
        raise ValueError("rate, gamma and sigma must be finite, with gamma >= 0 and sigma > 0")
    if rate > arb_rate(DT_MIN, gamma, sigma, c) or rate < arb_rate(DT_MAX, gamma, sigma, c):
        raise ValueError("rate outside what the model can produce on [1 ms, 1e5 s]")
    lo, hi = math.log(DT_MIN), math.log(DT_MAX)
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if arb_rate(math.exp(mid), gamma, sigma, c) > rate:
            lo = mid
        else:
            hi = mid
    return math.exp(0.5 * (lo + hi))


def delays(
    t_arb: np.ndarray, t_prev: np.ndarray, p_pre: np.ndarray, gamma: np.ndarray, venue: SecondSeries, cap_sec: int = 3_600
) -> np.ndarray:
    """Seconds between the venue leaving the band [p_pre - gamma, p_pre + gamma] and each arbitrage.

    The pool price p_pre holds from the previous swap's second t_prev to the arbitrage's second t_arb. The exit is the
    second after the last second in [t_prev, t_arb) when the venue was inside the band; if it never was, the venue was
    already outside when the pool last moved and the delay counts from t_prev. Gaps longer than cap_sec are cut.
    """
    out = np.zeros(len(t_arb), dtype=np.int64)
    for i in range(len(t_arb)):
        b = int(t_arb[i])
        a = max(int(t_prev[i]), b - cap_sec)
        if b <= a:
            continue
        if a < venue.t0 or b - 1 > venue.t1:
            raise ValueError("the window reads outside the venue series")
        m = venue.logp[a - venue.t0 : b - venue.t0]
        inside = np.flatnonzero(np.abs(m - p_pre[i]) <= gamma[i])
        cross = a + int(inside[-1]) + 1 if len(inside) else a
        out[i] = b - cross
    return out
