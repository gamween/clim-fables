"""clim's fee policy for Fables: fee from sigma with Fables' floor and cap, eta at equal average fee."""

import math

import numpy as np
import pytest

from clim_lab import policy


def test_policy_fee_clamps_to_floor_and_cap():
    sigma = np.array([1e-9, 1e-4, 1.0])
    f = policy.policy_fee_pips(sigma, eta=2.0, dt_sec=1.0, floor_pips=700, cap_pips=6000)
    assert f[0] == 700 and f[2] == 6000
    raw = 2.0 * 1e-4 * math.sqrt(0.5) * 1e6
    assert f[1] == pytest.approx(max(700, min(6000, math.ceil(raw))))


def test_calibrate_eta_hits_the_target_mean():
    rng = np.random.default_rng(1)
    sigma = np.abs(rng.normal(3e-4, 1e-4, 5_000)) + 1e-5
    eta = policy.calibrate_eta(sigma, dt_sec=1.0, floor_pips=700, cap_pips=6000, target_mean_pips=1_480)
    f = policy.policy_fee_pips(sigma, eta, 1.0, 700, 6000)
    assert f.mean() == pytest.approx(1_480, rel=2e-3)


def test_calibrate_eta_rejects_unreachable_targets():
    sigma = np.full(10, 1e-4)
    with pytest.raises(ValueError):
        policy.calibrate_eta(sigma, 1.0, 700, 6000, target_mean_pips=600)
    with pytest.raises(ValueError):
        policy.calibrate_eta(sigma, 1.0, 700, 6000, target_mean_pips=7000)


def test_calibrate_eta_rejects_non_finite_sigma():
    with pytest.raises(ValueError):
        policy.calibrate_eta(np.array([1e-4, np.nan]), 1.0, 700, 6000, target_mean_pips=1_480)


def test_calibrate_eta_rejects_targets_the_sigma_cannot_reach():
    # sigma = 0: every fee sits at the floor whatever eta is
    with pytest.raises(ValueError):
        policy.calibrate_eta(np.zeros(10), 1.0, 700, 6000, target_mean_pips=1_480)


def test_pstar_from_eta():
    assert policy.pstar_from_eta(1.0, c=1.0) == pytest.approx(0.5)


def _est(arb, pearson):
    return {"arbVsKeeperPct": arb, "corrKeeper": {"pearson": pearson}}


def test_choose_estimator_prefers_the_better_multi_venue_estimator():
    r = {"median-close": _est(-1.0, 0.70), "venue-range": _est(-3.0, 0.60), "binance-1s": _est(-3.5, 0.83)}
    assert policy.choose_estimator(r) == "venue-range"


def test_choose_estimator_breaks_close_calls_on_correlation():
    r = {"median-close": _est(-2.6, 0.75), "venue-range": _est(-3.0, 0.60), "binance-1s": _est(-3.5, 0.83)}
    assert policy.choose_estimator(r) == "median-close"


def test_choose_estimator_takes_binance_1s_only_when_it_wins_by_more_than_a_point():
    r = {"median-close": _est(2.0, 0.70), "venue-range": _est(1.5, 0.60), "binance-1s": _est(-4.4, 0.83)}
    assert policy.choose_estimator(r) == "binance-1s"
    r["binance-1s"] = _est(1.2, 0.83)  # beats median-close (the multi-venue pick, by correlation) by 0.8 point only
    assert policy.choose_estimator(r) == "median-close"
