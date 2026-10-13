"""Direction signal, markouts, bucket tables and the weighted slope fit."""

import numpy as np
import pytest

from clim_lab import markout


def test_signal_is_positive_when_trading_toward_the_venue():
    side = np.array([1, -1, 1])
    v = np.array([0.001, -0.001, -0.001])
    p = np.zeros(3)
    assert list(markout.signal_bp(side, v, p)) == pytest.approx([10.0, 10.0, -10.0])


def test_markout_is_the_traders_edge_after_fee():
    # bought at exec 0, venue later at +0.0005: trader edge +5 bp; sold at exec 0, venue later +0.0005: -5 bp
    side = np.array([1, -1])
    assert list(markout.markout_bp(side, np.array([0.0005, 0.0005]), np.zeros(2))) == pytest.approx([5.0, -5.0])


def test_pool_price_at_takes_the_last_swap_strictly_before():
    t_swap = np.array([10, 20, 20, 30])
    lp = np.array([1.0, 2.0, 3.0, 4.0])
    out = markout.pool_price_at(np.array([20, 21, 31]), t_swap, lp)
    assert list(out) == [1.0, 3.0, 4.0]


def test_bucket_table_weights_by_notional():
    signal = np.array([-12.0, 3.0, 3.0, 20.0])
    mk = {30: np.array([1.0, 2.0, 4.0, 9.0])}
    w = np.array([1.0, 1.0, 3.0, 1.0])
    rows = markout.bucket_table(signal, mk, w, edges=(-np.inf, 0, 5, np.inf))
    assert [r["n"] for r in rows] == [1, 2, 1]
    assert rows[1]["markoutBp"]["30"] == pytest.approx((2 * 1 + 4 * 3) / 4)
    assert rows[1]["notionalUsd"] == pytest.approx(4.0)


def test_slope_through_origin_on_positive_signal_only():
    d = np.array([-5.0, 2.0, 4.0])
    e = np.array([100.0, 1.0, 2.0])
    w = np.ones(3)
    assert markout.slope_through_origin(d, e, w) == pytest.approx(0.5)
