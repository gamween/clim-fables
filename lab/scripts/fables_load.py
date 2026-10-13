"""Loads the study window once for the three Fables studies (offline: reads lab/data/fables2/ and the swap history)."""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

from clim_lab import arbclass, robin, venue
from clim_lab import fables as fb
from clim_lab.data import DATA_DIR, SecondSeries, load_1m_pairs_json

RAW = DATA_DIR / "fables2"
START = 1_788_739_200  # 2026-09-07 00:00 UTC (Monday)
END = 1_791_763_200  # 2026-10-12 00:00 UTC (Monday), five full weeks
WEEK = 7 * 86_400
FIT_WEEKS = 3
REPORT_SEC = 30
DESK_LATENCY_SEC = 2  # a report lands about 2 s after its observation time on Robinhood Chain


@dataclass(frozen=True)
class Window:
    swaps: robin.Swaps
    t: np.ndarray  # unix second of each swap
    venue: SecondSeries  # ln(ETH in USD), 1 s
    pokes: list
    configs: list
    clears_t: np.ndarray
    z: np.ndarray  # venue minus pool before each swap
    is_arb: np.ndarray
    event: np.ndarray  # first arbitrage swap of each (block, side)


def _days(a: int, b: int) -> list[str]:
    d, d1, out = datetime.fromtimestamp(a, timezone.utc).date(), datetime.fromtimestamp(b, timezone.utc).date(), []
    while d <= d1:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def load_window() -> Window:
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    swaps = robin.load_swaps(clock.block_at(START), clock.block_after(END))
    t = clock.time_of(swaps.block)
    keep = (t >= START) & (t < END)
    swaps, t = swaps.select(keep), t[keep]
    # day files cover whole days; keep the span the USDT-USD minutes cover (fetched from START - 3,600, so the
    # first minute closes at START - 3,540) up to END + 600 (markouts look 300 s ahead)
    b1s = venue.load_b1s_days(_days(START - 3_600, END + 600), RAW).slice(START - 3_540, END + 600)
    usd = venue.usd_log_series(b1s, load_1m_pairs_json(RAW / "usdtusd_1m.json"))
    pokes = [fb.decode_feepoked(r) for r in json.loads((RAW / "feepoked.json").read_text())]
    configs = [fb.decode_poolconfigured(r) for r in json.loads((RAW / "poolconfigured.json").read_text())]
    clears = json.loads((RAW / "pokecleared.json").read_text())
    clears_t = np.array([fb.hex_int(r["timeStamp"]) for r in clears], dtype=np.int64)
    z, is_arb = arbclass.classify(swaps, t, usd)
    event = arbclass.arb_events(swaps.block, swaps.side, is_arb)
    return Window(swaps, t, usd, pokes, configs, clears_t, z, is_arb, event)


def keeper_fee_per_second(w: Window, a: int, b: int) -> np.ndarray:
    """Fables' resolved fee (pips) at every second of [a, b)."""
    grid = np.arange(a, b, dtype=np.int64)
    return fb.keeper_fee_at(grid, w.pokes, w.configs, w.clears_t)


def week_index(t) -> np.ndarray:
    return (np.asarray(t, dtype=np.int64) - START) // WEEK
