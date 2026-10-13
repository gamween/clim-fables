"""Binance 1 s day files, USDT to USD, short-window realized volatility."""

import json
import math

import numpy as np
import pytest

from clim_lab import venue
from clim_lab.data import MinuteSeries, SecondSeries


def test_parse_binance_rows_microseconds_and_milliseconds():
    rows = [
        "1757203200000000,2500,2501,2499,2500.5,1,0,0,0,0,0,0",
        "1757203201000,2500,2501,2499,2501.0,1,0,0,0,0,0,0",
    ]
    out = venue.parse_binance_rows(rows)
    assert out == [(1757203200, 2500.5), (1757203201, 2501.0)]


def test_load_b1s_days_concatenates_and_fills(tmp_path):
    (tmp_path / "b1s_2026-09-07.csv").write_text("100,10\n101,11\n")
    (tmp_path / "b1s_2026-09-08.csv").write_text("103,13\n")
    s = venue.load_b1s_days(["2026-09-07", "2026-09-08"], tmp_path)
    assert s.t0 == 100
    assert list(np.round(np.exp(s.logp), 6)) == [10, 11, 11, 13]


def test_usd_log_series_adds_last_closed_minute_rate():
    b1s = SecondSeries(120, np.log(np.full(120, 2500.0)))
    usdt = MinuteSeries(np.array([120, 180], dtype=np.int64), np.log(np.array([1.001, 0.999])))
    s = venue.usd_log_series(b1s, usdt)
    assert math.exp(s.at(120)) == pytest.approx(2500 * 1.001)
    assert math.exp(s.at(179)) == pytest.approx(2500 * 1.001)
    assert math.exp(s.at(180)) == pytest.approx(2500 * 0.999)


def test_usd_log_series_needs_a_rate_before_the_first_second():
    b1s = SecondSeries(100, np.zeros(10))
    usdt = MinuteSeries(np.array([120], dtype=np.int64), np.zeros(1))
    with pytest.raises(ValueError):
        venue.usd_log_series(b1s, usdt)


def test_rv_window_matches_hand_computation():
    # price doubles its log every 5 s by 0.001: 5-second returns are all 0.001
    t0 = 1_000
    logp = 0.001 * (np.arange(400) // 5)
    s = SecondSeries(t0, logp.astype(np.float64))
    rv = venue.rv_window(s, np.array([t0 + 305]), window_sec=300, step_sec=5)
    assert rv[0] == pytest.approx(math.sqrt(60 * 0.001**2 / 300))


def test_rv_window_needs_history():
    s = SecondSeries(1_000, np.zeros(100))
    with pytest.raises(ValueError):
        venue.rv_window(s, np.array([1_050]), window_sec=300, step_sec=5)


def test_save_usdtusd_rows_sorted_ms(tmp_path):
    p = tmp_path / "u.json"
    venue.save_minute_rows(p, [(180, 1.0), (120, 0.999)])
    assert json.loads(p.read_text()) == [[120_000, 0.999], [180_000, 1.0]]
