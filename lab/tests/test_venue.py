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


def test_usd_log_series_rejects_a_usdt_series_ending_early():
    b1s = SecondSeries(120, np.zeros(300))  # seconds 120..419
    usdt = MinuteSeries(np.array([120, 180], dtype=np.int64), np.zeros(2))
    with pytest.raises(ValueError):
        venue.usd_log_series(b1s, usdt)


def test_rv_window_matches_hand_computation():
    # price doubles its log every 5 s by 0.001: 5-second returns are all 0.001
    t0 = 1_000
    logp = 0.001 * (np.arange(400) // 5)
    s = SecondSeries(t0, logp.astype(np.float64))
    rv = venue.rv_window(s, np.array([t0 + 305]), window_sec=300, step_sec=5)
    assert rv[0] == pytest.approx(math.sqrt(60 * 0.001**2 / 300))


def test_rv_window_needs_an_observation_time():
    s = SecondSeries(1_000, np.zeros(400))
    with pytest.raises(ValueError):
        venue.rv_window(s, np.array([], dtype=np.int64), window_sec=300, step_sec=5)


def test_rv_window_needs_history():
    s = SecondSeries(1_000, np.zeros(100))
    with pytest.raises(ValueError):
        venue.rv_window(s, np.array([1_050]), window_sec=300, step_sec=5)


def test_save_usdtusd_rows_sorted_ms(tmp_path):
    p = tmp_path / "u.json"
    venue.save_minute_rows(p, [(180, 1.0), (120, 0.999)])
    assert json.loads(p.read_text()) == [[120_000, 0.999], [180_000, 1.0]]


# --- desk-feasible estimators (plan 03 Task 1) ---


def _ramp_venue(t0, n, scale=1.0, half_range=0.001):
    """Closes 2000 * exp(0.001 i), high/low at +-half_range in log around the close."""
    rows = []
    for i in range(n):
        c = 2000.0 * math.exp(0.001 * i) * scale
        rows.append([t0 + 60 * i, c, c * math.exp(half_range), c * math.exp(-half_range), c])
    return venue.ohlc_from_rows(rows)


def test_ohlc_from_rows_fills_empty_minutes_with_the_previous_close():
    v = venue.ohlc_from_rows([[0, 10, 11, 9, 10], [120, 12, 13, 11, 12]])
    assert list(v.open_t) == [0, 60, 120]
    assert list(v.close) == [10, 10, 12]
    assert list(v.high) == [11, 10, 13]
    assert list(v.low) == [9, 10, 11]


def test_ohlc_from_rows_converts_a_usdt_venue_with_the_last_closed_rate():
    usdt = MinuteSeries(np.array([60, 120], dtype=np.int64), np.log(np.array([0.5, 0.25])))
    v = venue.ohlc_from_rows([[0, 10, 12, 8, 10], [60, 10, 12, 8, 10]], usd_per_quote=usdt)
    assert list(v.close) == pytest.approx([5.0, 2.5])
    assert list(v.high) == pytest.approx([6.0, 3.0])


def test_ohlc_from_rows_rejects_bad_input():
    with pytest.raises(ValueError):
        venue.ohlc_from_rows([])
    with pytest.raises(ValueError):
        venue.ohlc_from_rows([[30, 1, 1, 1, 1]])


def test_ohlc_from_trades_builds_minutes_in_order():
    rows = venue.ohlc_from_trades([(0.5, 10.0), (30.0, 12.0), (59.9, 11.0), (61.0, 9.0)])
    assert rows == [[0, 10.0, 12.0, 10.0, 11.0], [60, 9.0, 9.0, 9.0, 9.0]]
    with pytest.raises(ValueError):
        venue.ohlc_from_trades([(61.0, 9.0), (0.5, 10.0)])


def test_median_close_rv_matches_hand_computation():
    t0 = 60_000
    venues = [_ramp_venue(t0, 30), _ramp_venue(t0, 30, 1.0002), _ramp_venue(t0, 30, 0.9999)]
    t_obs = np.array([t0 + 60 * 20 + 10])
    rv5 = venue.median_close_rv(venues, t_obs, 300)
    rv15 = venue.median_close_rv(venues, t_obs, 900)
    assert rv5[0] == pytest.approx(math.sqrt(5 * 0.001**2 / 300))
    assert rv15[0] == pytest.approx(math.sqrt(15 * 0.001**2 / 900))


def test_range_rv_is_the_median_of_each_venue_parkinson_volatility():
    t0 = 60_000
    venues = [_ramp_venue(t0, 30, half_range=h) for h in (0.001, 0.002, 0.003)]
    rv = venue.range_rv(venues, np.array([t0 + 60 * 20 + 10]), 300)
    # median venue: ln(H/L) = 0.004 on every candle
    assert rv[0] == pytest.approx(math.sqrt(0.004**2 / (4 * math.log(2)) / 60))


def test_desk_estimators_use_only_closed_minutes():
    t0 = 60_000
    venues = [_ramp_venue(t0, 30) for _ in range(3)]
    # at t0 + 1,200 exactly, minute [t0 + 1,140, t0 + 1,200) has just closed; one second earlier it has not
    a = venue.median_close_rv(venues, np.array([t0 + 1_200]), 300)
    b = venue.median_close_rv(venues, np.array([t0 + 1_199]), 300)
    assert a[0] == pytest.approx(b[0])  # constant returns: same value, but from windows one minute apart
    with pytest.raises(ValueError):
        venue.median_close_rv(venues, np.array([t0 + 200]), 900)


def test_desk_estimators_reject_partial_minutes():
    v = _ramp_venue(60_000, 30)
    with pytest.raises(ValueError):
        venue.median_close_rv([v], np.array([61_500]), 90)
