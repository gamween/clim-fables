"""Arbitrage rate model, Δt inversion and venue-exit-to-arbitrage delays."""

import math

import numpy as np
import pytest

from clim_lab import dteff
from clim_lab.data import SecondSeries


def test_arb_rate_matches_the_formula():
    dt, g, s = 2.0, 0.0007, 0.0006
    eta = g / (s * math.sqrt(dt / 2))
    assert dteff.arb_rate(dt, g, s, c=1.0) == pytest.approx(1 / (dt * (eta + 1.0)))
    assert dteff.arb_rate(dt, g, s, c=0.824) == pytest.approx(1 / (dt * (eta + 0.824)))


def test_arb_rate_falls_with_dt():
    rates = [dteff.arb_rate(dt, 0.0007, 0.0006) for dt in (0.1, 1, 10, 100)]
    assert all(a > b for a, b in zip(rates, rates[1:]))


@pytest.mark.parametrize("dt", [0.05, 0.7, 3.0, 45.0])
@pytest.mark.parametrize("c", [1.0, 0.824])
def test_solve_dt_inverts_arb_rate(dt, c):
    g, s = 0.0009, 0.0004
    assert dteff.solve_dt(dteff.arb_rate(dt, g, s, c), g, s, c) == pytest.approx(dt, rel=1e-6)


def test_solve_dt_rejects_out_of_model_rates():
    with pytest.raises(ValueError):
        dteff.solve_dt(0.0, 0.0007, 0.0006)
    with pytest.raises(ValueError):
        dteff.solve_dt(1e9, 0.0007, 0.0006)


def test_delays_from_the_last_second_inside_the_band():
    # pool at 0 with band 1; venue inside at seconds 10..12, outside from 13; arbitrage at t = 16
    logp = np.array([0.0] * 13 + [2.0] * 7)
    v = SecondSeries(0, logp)
    d = dteff.delays(np.array([16]), np.array([10]), np.array([0.0]), np.array([1.0]), v)
    assert list(d) == [16 - 13]


def test_delay_counts_from_the_previous_swap_when_never_inside():
    v = SecondSeries(0, np.full(30, 5.0))
    d = dteff.delays(np.array([20]), np.array([12]), np.array([0.0]), np.array([1.0]), v)
    assert list(d) == [8]


def test_delay_is_zero_in_the_same_second():
    v = SecondSeries(0, np.zeros(10))
    d = dteff.delays(np.array([5]), np.array([5]), np.array([0.0]), np.array([1.0]), v)
    assert list(d) == [0]
