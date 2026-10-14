"""Venue prices for the Fables studies: Binance ETHUSDT 1 s, converted to USD with Coinbase USDT-USD 1 min.

USDG is redeemable 1:1 for USD, so the pool's price is compared with ETH in USD, not in USDT: a 5 bp USDT premium
would otherwise read as a 5 bp mispricing.
"""

import json
import math
from dataclasses import dataclass
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
    if usdt_usd.close_t[-1] < b1s.t1 - 60:
        raise ValueError("the USDT-USD series ends before the ETHUSDT series")
    return SecondSeries(b1s.t0, b1s.logp + usdt_usd.logp[idx])


def rv_window(series: SecondSeries, t_obs: np.ndarray, window_sec: int, step_sec: int = 5) -> np.ndarray:
    """Realized volatility per sqrt second over the window_sec seconds before each t_obs, from step_sec returns
    (5 s returns damp the bid-ask bounce of 1 s closes)."""
    if window_sec % step_sec:
        raise ValueError("window must be a multiple of the step")
    t_obs = np.asarray(t_obs, dtype=np.int64)
    if len(t_obs) == 0:
        raise ValueError("no observation time")
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


# --- Desk-feasible estimators (plan 03 Task 1): what the live CRE desk can compute from four venues' 1-minute
# candles, replayed on the lab's venues. Conventions match cre/risk-desk/estimator.ts: a candle counts once its
# minute has ended; a report at t_obs uses the minutes closed at or before t_obs.

PARKINSON = 1.0 / (4.0 * math.log(2.0))


@dataclass(frozen=True)
class MinuteOhlc:
    """One venue's 1-minute candles in USD on a contiguous 60 s grid (open_t[i] = open_t[0] + 60 i).
    A minute without trades repeats the previous close as its high, low and close."""

    open_t: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray


def ohlc_from_rows(rows, usd_per_quote: MinuteSeries | None = None) -> MinuteOhlc:
    """[[open_s, open, high, low, close], ...] (any order, gaps allowed) -> MinuteOhlc. usd_per_quote converts a
    USDT-quoted venue: each minute is multiplied by the USDT-USD close of the last minute closed at or before its own
    close."""
    if len(rows) == 0:
        raise ValueError("no candles")
    by_t = {int(r[0]): r for r in rows}
    ts = np.array(sorted(by_t), dtype=np.int64)
    if np.any(ts % 60):
        raise ValueError("open times must be whole minutes")
    raw = np.array([[float(x) for x in by_t[int(t)][2:5]] for t in ts], dtype=np.float64)  # high, low, close
    n = int((ts[-1] - ts[0]) // 60) + 1
    pos = (ts - ts[0]) // 60
    has = np.zeros(n, dtype=bool)
    has[pos] = True
    src = np.zeros(n, dtype=np.int64)
    src[pos] = np.arange(len(ts))
    marker = np.where(has, np.arange(n), 0)
    np.maximum.accumulate(marker, out=marker)
    close = raw[src[marker], 2]
    high = np.where(has, raw[src, 0], close)
    low = np.where(has, raw[src, 1], close)
    open_t = ts[0] + 60 * np.arange(n, dtype=np.int64)
    if usd_per_quote is not None:
        idx = np.searchsorted(usd_per_quote.close_t, open_t + 60, side="right") - 1
        if idx[0] < 0:
            raise ValueError("no USDT-USD minute closed before the first candle")
        f = np.exp(usd_per_quote.logp[idx])
        high, low, close = high * f, low * f, close * f
    return MinuteOhlc(open_t, high, low, close)


def ohlc_from_trades(trades) -> list[list[float]]:
    """(unix seconds, price) trades in time order -> [[open_s, open, high, low, close], ...] for minutes with trades."""
    out: list[list[float]] = []
    last_t = -math.inf
    for t, p in trades:
        if t < last_t:
            raise ValueError("trades must be in time order")
        last_t = t
        m = int(t // 60) * 60
        if out and out[-1][0] == m:
            row = out[-1]
            row[2] = max(row[2], p)
            row[3] = min(row[3], p)
            row[4] = p
        else:
            out.append([m, p, p, p, p])
    return out


def _minutes(window_sec: int) -> int:
    if window_sec % 60 or window_sec < 60:
        raise ValueError("the window must be a whole number of minutes")
    return window_sec // 60


def _common_grid(venues: list[MinuteOhlc]) -> tuple[np.ndarray, list[np.ndarray]]:
    t0 = max(int(v.open_t[0]) for v in venues)
    t1 = min(int(v.open_t[-1]) for v in venues)
    if t1 < t0:
        raise ValueError("the venues do not overlap")
    grid = np.arange(t0, t1 + 60, 60, dtype=np.int64)
    return grid, [(grid - int(v.open_t[0])) // 60 for v in venues]


def _window_index(grid: np.ndarray, t_obs, n: int) -> np.ndarray:
    """[len(t_obs), n] indexes into grid of the n minutes ending with the last minute closed at or before t_obs."""
    last_open = (np.asarray(t_obs, dtype=np.int64) // 60) * 60 - 60
    end = (last_open - int(grid[0])) // 60
    idx = end[:, None] - np.arange(n - 1, -1, -1, dtype=np.int64)[None, :]
    if idx.min() < 0 or idx.max() >= len(grid):
        raise ValueError("not enough minutes for the window")
    return idx


def median_close_rv(venues: list[MinuteOhlc], t_obs, window_sec: int) -> np.ndarray:
    """Realized volatility per sqrt second over window_sec from the cross-venue median of 1-minute closes
    (window_sec / 60 returns). The CRE desk's `median-close` estimator."""
    n = _minutes(window_sec)
    grid, take = _common_grid(venues)
    med = np.log(np.median(np.vstack([v.close[i] for v, i in zip(venues, take)]), axis=0))
    idx = _window_index(grid, t_obs, n + 1)
    r = np.diff(med[idx], axis=1)
    return np.sqrt((r * r).sum(axis=1) / window_sec)


def range_rv(venues: list[MinuteOhlc], t_obs, window_sec: int) -> np.ndarray:
    """Median across venues of each venue's Parkinson volatility per sqrt second over its window_sec / 60 one-minute
    candles: sqrt(mean(ln(high / low)^2) / (4 ln 2) / 60 s). The CRE desk's `venue-range` estimator."""
    n = _minutes(window_sec)
    grid, take = _common_grid(venues)
    idx = _window_index(grid, t_obs, n)
    per = []
    for v, i in zip(venues, take):
        u = np.log(v.high[i] / v.low[i]) ** 2 * PARKINSON
        per.append(np.sqrt(u[idx].mean(axis=1) / 60.0))
    return np.median(np.vstack(per), axis=0)
