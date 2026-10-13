"""Arbitrage classification on Fables' pool.

A swap is an arbitrage when, just before it, the venue price sits outside the pool's no-arbitrage band and the swap
moves the pool toward the venue: a buyer of ETH when the venue is above the pool price by more than the band, a seller
when it is below. The band's half-width is gamma = -ln(1 - fee) (MMR 2023), the fee being the one the swap paid.
The venue price is the USD price of the last closed second before the block's timestamp.
"""

import numpy as np

from .data import SecondSeries
from .robin import Swaps


def band(fee_pips) -> np.ndarray:
    return -np.log1p(-np.asarray(fee_pips, dtype=np.float64) / 1e6)


def classify(swaps: Swaps, t: np.ndarray, venue: SecondSeries) -> tuple[np.ndarray, np.ndarray]:
    """(z, is_arb): z = venue log price minus pool log price before each swap (NaN for the first swap)."""
    z = venue.at(np.asarray(t, dtype=np.int64) - 1) - swaps.log_price_before
    g = band(swaps.fee_pips)
    buy = ~swaps.zero_for_one
    with np.errstate(invalid="ignore"):
        is_arb = np.where(buy, z > g, z < -g) & ~np.isnan(z)
    return z, is_arb


def arb_events(block: np.ndarray, side: np.ndarray, is_arb: np.ndarray) -> np.ndarray:
    """True on the first arbitrage swap of each (block, side): an arbitrage split over several swaps in one block
    counts once."""
    block = np.asarray(block)
    side = np.asarray(side)
    is_arb = np.asarray(is_arb, dtype=bool)
    out = np.zeros(len(block), dtype=bool)
    seen: set[tuple[int, int]] = set()
    for i in np.flatnonzero(is_arb):
        k = (int(block[i]), int(side[i]))
        if k not in seen:
            seen.add(k)
            out[i] = True
    return out
