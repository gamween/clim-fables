"""Per-direction toxicity on Fables' pool.

signal_bp: side * (venue - pool) in bp, positive when the swap goes the way the venue says the pool is mispriced.
markout_bp: side * (venue h seconds later - execution price) in bp, the trader's edge after the fee it paid, which is
the LP's loss on that trade. Notional-weighted tables per signal bucket show whether a positive signal predicts flow
that beats the fee.
"""

import numpy as np

HORIZONS_SEC = (5, 30, 300)
EDGES_BP = (-np.inf, -10.0, -5.0, -2.0, 0.0, 2.0, 5.0, 10.0, np.inf)


def signal_bp(side, venue_log, pool_log) -> np.ndarray:
    return np.asarray(side) * (np.asarray(venue_log) - np.asarray(pool_log)) * 1e4


def markout_bp(side, venue_future_log, exec_log) -> np.ndarray:
    return np.asarray(side) * (np.asarray(venue_future_log) - np.asarray(exec_log)) * 1e4


def pool_price_at(t_query, t_swap, log_price_after) -> np.ndarray:
    """Pool log price at each query second: the last swap in an earlier second (NaN before the first swap)."""
    idx = np.searchsorted(np.asarray(t_swap), np.asarray(t_query), side="left") - 1
    out = np.asarray(log_price_after, dtype=np.float64)[np.clip(idx, 0, None)].copy()
    out[idx < 0] = np.nan
    return out


def bucket_table(signal, markouts: dict, weight, edges=EDGES_BP) -> list[dict]:
    signal = np.asarray(signal)
    weight = np.asarray(weight, dtype=np.float64)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (signal >= lo) & (signal < hi)
        w = weight[m]
        row = {
            "loBp": None if np.isinf(lo) else float(lo),
            "hiBp": None if np.isinf(hi) else float(hi),
            "n": int(m.sum()),
            "notionalUsd": float(w.sum()),
            "markoutBp": {},
        }
        for h, mk in markouts.items():
            row["markoutBp"][str(h)] = float(np.average(np.asarray(mk)[m], weights=w)) if w.sum() > 0 else None
        rows.append(row)
    return rows


def slope_through_origin(d, e, w) -> float:
    """Weighted least squares e = a * d over d > 0: a = sum(w d e) / sum(w d^2)."""
    d = np.asarray(d, dtype=np.float64)
    e = np.asarray(e, dtype=np.float64)
    w = np.asarray(w, dtype=np.float64)
    m = d > 0
    den = float((w[m] * d[m] * d[m]).sum())
    return float((w[m] * d[m] * e[m]).sum() / den) if den > 0 else 0.0
