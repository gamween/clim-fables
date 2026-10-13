"""No-arbitrage band and arbitrage classification."""

import math

import numpy as np
import pytest

from clim_lab import arbclass
from clim_lab.data import SecondSeries
from clim_lab.robin import Swaps


def _swaps(eth, log_price, fee=700, block=None):
    n = len(eth)
    return Swaps(
        block=np.arange(n, dtype=np.int64) if block is None else np.asarray(block, dtype=np.int64),
        log_index=np.zeros(n, dtype=np.int64),
        eth=np.asarray(eth, dtype=np.float64),
        usd=-np.asarray(eth, dtype=np.float64) * 2500.0,
        log_price=np.asarray(log_price, dtype=np.float64),
        fee_pips=np.full(n, fee, dtype=np.int64),
    )


def test_band_is_minus_log_one_minus_fee():
    assert arbclass.band(np.array([700]))[0] == pytest.approx(-math.log(1 - 0.0007))


def test_classify_buy_when_venue_above_band_and_sell_when_below():
    p = math.log(2500.0)
    g = -math.log(1 - 0.0007)
    # swap 0 sets the price; swap 1 buys ETH (eth > 0) with the venue 2g above; swap 2 sells with venue 2g below;
    # swap 3 buys with the venue inside the band
    s = _swaps([1, 1, -1, 1], [p, p, p, p])
    venue_logp = np.array([p, p + 2 * g, p - 2 * g, p + 0.5 * g], dtype=np.float64)
    series = SecondSeries(99, venue_logp)  # second 99..102 -> venue at t - 1 for t = 100..103
    t = np.array([100, 101, 102, 103], dtype=np.int64)
    z, is_arb = arbclass.classify(s, t, series)
    assert math.isnan(z[0]) and not is_arb[0]
    assert list(is_arb[1:]) == [True, True, False]
    assert z[1] == pytest.approx(2 * g)


def test_buy_against_the_venue_is_not_arbitrage():
    p = math.log(2500.0)
    g = -math.log(1 - 0.0007)
    s = _swaps([1, 1], [p, p])
    series = SecondSeries(99, np.array([p, p - 2 * g]))
    _, is_arb = arbclass.classify(s, np.array([100, 101]), series)
    assert not is_arb[1]


def test_arb_events_counts_one_per_block_and_side():
    block = np.array([5, 5, 5, 6, 7], dtype=np.int64)
    side = np.array([1, 1, -1, 1, 1], dtype=np.int64)
    is_arb = np.array([True, True, True, False, True])
    first = arbclass.arb_events(block, side, is_arb)
    assert list(first) == [True, False, True, False, True]
