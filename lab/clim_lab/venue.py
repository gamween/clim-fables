"""Venue prices for the Fables studies: Binance ETHUSDT 1 s, converted to USD with Coinbase USDT-USD 1 min.

USDG is redeemable 1:1 for USD, so the pool's price is compared with ETH in USD, not in USDT: a 5 bp USDT premium
would otherwise read as a 5 bp mispricing.
"""

import json
from pathlib import Path

import numpy as np

from .data import MinuteSeries, SecondSeries, _forward_fill


def parse_binance_rows(lines) -> list[tuple[int, float]]:
    """data.binance.vision kline CSV lines -> (open time in unix seconds, close). Open time is in microseconds
    from 2025 on and in milliseconds before; both are accepted."""
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        cols = line.split(",")
        t = int(cols[0])
        t = t // 1_000_000 if t > 10**14 else t // 1_000
        out.append((t, float(cols[4])))
    return out


def load_b1s_days(days: list[str], data_dir: Path) -> SecondSeries:
    """Concatenate b1s_<day>.csv files ("unix_seconds,close") into one forward-filled 1 s series."""
    parts = [np.loadtxt(Path(data_dir) / f"b1s_{d}.csv", delimiter=",", dtype=np.float64, ndmin=2) for d in days]
    raw = np.vstack(parts)
    ts = raw[:, 0].astype(np.int64)
    order = np.argsort(ts, kind="stable")
    ts, px = ts[order], raw[order, 1]
    keep = np.concatenate(([True], np.diff(ts) > 0))
    t0, logp = _forward_fill(ts[keep], np.log(px[keep]), 1)
    return SecondSeries(t0, logp)


def save_minute_rows(path: Path, rows: list[tuple[int, float]]) -> None:
    """Write (open time s, close) rows as [[open_ms, close], ...] ascending (the format of data.load_1m_pairs_json)."""
    rows = sorted(set(rows))
    Path(path).write_text(json.dumps([[t * 1000, c] for t, c in rows]))


def usd_log_series(b1s: SecondSeries, usdt_usd: MinuteSeries) -> SecondSeries:
    """ln(ETH in USD) per second: ln(ETHUSDT) + ln(USDT in USD) of the last minute closed at or before that second."""
    t = np.arange(b1s.t0, b1s.t1 + 1, dtype=np.int64)
    idx = np.searchsorted(usdt_usd.close_t, t, side="right") - 1
    if idx[0] < 0:
        raise ValueError("no USDT-USD minute closed before the first second")
    return SecondSeries(b1s.t0, b1s.logp + usdt_usd.logp[idx])


def rv_window(series: SecondSeries, t_obs: np.ndarray, window_sec: int, step_sec: int = 5) -> np.ndarray:
    """Realized volatility per sqrt second over the window_sec seconds before each t_obs, from step_sec returns
    (5 s returns damp the bid-ask bounce of 1 s closes)."""
    if window_sec % step_sec:
        raise ValueError("window must be a multiple of the step")
    t_obs = np.asarray(t_obs, dtype=np.int64)
    offsets = step_sec * np.arange(window_sec // step_sec, -1, -1, dtype=np.int64)
    first = t_obs.min() - 1 - offsets[0] - series.t0
    last = t_obs.max() - 1 - series.t0
    if first < 0 or last >= len(series.logp):
        raise ValueError("not enough history for the window")
    out = np.empty(len(t_obs))
    for a in range(0, len(t_obs), 20_000):  # chunks keep the index matrix small on five weeks of reports
        idx = (t_obs[a : a + 20_000, None] - 1 - offsets[None, :]) - series.t0
        r = np.diff(series.logp[idx], axis=1)
        out[a : a + 20_000] = np.sqrt((r * r).sum(axis=1) / window_sec)
    return out
