# clim × Fables plan 01: lab (calibration on Fables' own data)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calibrate clim's fee policy on Fables' ETH/USDG pool (Robinhood Chain mainnet) and publish three studies (effective arbitrage interval, volatility window, per-direction signal) plus the decided parameters in `shared/params-fables.json`.

**Architecture:** Pure, tested modules in `lab/clim_lab/` (history loading, block clock, venue prices, arbitrage classification, Δt inversion, short-window volatility, markouts) and thin scripts in `lab/scripts/` that read raw data from `lab/data/fables2/` (gitignored, re-downloadable) and write JSON to `lab/out/`. Every published number comes from these JSON files.

**Tech Stack:** Python 3.12, numpy 2.5.3, pytest 9.1.1, uv. No new dependency.

Spec: `docs/superpowers/specs/2026-10-13-clim-fables-design.md` §5.1. Master plan: `2026-10-13-clim-fables-00-master.md`.

---

## Facts used by this plan

- Study window: **2026-09-07 00:00 UTC (1788739200) to 2026-10-12 00:00 UTC (1791763200)**, five full weeks (Mondays 09-07, 09-14, 09-21, 09-28, 10-05). The pool's current config (floor 1 bp, flat 7 bp, cap 60 bp) was set on 2026-09-06, so the window starts the next Monday. Fit weeks: the first three. Test weeks: the last two.
- Pool: ETH/USDG, PoolId `0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551`, currency0 native ETH (18 decimals), currency1 USDG (6 decimals). Price in USDG per ETH = (sqrtPriceX96 / 2^96)^2 × 1e12.
- Hook: `0x06a889870c8f83640d6816319f72e2aa579b6080` (FablesRampETH), deployed at block 41,250,427. Its `FeePoked`, `PokeCleared` and `PoolConfigured` decoders already exist in `lab/clim_lab/fables.py`.
- Swap history: fables-farming's download, `~/Development/projects/fables-farming/data/history/0xbac3aa3b/*.ndjson` (override with `FABLES_HISTORY_DIR`). One JSON object per line: `{"kind":"swap","block":…,"logIndex":…,"amount0":"…","amount1":"…","sqrtPriceX96":"…","liquidity":"…","tick":…,"fee":…}`. Amounts are the v4 `Swap` event's, from the swapper's side: `amount0 < 0` means the swapper paid ETH (zeroForOne, the price falls). The files carry no timestamp.
- Robinhood Chain: about 0.1 s blocks, 1 s timestamps. Public RPC `https://rpc.mainnet.chain.robinhood.com` (override with `RH_MAINNET_RPC_URL`); Etherscan V2 `https://api.etherscan.io/v2/api?chainid=4663` with the key from `ETHERSCAN_API_KEY` or the `ETHERSCAN_API_KEY=` line of `contracts/.env` (never printed).
- Venue reference: Binance spot ETHUSDT 1 s klines from `https://data.binance.vision/data/spot/daily/klines/ETHUSDT/1s/ETHUSDT-1s-YYYY-MM-DD.zip` (no header; column 0 open time, in microseconds since 2025, column 4 close), converted to USD with Coinbase USDT-USD 1 min candles (`https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=60&start=…&end=…`, at most 300 per request, newest first).
- Model: arbitrage events per second with blocks every Δt seconds = P_trade / Δt, P_trade = 1 / (η + c), η = γ / (σ √(Δt/2)), γ = −ln(1 − fee) the no-arbitrage half band, c = 1 for Poisson block times (Milionis, Moallemi and Roughgarden 2023) and 0.824 for fixed ones (Nezlobin and Tassy 2025). The rate falls as Δt grows, so Δt is unique for an observed rate.

## File structure

| File | Responsibility |
|---|---|
| `lab/clim_lab/robin.py` | Swap history loader (`Swaps`), `BlockClock`, sqrtPriceX96 to log price |
| `lab/clim_lab/venue.py` | Binance 1 s day files to one `SecondSeries`, USDT-to-USD conversion, short-window realized volatility |
| `lab/clim_lab/arbclass.py` | No-arbitrage band, arbitrage classification, one event per (block, side) |
| `lab/clim_lab/dteff.py` | Arbitrage rate model, Δt inversion, venue-exit-to-arbitrage delays |
| `lab/clim_lab/markout.py` | Direction signal, markouts, bucket tables, weighted slope fit |
| `lab/clim_lab/policy.py` | Fee policy on per-second σ with Fables' floor and cap, η calibration at equal average fee |
| `lab/scripts/fables_fetch.py` | Network, read only: block-time samples, clock check, hook logs, Binance 1 s, Coinbase USDT-USD |
| `lab/scripts/fables_load.py` | Shared loading of the study window for the three study scripts |
| `lab/scripts/study_dt.py` | Study 1 → `lab/out/fables-dt-eff.json` |
| `lab/scripts/study_window.py` | Study 2 → `lab/out/fables-window.json` |
| `lab/scripts/study_direction.py` | Study 3 → `lab/out/fables-direction.json` |
| `lab/scripts/decide_fables_params.py` | → `shared/params-fables.json` |
| `lab/tests/test_robin.py`, `test_venue.py`, `test_arbclass.py`, `test_dteff.py`, `test_markout.py`, `test_policy.py`, `test_fables_outputs.py` | Tests |

All commands run from `lab/` unless stated.

---

### Task 1: Swap history and block clock (`robin.py`)

**Files:**
- Create: `lab/clim_lab/robin.py`
- Test: `lab/tests/test_robin.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Fables ETH/USDG history loader, block clock and price conversion."""

import json
import math

import numpy as np
import pytest

from clim_lab import robin


def _write(tmp_path, name, rows):
    p = tmp_path / name
    p.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return p


def _swap(block, li, a0, a1, sqrt_p, fee=700):
    return {
        "kind": "swap",
        "block": block,
        "logIndex": li,
        "amount0": str(a0),
        "amount1": str(a1),
        "sqrtPriceX96": str(sqrt_p),
        "liquidity": "1",
        "tick": 0,
        "fee": fee,
    }


SQRT_2500 = int(math.sqrt(2500 / 1e12) * 2**96)


def test_log_price_from_sqrt_is_usdg_per_eth():
    lp = robin.log_price_from_sqrt([SQRT_2500])
    assert lp.shape == (1,)
    assert math.exp(lp[0]) == pytest.approx(2500.0, rel=1e-9)


def test_load_swaps_filters_sorts_and_converts(tmp_path):
    _write(
        tmp_path,
        "100-199.ndjson",
        [
            _swap(150, 3, -2 * 10**18, 5_000 * 10**6, SQRT_2500),
            {"kind": "modifyLiquidity", "block": 151},
            _swap(150, 1, 10**18, -2_500 * 10**6, SQRT_2500, fee=900),
            _swap(120, 0, 10**18, -2_500 * 10**6, SQRT_2500),
        ],
    )
    _write(tmp_path, "200-299.ndjson", [_swap(250, 0, 10**18, -2_500 * 10**6, SQRT_2500)])
    s = robin.load_swaps(130, 260, tmp_path)
    assert list(s.block) == [150, 150, 250]
    assert list(s.log_index) == [1, 3, 0]
    assert s.eth[1] == pytest.approx(-2.0)
    assert s.usd[1] == pytest.approx(5_000.0)
    assert list(s.fee_pips) == [900, 700, 700]
    assert list(s.zero_for_one) == [False, True, False]
    assert list(s.side) == [1, -1, 1]
    assert math.exp(s.log_exec_price[1]) == pytest.approx(2500.0)
    before = s.log_price_before
    assert math.isnan(before[0]) and before[1] == pytest.approx(s.log_price[0])


def test_load_swaps_drops_zero_amounts(tmp_path):
    _write(tmp_path, "0-99.ndjson", [_swap(10, 0, 0, 0, SQRT_2500), _swap(11, 0, 10**18, -2_500 * 10**6, SQRT_2500)])
    s = robin.load_swaps(0, 99, tmp_path)
    assert list(s.block) == [11]


def test_load_swaps_raises_when_empty(tmp_path):
    _write(tmp_path, "0-99.ndjson", [])
    with pytest.raises(ValueError):
        robin.load_swaps(0, 99, tmp_path)


def test_select_keeps_alignment(tmp_path):
    _write(tmp_path, "0-99.ndjson", [_swap(b, 0, 10**18, -2_500 * 10**6, SQRT_2500) for b in (1, 2, 3)])
    s = robin.load_swaps(0, 99, tmp_path).select(np.array([True, False, True]))
    assert list(s.block) == [1, 3] and len(s) == 2


def test_block_clock_interpolates_and_floors():
    c = robin.BlockClock(np.array([100, 110, 130]), np.array([1_000, 1_001, 1_003]))
    assert list(c.time_of([100, 105, 110, 120, 130])) == [1_000, 1_000, 1_001, 1_002, 1_003]
    assert c.block_at(1_002) == 110
    assert c.block_after(1_002) == 130
    assert c.block_at(500) == 100
    with pytest.raises(ValueError):
        c.block_after(2_000)
    with pytest.raises(ValueError):
        c.time_of([99])


def test_block_clock_rejects_unsorted():
    with pytest.raises(ValueError):
        robin.BlockClock(np.array([100, 100]), np.array([1, 2]))
    with pytest.raises(ValueError):
        robin.BlockClock(np.array([100, 101]), np.array([2, 1]))
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_robin.py -q`
Expected: FAIL, `ModuleNotFoundError` or `AttributeError: module 'clim_lab' has no attribute 'robin'`.

- [ ] **Step 3: Implement `lab/clim_lab/robin.py`**

```python
"""Fables ETH/USDG on Robinhood Chain: swap history, block timestamps and pool prices.

The swap history is fables-farming's download (src/research/fetch-history.ts): ndjson files named
"<firstBlock>-<lastBlock>.ndjson", one event per line. Swap amounts are the Uniswap v4 Swap event's, from the swapper's
side: amount0 < 0 means the swapper paid ETH into the pool (zeroForOne, the pool price falls). The pool is native ETH
(18 decimals) / USDG (6 decimals), so the price in USDG per ETH is (sqrtPriceX96 / 2^96)^2 * 1e12.

The history has no timestamps. BlockClock maps blocks to unix seconds from sampled (block, timestamp) pairs read over
RPC (scripts/fables_fetch.py blocks), by linear interpolation rounded to the nearest second (the samples are whole
seconds, the true time rounded down); `fables_fetch.py check-clock` measures the error against exact block timestamps.
"""

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

POOL_ID = "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551"
HOOK = "0x06a889870c8f83640d6816319f72e2aa579b6080"
HOOK_DEPLOY_BLOCK = 41_250_427
CHAIN_ID = 4663
LOG_DECIMALS = math.log(1e12)
LOG_Q96 = 96.0 * math.log(2.0)
DEFAULT_HISTORY_DIR = Path.home() / "Development/projects/fables-farming/data/history/0xbac3aa3b"


def history_dir() -> Path:
    return Path(os.environ.get("FABLES_HISTORY_DIR", str(DEFAULT_HISTORY_DIR)))


def log_price_from_sqrt(sqrt_price_x96) -> np.ndarray:
    """ln(USDG per ETH) from sqrtPriceX96 values (ints or decimal strings)."""
    s = np.array([float(int(v)) for v in np.atleast_1d(sqrt_price_x96)], dtype=np.float64)
    return 2.0 * (np.log(s) - LOG_Q96) + LOG_DECIMALS


@dataclass(frozen=True)
class Swaps:
    block: np.ndarray  # int64
    log_index: np.ndarray  # int64
    eth: np.ndarray  # amount0 / 1e18, swapper side
    usd: np.ndarray  # amount1 / 1e6, swapper side
    log_price: np.ndarray  # ln(USDG per ETH) after the swap
    fee_pips: np.ndarray  # int64, swap fee charged (LP fee; equals the LP fee while the protocol fee is 0)

    def __len__(self) -> int:
        return len(self.block)

    @property
    def zero_for_one(self) -> np.ndarray:
        """True when the swapper paid ETH (sold ETH to the pool): the pool price falls."""
        return self.eth < 0

    @property
    def side(self) -> np.ndarray:
        """+1 when the swapper bought ETH from the pool, -1 when it sold ETH to it."""
        return np.where(self.zero_for_one, -1, 1).astype(np.int64)

    @property
    def log_price_before(self) -> np.ndarray:
        """Pool log price before each swap: the previous swap's price after (NaN for the first swap)."""
        out = np.empty_like(self.log_price)
        out[0] = np.nan
        out[1:] = self.log_price[:-1]
        return out

    @property
    def notional_usd(self) -> np.ndarray:
        return np.abs(self.usd)

    @property
    def log_exec_price(self) -> np.ndarray:
        """ln of the execution price in USDG per ETH, LP fee included (|amount1| / |amount0|)."""
        return np.log(np.abs(self.usd)) - np.log(np.abs(self.eth))

    def select(self, mask) -> "Swaps":
        m = np.asarray(mask)
        return Swaps(
            self.block[m], self.log_index[m], self.eth[m], self.usd[m], self.log_price[m], self.fee_pips[m]
        )


def _range_of(path: Path) -> tuple[int, int]:
    a, b = path.stem.split("-")
    return int(a), int(b)


def load_swaps(first_block: int, last_block: int, directory: Path | None = None) -> Swaps:
    """Every swap with first_block <= block <= last_block, in chain order, zero-amount swaps dropped."""
    d = Path(directory) if directory is not None else history_dir()
    rows = []
    for f in sorted(d.glob("*.ndjson"), key=lambda p: _range_of(p)[0]):
        a, b = _range_of(f)
        if b < first_block or a > last_block:
            continue
        with f.open() as fh:
            for line in fh:
                e = json.loads(line)
                if e.get("kind") != "swap" or not first_block <= e["block"] <= last_block:
                    continue
                if int(e["amount0"]) == 0 or int(e["amount1"]) == 0:
                    continue
                rows.append(e)
    if not rows:
        raise ValueError(f"no swap between blocks {first_block} and {last_block} in {d}")
    rows.sort(key=lambda e: (e["block"], e["logIndex"]))
    return Swaps(
        block=np.array([e["block"] for e in rows], dtype=np.int64),
        log_index=np.array([e["logIndex"] for e in rows], dtype=np.int64),
        eth=np.array([int(e["amount0"]) / 1e18 for e in rows], dtype=np.float64),
        usd=np.array([int(e["amount1"]) / 1e6 for e in rows], dtype=np.float64),
        log_price=log_price_from_sqrt([e["sqrtPriceX96"] for e in rows]),
        fee_pips=np.array([e["fee"] for e in rows], dtype=np.int64),
    )


@dataclass(frozen=True)
class BlockClock:
    """Block number to unix seconds, from sampled (block, timestamp) pairs."""

    block: np.ndarray
    ts: np.ndarray

    def __post_init__(self):
        if len(self.block) < 2 or np.any(np.diff(self.block) <= 0):
            raise ValueError("sample blocks must be strictly increasing (at least two)")
        if np.any(np.diff(self.ts) < 0):
            raise ValueError("sample timestamps must not decrease")

    @classmethod
    def from_json(cls, path: Path) -> "BlockClock":
        rows = json.loads(Path(path).read_text())
        rows.sort(key=lambda r: r[0])
        return cls(np.array([r[0] for r in rows], dtype=np.int64), np.array([r[1] for r in rows], dtype=np.int64))

    def time_of(self, blocks) -> np.ndarray:
        b = np.asarray(blocks, dtype=np.int64)
        if b.min() < self.block[0] or b.max() > self.block[-1]:
            raise ValueError("block outside the sampled range")
        return np.rint(np.interp(b, self.block, self.ts)).astype(np.int64)

    def block_at(self, t: int) -> int:
        """Last sampled block whose timestamp is at or before t (the first sample if t is before the range)."""
        i = int(np.searchsorted(self.ts, t, side="right")) - 1
        return int(self.block[max(i, 0)])

    def block_after(self, t: int) -> int:
        """First sampled block whose timestamp is at or after t (raises if t is after the range)."""
        i = int(np.searchsorted(self.ts, t, side="left"))
        if i >= len(self.ts):
            raise ValueError("time after the sampled range")
        return int(self.block[i])
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_robin.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add lab/clim_lab/robin.py lab/tests/test_robin.py
git commit -m "feat(lab): Fables swap history loader and block clock"
```

### Task 2: Venue prices and short-window volatility (`venue.py`)

**Files:**
- Create: `lab/clim_lab/venue.py`
- Test: `lab/tests/test_venue.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_venue.py -q`
Expected: FAIL, `ImportError: cannot import name 'venue'`.

- [ ] **Step 3: Implement `lab/clim_lab/venue.py`**

```python
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
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_venue.py -q`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add lab/clim_lab/venue.py lab/tests/test_venue.py
git commit -m "feat(lab): venue USD price series and short-window realized volatility"
```

### Task 3: Fetch the raw data (`fables_fetch.py`, network, read only)

**Files:**
- Create: `lab/scripts/fables_fetch.py`

This script only reads public data. It never signs or sends a transaction. Raw files go to `lab/data/fables2/` (gitignored through `lab/data/`).

- [ ] **Step 1: Write the script**

```python
"""Raw data for the clim x Fables studies (network, read only). Writes lab/data/fables2/.

    uv run python scripts/fables_fetch.py blocks [--step 600]     # (block, timestamp) samples over the window
    uv run python scripts/fables_fetch.py check-clock               # interpolation error on 300 random blocks
    uv run python scripts/fables_fetch.py logs                      # FeePoked, PokeCleared, PoolConfigured of the hook
    uv run python scripts/fables_fetch.py binance                   # Binance ETHUSDT 1 s, one CSV per day
    uv run python scripts/fables_fetch.py usdt                      # Coinbase USDT-USD 1 min

Every subcommand resumes: files already written are kept unless --refresh. The Etherscan key comes from
ETHERSCAN_API_KEY or the ETHERSCAN_API_KEY= line of contracts/.env and is never printed or written.
"""

import argparse
import io
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from clim_lab import fables as fb
from clim_lab import robin, venue
from clim_lab.data import DATA_DIR, LAB_DIR, OUT_DIR
from clim_lab.report import now_iso, write_json

RAW = DATA_DIR / "fables2"
START = 1_788_739_200  # 2026-09-07 00:00 UTC
END = 1_791_763_200  # 2026-10-12 00:00 UTC
PAD_BEFORE = 3_600  # one hour of venue history before START for the volatility windows
PAD_AFTER = 600  # markouts look up to 300 s ahead
RPC = os.environ.get("RH_MAINNET_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
ETHERSCAN = "https://api.etherscan.io/v2/api"
UA = {"User-Agent": "clim-lab/0.1 (research, read only)"}


def _get(url: str, timeout: int = 60) -> bytes:
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # network hiccups and 429s: back off and retry
            if attempt == 5:
                raise
            print(f"  retry {attempt + 1} after {type(e).__name__}", file=sys.stderr)
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def _rpc(batch: list[dict]) -> list[dict]:
    body = json.dumps(batch).encode()
    for attempt in range(8):
        try:
            req = urllib.request.Request(RPC, data=body, headers={**UA, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                out = json.loads(r.read())
            if isinstance(out, dict):
                raise RuntimeError(f"RPC error: {out.get('error')}")
            bad = [x.get("error") for x in out if "result" not in x or x["result"] is None]
            if bad:  # rate-limited items come back as per-item errors: retry the whole batch
                raise RuntimeError(f"{len(bad)} batch items failed: {bad[0]}")
            return sorted(out, key=lambda x: x["id"])
        except Exception as e:
            if attempt == 7:
                raise
            print(f"  rpc retry {attempt + 1} after {type(e).__name__}", file=sys.stderr)
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def _blocks(numbers: list[int]) -> list[tuple[int, int]]:
    batch = [
        {"jsonrpc": "2.0", "id": i, "method": "eth_getBlockByNumber", "params": [hex(n), False]}
        for i, n in enumerate(numbers)
    ]
    return [(int(r["result"]["number"], 16), int(r["result"]["timestamp"], 16)) for r in _rpc(batch)]


def _latest() -> int:
    return int(_rpc([{"jsonrpc": "2.0", "id": 0, "method": "eth_blockNumber", "params": []}])[0]["result"], 16)


def _block_at_or_after(t: int, lo: int, hi: int) -> int:
    while lo < hi:
        mid = (lo + hi) // 2
        if _blocks([mid])[0][1] < t:
            lo = mid + 1
        else:
            hi = mid
    return lo


def cmd_blocks(args) -> None:
    out = RAW / "blocks.json"
    partial = RAW / "blocks.partial.json"
    if out.exists() and not args.refresh:
        print(f"{out} exists (use --refresh)")
        return
    hi = _latest()
    first = _block_at_or_after(START - PAD_BEFORE, robin.HOOK_DEPLOY_BLOCK, hi)
    last = _block_at_or_after(END + PAD_AFTER, first, hi)
    numbers = list(range(first, last + 1, args.step))
    if numbers[-1] != last:
        numbers.append(last)
    RAW.mkdir(parents=True, exist_ok=True)
    # resumable: Alchemy's free tier allows ~330 compute units/s (16 per block read), so pace batches and keep progress
    rows: list[tuple[int, int]] = [tuple(r) for r in json.loads(partial.read_text())] if partial.exists() else []
    done = {r[0] for r in rows}
    todo = [n for n in numbers if n not in done]
    for i in range(0, len(todo), args.batch):
        rows += _blocks(todo[i : i + args.batch])
        time.sleep(args.pause)
        if (i // args.batch) % 50 == 0:
            partial.write_text(json.dumps(rows))
            print(f"  {len(rows)}/{len(numbers)} samples", flush=True)
    rows.sort()
    out.write_text(json.dumps(rows))
    partial.unlink(missing_ok=True)
    print(f"wrote {out}: {len(rows)} samples, blocks {first}..{last}, step {args.step}")


def cmd_check_clock(args) -> None:
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    rng = random.Random(20261013)
    picks = sorted(rng.randrange(int(clock.block[0]), int(clock.block[-1])) for _ in range(300))
    exact = []
    for i in range(0, len(picks), 10):
        exact += _blocks(picks[i : i + 10])
        time.sleep(1.0)
    b = np.array([r[0] for r in exact], dtype=np.int64)
    ts = np.array([r[1] for r in exact], dtype=np.int64)
    err = np.abs(clock.time_of(b) - ts)
    res = {
        "generatedAt": now_iso(),
        "samples": int(len(b)),
        "sampleStepBlocks": int(np.median(np.diff(clock.block))),
        "errorSec": {"p50": float(np.percentile(err, 50)), "p99": float(np.percentile(err, 99)), "max": int(err.max())},
        "shareWithin1s": float((err <= 1).mean()),
        # timestamps are whole seconds, so +-1 s is the floor any interpolation can reach; the gate asks for 99 % there
        "pass": bool((err <= 1).mean() >= 0.99),
    }
    write_json(OUT_DIR / "fables-clock-check.json", res)
    print(json.dumps(res["errorSec"]), f"within 1 s: {res['shareWithin1s']:.1%}", "PASS" if res["pass"] else "FAIL: rerun blocks with a smaller --step")


def _etherscan_key() -> str:
    key = os.environ.get("ETHERSCAN_API_KEY", "")
    env = LAB_DIR.parent / "contracts" / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("ETHERSCAN_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        sys.exit("ETHERSCAN_API_KEY is not set (env or contracts/.env)")
    return key


def _logs(topic0: str, from_block: int, to_block: int) -> list[dict]:
    key = _etherscan_key()
    rows: list[dict] = []
    start = from_block
    while start <= to_block:
        q = {
            "chainid": robin.CHAIN_ID,
            "module": "logs",
            "action": "getLogs",
            "address": robin.HOOK,
            "topic0": topic0,
            "topic0_1_opr": "and",
            "topic1": robin.POOL_ID,
            "fromBlock": start,
            "toBlock": to_block,
            "page": 1,
            "offset": 1000,
            "apikey": key,
        }
        doc = json.loads(_get(ETHERSCAN + "?" + urllib.parse.urlencode(q)))
        page = doc.get("result") or []
        if not isinstance(page, list):
            raise RuntimeError(f"Etherscan error: {doc.get('message')}")
        rows += page
        if len(page) < 1000:
            break
        nxt = int(page[-1]["blockNumber"], 16)  # resume at the last block; duplicates removed below
        start = nxt if nxt > start else start + 1
        time.sleep(0.25)
    seen, out = set(), []
    for r in rows:
        k = (r["transactionHash"], r.get("logIndex", "0x"))
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def cmd_logs(args) -> None:
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    last = int(clock.block[-1])
    for name, topic in (
        ("feepoked", fb.FEE_POKED_TOPIC),
        ("pokecleared", fb.POKE_CLEARED_TOPIC),
        ("poolconfigured", fb.POOL_CONFIGURED_TOPIC),
    ):
        path = RAW / f"{name}.json"
        if path.exists() and not args.refresh:
            print(f"{path} exists")
            continue
        rows = _logs(topic, robin.HOOK_DEPLOY_BLOCK, last)
        path.write_text(json.dumps(rows))
        print(f"wrote {path}: {len(rows)} logs")


def _days() -> list[str]:
    d0 = datetime.fromtimestamp(START - PAD_BEFORE, timezone.utc).date()
    d1 = datetime.fromtimestamp(END + PAD_AFTER, timezone.utc).date()
    out, d = [], d0
    while d <= d1:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def cmd_binance(args) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for day in _days():
        path = RAW / f"b1s_{day}.csv"
        if path.exists() and not args.refresh:
            continue
        url = f"https://data.binance.vision/data/spot/daily/klines/ETHUSDT/1s/ETHUSDT-1s-{day}.zip"
        z = zipfile.ZipFile(io.BytesIO(_get(url, timeout=300)))
        lines = z.read(z.namelist()[0]).decode().splitlines()
        rows = venue.parse_binance_rows(lines)
        path.write_text("".join(f"{t},{c}\n" for t, c in rows))
        print(f"wrote {path}: {len(rows)} seconds")


def cmd_usdt(args) -> None:
    path = RAW / "usdtusd_1m.json"
    if path.exists() and not args.refresh:
        print(f"{path} exists")
        return
    rows: list[tuple[int, float]] = []
    t = START - PAD_BEFORE
    while t < END + PAD_AFTER:
        t2 = min(t + 300 * 60, END + PAD_AFTER)
        q = {
            "granularity": 60,
            "start": datetime.fromtimestamp(t, timezone.utc).isoformat(),
            "end": datetime.fromtimestamp(t2, timezone.utc).isoformat(),
        }
        url = "https://api.exchange.coinbase.com/products/USDT-USD/candles?" + urllib.parse.urlencode(q)
        for c in json.loads(_get(url)):  # [time, low, high, open, close, volume], newest first
            rows.append((int(c[0]), float(c[4])))
        t = t2
        time.sleep(0.35)
    RAW.mkdir(parents=True, exist_ok=True)
    venue.save_minute_rows(path, rows)
    print(f"wrote {path}: {len(set(rows))} minutes")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("blocks")
    b.add_argument("--step", type=int, default=600)
    b.add_argument("--batch", type=int, default=20)
    b.add_argument("--pause", type=float, default=1.0)
    for name in ("blocks", "check-clock", "logs", "binance", "usdt"):
        sp = b if name == "blocks" else sub.add_parser(name)
        sp.add_argument("--refresh", action="store_true")
    args = p.parse_args()
    {
        "blocks": cmd_blocks,
        "check-clock": cmd_check_clock,
        "logs": cmd_logs,
        "binance": cmd_binance,
        "usdt": cmd_usdt,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the fetches**

Run, in order:
```bash
uv run python scripts/fables_fetch.py blocks
uv run python scripts/fables_fetch.py check-clock
```
Expected: `blocks` writes about 55,000 samples (35 days plus padding at one sample per 600 blocks). `check-clock` prints the error percentiles and `PASS`.
If it prints `FAIL`, rerun with a smaller step until it passes: `uv run python scripts/fables_fetch.py blocks --step 200 --refresh`, then `check-clock` again. Record the step that passed in the session log.

```bash
uv run python scripts/fables_fetch.py logs
uv run python scripts/fables_fetch.py binance
uv run python scripts/fables_fetch.py usdt
```
Expected: `feepoked.json` with several thousand logs, `pokecleared.json` with 0 logs (none was ever emitted), `poolconfigured.json` with at least 2 logs, 37 `b1s_*.csv` files of 86,400 lines each, and `usdtusd_1m.json`.

- [ ] **Step 3: Check that the swap history covers the window**

Run:
```bash
uv run python - <<'EOF'
from clim_lab import robin
from clim_lab.data import DATA_DIR
c = robin.BlockClock.from_json(DATA_DIR / "fables2" / "blocks.json")
s = robin.load_swaps(c.block_at(1_788_739_200), c.block_after(1_791_763_200))
print(len(s), "swaps", s.block[0], s.block[-1])
EOF
```
Expected: several hundred thousand swaps. If it raises because the fables-farming history ends before 2026-10-12, refresh the history first: `cd ~/Development/projects/fables-farming && node src/research/fetch-history.ts 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551 41000000`.

- [ ] **Step 4: Commit the script and the clock check**

```bash
git add lab/scripts/fables_fetch.py lab/out/fables-clock-check.json
git commit -m "feat(lab): read-only fetch of Fables logs, block times and venue prices for the studies"
```

### Task 4: Arbitrage classification (`arbclass.py`)

**Files:**
- Create: `lab/clim_lab/arbclass.py`
- Test: `lab/tests/test_arbclass.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_arbclass.py -q`
Expected: FAIL, `ImportError: cannot import name 'arbclass'`.

- [ ] **Step 3: Implement `lab/clim_lab/arbclass.py`**

```python
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
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_arbclass.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add lab/clim_lab/arbclass.py lab/tests/test_arbclass.py
git commit -m "feat(lab): arbitrage classification against the venue USD price"
```

### Task 5: Δt inversion and delays (`dteff.py`)

**Files:**
- Create: `lab/clim_lab/dteff.py`
- Test: `lab/tests/test_dteff.py`

- [ ] **Step 1: Write the failing tests**

```python
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


def test_solve_dt_rejects_non_finite_or_degenerate_inputs():
    with pytest.raises(ValueError):
        dteff.solve_dt(1.0, float("nan"), 0.0006)
    with pytest.raises(ValueError):
        dteff.solve_dt(1.0, 0.0007, 0.0)


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


def test_delays_reject_windows_outside_the_venue_series():
    v = SecondSeries(10, np.zeros(10))  # covers seconds 10..19
    p_pre, gamma = np.array([0.0]), np.array([1.0])
    with pytest.raises(ValueError):  # the window starts before the series
        dteff.delays(np.array([15]), np.array([5]), p_pre, gamma, v)
    with pytest.raises(ValueError):  # the window reads past the series' last second
        dteff.delays(np.array([25]), np.array([15]), p_pre, gamma, v)
    assert list(dteff.delays(np.array([20]), np.array([15]), p_pre, gamma, v)) == [0]
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_dteff.py -q`
Expected: FAIL, `ImportError: cannot import name 'dteff'`.

- [ ] **Step 3: Implement `lab/clim_lab/dteff.py`**

```python
"""Effective arbitrage interval on a sub-second chain.

On Robinhood Chain blocks come every ~0.1 s, but arbitrageurs do not act every block: what sets LP losses is how often
they actually trade. The model's block time Δt is replaced by an effective interval, estimated two ways:

1. Frequency inversion: arbitrage events per second = P_trade / Δt with P_trade = 1 / (eta + c),
   eta = gamma / (sigma sqrt(Δt / 2)); c = 1 (Poisson blocks, MMR 2023) or 0.824 (fixed blocks, Nezlobin-Tassy 2025).
   The rate falls as Δt grows, so the observed rate gives one Δt.
2. Delays: seconds from the venue price leaving the pool's band to the arbitrage landing. Their mean is Δt for
   Poisson arrivals and Δt / 2 for fixed ones.
"""

import math

import numpy as np

from .data import SecondSeries

DT_MIN = 1e-3
DT_MAX = 1e5


def arb_rate(dt: float, gamma: float, sigma: float, c: float = 1.0) -> float:
    eta = gamma / (sigma * math.sqrt(dt / 2.0))
    return 1.0 / (dt * (eta + c))


def solve_dt(rate: float, gamma: float, sigma: float, c: float = 1.0) -> float:
    """The Δt (seconds) whose predicted arbitrage rate equals `rate` (events per second)."""
    if not rate > 0:
        raise ValueError("rate must be positive")
    if not (math.isfinite(rate) and math.isfinite(gamma) and math.isfinite(sigma)) or gamma < 0 or sigma <= 0:
        raise ValueError("rate, gamma and sigma must be finite, with gamma >= 0 and sigma > 0")
    if rate > arb_rate(DT_MIN, gamma, sigma, c) or rate < arb_rate(DT_MAX, gamma, sigma, c):
        raise ValueError("rate outside what the model can produce on [1 ms, 1e5 s]")
    lo, hi = math.log(DT_MIN), math.log(DT_MAX)
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if arb_rate(math.exp(mid), gamma, sigma, c) > rate:
            lo = mid
        else:
            hi = mid
    return math.exp(0.5 * (lo + hi))


def delays(
    t_arb: np.ndarray, t_prev: np.ndarray, p_pre: np.ndarray, gamma: np.ndarray, venue: SecondSeries, cap_sec: int = 3_600
) -> np.ndarray:
    """Seconds between the venue leaving the band [p_pre - gamma, p_pre + gamma] and each arbitrage.

    The pool price p_pre holds from the previous swap's second t_prev to the arbitrage's second t_arb. The exit is the
    second after the last second in [t_prev, t_arb) when the venue was inside the band; if it never was, the venue was
    already outside when the pool last moved and the delay counts from t_prev. Gaps longer than cap_sec are cut.
    """
    out = np.zeros(len(t_arb), dtype=np.int64)
    for i in range(len(t_arb)):
        b = int(t_arb[i])
        a = max(int(t_prev[i]), b - cap_sec)
        if b <= a:
            continue
        if a < venue.t0 or b - 1 > venue.t1:
            raise ValueError("the window reads outside the venue series")
        m = venue.logp[a - venue.t0 : b - venue.t0]
        inside = np.flatnonzero(np.abs(m - p_pre[i]) <= gamma[i])
        cross = a + int(inside[-1]) + 1 if len(inside) else a
        out[i] = b - cross
    return out
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_dteff.py -q`
Expected: `16 passed`.

- [ ] **Step 5: Commit**

```bash
git add lab/clim_lab/dteff.py lab/tests/test_dteff.py
git commit -m "feat(lab): effective arbitrage interval by frequency inversion and delays"
```

### Task 6: Fee policy and η calibration (`policy.py`)

**Files:**
- Create: `lab/clim_lab/policy.py`
- Test: `lab/tests/test_policy.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_policy.py -q`
Expected: FAIL, `ImportError: cannot import name 'policy'`.

- [ ] **Step 3: Implement `lab/clim_lab/policy.py`**

```python
"""clim's fee policy for Fables' pool, in float: fee = clamp(ceil(eta * sigma * sqrt(dt / 2) * 1e6), floor, cap).

Same rule as ClimFeeMath with k = 1, sigma per sqrt second, dt the effective arbitrage interval (dteff). Fables' hook
charges at least half its flat fee under an override and at most its cap; clim posts no lower than the flat fee.
"""

import math

import numpy as np


def policy_fee_pips(sigma, eta: float, dt_sec: float, floor_pips: int, cap_pips: int) -> np.ndarray:
    raw = np.ceil(eta * np.asarray(sigma, dtype=np.float64) * math.sqrt(dt_sec / 2.0) * 1e6)
    return np.clip(raw, floor_pips, cap_pips)


def calibrate_eta(sigma, dt_sec: float, floor_pips: int, cap_pips: int, target_mean_pips: float) -> float:
    """eta whose clamped fee averages target_mean_pips over the samples (equal average fee with Fables' keeper)."""
    if not floor_pips < target_mean_pips < cap_pips:
        raise ValueError("target mean must lie strictly between floor and cap")
    if not np.all(np.isfinite(sigma)):
        raise ValueError("sigma must be finite")
    if (
        policy_fee_pips(sigma, 1e6, dt_sec, floor_pips, cap_pips).mean() < target_mean_pips
        or policy_fee_pips(sigma, 1e-6, dt_sec, floor_pips, cap_pips).mean() > target_mean_pips
    ):
        raise ValueError("target mean unreachable for this sigma")
    lo, hi = 1e-6, 1e6
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if policy_fee_pips(sigma, mid, dt_sec, floor_pips, cap_pips).mean() < target_mean_pips:
            lo = mid
        else:
            hi = mid
    return math.sqrt(lo * hi)


def pstar_from_eta(eta: float, c: float = 1.0) -> float:
    """Predicted share of arbitrage opportunities taken: P* = 1 / (eta + c)."""
    return 1.0 / (eta + c)
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_policy.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add lab/clim_lab/policy.py lab/tests/test_policy.py
git commit -m "feat(lab): fee policy with Fables' bounds and eta at equal average fee"
```

### Task 7: Markouts and the direction signal (`markout.py`)

**Files:**
- Create: `lab/clim_lab/markout.py`
- Test: `lab/tests/test_markout.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_markout.py -q`
Expected: FAIL, `ImportError: cannot import name 'markout'`.

- [ ] **Step 3: Implement `lab/clim_lab/markout.py`**

```python
"""Per-direction toxicity on Fables' pool.

signal_bp: side * (venue - pool) in bp, positive when the swap goes the way the venue says the pool is mispriced.
markout_bp: side * (venue h seconds later - execution price) in bp, the trader's edge after the fee it paid, which is
the LP's loss on that trade. Notional-weighted tables per signal bucket show whether a positive signal predicts flow
that beats the fee.
"""

import numpy as np

HORIZONS_SEC = (5, 30, 300)
EDGES_BP = (-np.inf, -10.0, -5.0, -2.0, 0.0, 2.0, 5.0, 10.0, np.inf)


def signal_bp(side, venue_log, pool_log) -> np.ndarray:
    return np.asarray(side) * (np.asarray(venue_log) - np.asarray(pool_log)) * 1e4


def markout_bp(side, venue_future_log, exec_log) -> np.ndarray:
    return np.asarray(side) * (np.asarray(venue_future_log) - np.asarray(exec_log)) * 1e4


def pool_price_at(t_query, t_swap, log_price_after) -> np.ndarray:
    """Pool log price at each query second: the last swap in an earlier second (NaN before the first swap)."""
    idx = np.searchsorted(np.asarray(t_swap), np.asarray(t_query), side="left") - 1
    out = np.asarray(log_price_after, dtype=np.float64)[np.clip(idx, 0, None)].copy()
    out[idx < 0] = np.nan
    return out


def bucket_table(signal, markouts: dict, weight, edges=EDGES_BP) -> list[dict]:
    signal = np.asarray(signal)
    weight = np.asarray(weight, dtype=np.float64)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (signal >= lo) & (signal < hi)
        w = weight[m]
        row = {
            "loBp": None if np.isinf(lo) else float(lo),
            "hiBp": None if np.isinf(hi) else float(hi),
            "n": int(m.sum()),
            "notionalUsd": float(w.sum()),
            "markoutBp": {},
        }
        for h, mk in markouts.items():
            row["markoutBp"][str(h)] = float(np.average(np.asarray(mk)[m], weights=w)) if w.sum() > 0 else None
        rows.append(row)
    return rows


def slope_through_origin(d, e, w) -> float:
    """Weighted least squares e = a * d over d > 0: a = sum(w d e) / sum(w d^2)."""
    d = np.asarray(d, dtype=np.float64)
    e = np.asarray(e, dtype=np.float64)
    w = np.asarray(w, dtype=np.float64)
    m = d > 0
    den = float((w[m] * d[m] * d[m]).sum())
    return float((w[m] * d[m] * e[m]).sum() / den) if den > 0 else 0.0
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_markout.py -q`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add lab/clim_lab/markout.py lab/tests/test_markout.py
git commit -m "feat(lab): direction signal, markouts and bucket tables"
```

### Task 8: Shared loading of the study window (`fables_load.py`)

**Files:**
- Create: `lab/scripts/fables_load.py`

- [ ] **Step 1: Write the loader**

```python
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
```

- [ ] **Step 2: Smoke-run it**

Run:
```bash
uv run python - <<'EOF'
import sys; sys.path.insert(0, "scripts")
from fables_load import load_window, keeper_fee_per_second, START
w = load_window()
print(len(w.swaps), "swaps;", int(w.event.sum()), "arbitrage events;", len(w.pokes), "pokes")
print("keeper fee first hour mean bp:", keeper_fee_per_second(w, START, START + 3600).mean() / 100)
EOF
```
Expected: hundreds of thousands of swaps, tens of thousands of arbitrage events, thousands of pokes, a keeper mean fee between 7 and 60 bp.

- [ ] **Step 3: Commit**

```bash
git add lab/scripts/fables_load.py
git commit -m "feat(lab): shared loading of the Fables study window"
```

### Task 9: Study 1, effective arbitrage interval (`study_dt.py`)

**Files:**
- Create: `lab/scripts/study_dt.py`
- Create: `lab/tests/test_fables_outputs.py`

- [ ] **Step 1: Write the output contract test**

```python
"""Contracts of the clim x Fables study outputs (lab/out/fables-*.json, shared/params-fables.json)."""

import json

import pytest

from clim_lab.data import OUT_DIR, SHARED_DIR


def _load(name):
    p = OUT_DIR / name
    if not p.exists():
        pytest.skip(f"{name} not generated yet")
    return json.loads(p.read_text())


def test_dt_eff_output():
    d = _load("fables-dt-eff.json")
    assert d["window"]["start"] == "2026-09-07T00:00:00Z" and d["window"]["end"] == "2026-10-12T00:00:00Z"
    assert d["arbEvents"] > 1_000
    assert len(d["weekly"]) == 5
    assert 0.01 < d["chosen"]["dtEffSec"] < 600
    assert d["holdout"]["fitWeeks"] == [0, 1, 2] and d["holdout"]["testWeeks"] == [3, 4]
    assert d["holdout"]["predictedOverObserved"] > 0
    assert d["delay"]["meanSec"] >= 0
    assert "all weeks" in d["hourly"]["scope"] and "fit weeks" in d["chosen"]["scope"]
    sens = d["sensitivity"]
    assert set(sens["zShiftBp"]) == {"-1", "+1"}
    for v in list(sens["zShiftBp"].values()) + [sens["eventPerSecondSide"]]:
        assert len(v["weeklyDtSecPoisson"]) == 5
        assert v["dtSecFitWeeks"] > 0 and v["predictedOverObserved"] > 0 and -1 <= v["hourlyCorr"] <= 1
    assert any("Jensen" in c for c in d["caveats"])
    assert d["framing"].startswith("dt_eff is of order") and "<" not in d["framing"]
```

- [ ] **Step 2: Run it to see it skip**

Run: `uv run pytest tests/test_fables_outputs.py -q`
Expected: `1 skipped`.

- [ ] **Step 3: Write the study script**

```python
"""Study 1: the effective arbitrage interval on Fables' ETH/USDG pool (offline).

    uv run python scripts/study_dt.py     # lab/out/fables-dt-eff.json

Per hour: arbitrage events per second, the venue's realized volatility (5 s returns) and the keeper's time-average
no-arbitrage band; Δt solved from the rate model (dteff.solve_dt) with c = 1 and c = 0.824. The chosen Δt is the
median hourly Poisson estimate over the fit weeks; the test weeks check its predicted arbitrage counts. The delay
method is reported next to it. The sensitivity block reruns the inversion with the reference price shifted by
-1 bp and +1 bp, and with events counted once per (second, side) instead of once per (block, side).
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import END, FIT_WEEKS, START, WEEK, keeper_fee_per_second, load_window, week_index  # noqa: E402

from clim_lab import arbclass, dteff  # noqa: E402
from clim_lab.data import OUT_DIR  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.venue import rv_window  # noqa: E402

HOUR = 3_600
MIN_EVENTS = 5
Z_SHIFTS_BP = (-1, 1)


def _utc(t: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _events(w, z_shift: float = 0.0, per_second: bool = False) -> np.ndarray:
    """First arbitrage swap of each (block, side), or of each (second, side), with the reference price moved by
    z_shift (log) before classifying."""
    z = w.z + z_shift
    g = arbclass.band(w.swaps.fee_pips)
    with np.errstate(invalid="ignore"):
        is_arb = np.where(~w.swaps.zero_for_one, z > g, z < -g) & ~np.isnan(z)
    key = w.t if per_second else w.swaps.block
    return arbclass.arb_events(key, w.swaps.side, is_arb)


def _inversion(ev_t: np.ndarray, hours: np.ndarray, sigma: np.ndarray, gamma: np.ndarray) -> dict:
    """Hourly inversion of the arbitrage rate, weekly medians, the fit-week Δt and its holdout on the test weeks."""
    n_ev = np.histogram(ev_t, bins=np.append(hours, END))[0]
    rows = []
    for i, h in enumerate(hours):
        if n_ev[i] < MIN_EVENTS:
            continue
        rate = n_ev[i] / HOUR
        try:
            dp = dteff.solve_dt(rate, gamma[i], sigma[i], c=1.0)
            df = dteff.solve_dt(rate, gamma[i], sigma[i], c=0.824)
        except ValueError:
            continue
        rows.append((int(h), int(n_ev[i]), float(sigma[i]), float(gamma[i]), dp, df))
    hr = np.array(rows, dtype=np.float64)
    wk = week_index(hr[:, 0])
    fit = wk < FIT_WEEKS
    dt_fit = float(np.median(hr[fit, 4]))
    test = ~fit
    pred = np.array([dteff.arb_rate(dt_fit, g, s, 1.0) * HOUR for s, g in zip(hr[test, 2], hr[test, 3])])
    obs = hr[test, 1]
    return {"hr": hr, "wk": wk, "fit": fit, "dtFit": dt_fit, "pred": pred, "obs": obs}


def _summary(inv: dict) -> dict:
    hr, wk = inv["hr"], inv["wk"]
    return {
        "dtSecFitWeeks": inv["dtFit"],
        "weeklyDtSecPoisson": [float(np.median(hr[wk == k, 4])) for k in range(5)],
        "predictedOverObserved": float(inv["pred"].sum() / inv["obs"].sum()),
        "hourlyCorr": float(np.corrcoef(inv["pred"], inv["obs"])[0, 1]),
    }


def main() -> None:
    w = load_window()
    hours = np.arange(START, END, HOUR, dtype=np.int64)
    sigma = rv_window(w.venue, hours + HOUR, window_sec=HOUR, step_sec=5)
    gamma = np.empty(len(hours))
    for i, h in enumerate(hours):
        gamma[i] = arbclass.band(keeper_fee_per_second(w, int(h), int(h) + HOUR)[::10]).mean()

    inv = _inversion(w.t[w.event], hours, sigma, gamma)
    hr, wk, fit, dt_fit, pred, obs = inv["hr"], inv["wk"], inv["fit"], inv["dtFit"], inv["pred"], inv["obs"]

    weekly = []
    for k in range(5):
        m = wk == k
        weekly.append(
            {
                "weekStart": _utc(START + k * WEEK),
                "hours": int(m.sum()),
                "arbEvents": int(hr[m, 1].sum()),
                "dtSecPoisson": float(np.median(hr[m, 4])),
                "dtSecFixed": float(np.median(hr[m, 5])),
            }
        )

    t_prev = np.empty_like(w.t)
    t_prev[0] = w.t[0]
    t_prev[1:] = w.t[:-1]
    idx = np.flatnonzero(w.event)
    d = dteff.delays(w.t[idx], t_prev[idx], w.swaps.log_price_before[idx], arbclass.band(w.swaps.fee_pips[idx]), w.venue)

    shifted = {}
    for bp in Z_SHIFTS_BP:
        ev = _events(w, z_shift=bp * 1e-4)
        shifted[f"{bp:+d}"] = {"arbEvents": int(ev.sum()), **_summary(_inversion(w.t[ev], hours, sigma, gamma))}
    ev_sec = _events(w, per_second=True)
    per_sec = {"arbEvents": int(ev_sec.sum()), **_summary(_inversion(w.t[ev_sec], hours, sigma, gamma))}

    # framing numbers: the late weeks (4 and 5, indices 3 and 4) at the base band and under either 1 bp shift
    late = [3, 4]
    base_late = float(np.mean([weekly[k]["dtSecPoisson"] for k in late]))
    moved = [v["weeklyDtSecPoisson"][k] for v in shifted.values() for k in late]
    fits = [dt_fit, per_sec["dtSecFitWeeks"]] + [v["dtSecFitWeeks"] for v in shifted.values()]
    lo, hi = int(np.floor(min(fits))), int(np.ceil(max(fits)))
    framing = (
        f"dt_eff is of order {lo} to {hi} s; the per-hour estimate is very sensitive to the band (a 1 bp shift in the "
        f"reference price moves weeks 4-5 from ~{base_late:.0f} s to ~{min(moved):.0f}-{max(moved):.1f} s). clim's posted "
        "fee does not depend on dt: eta is calibrated at equal average fee, so only eta*sqrt(dt/2) matters."
    )

    out = {
        "generatedAt": now_iso(),
        "window": {"start": _utc(START), "end": _utc(END)},
        "pool": "Fables ETH/USDG, Robinhood Chain (4663)",
        "swaps": int(len(w.swaps)),
        "arbSwaps": int(w.is_arb.sum()),
        "arbEvents": int(w.event.sum()),
        "method": {
            "arbitrage": "swap toward the venue USD price from outside the band -ln(1 - fee); one event per block and side",
            "sigma": "venue realized volatility per hour from 5 s returns (Binance ETHUSDT 1 s x Coinbase USDT-USD)",
            "band": "Fables' resolved fee per second (FeePoked, PoolConfigured), time-averaged per hour",
            "model": "events/s = 1 / (dt (eta + c)), eta = gamma / (sigma sqrt(dt/2)); c = 1 Poisson, 0.824 fixed",
            "hoursKept": f"hours with at least {MIN_EVENTS} events and a rate the model can produce",
        },
        "hourly": {
            "scope": "all weeks (0 to 4); the chosen dt uses the fit weeks only",
            "hours": int(len(hr)),
            "medianDtSecPoisson": float(np.median(hr[:, 4])),
            "iqrDtSecPoisson": [float(np.percentile(hr[:, 4], 25)), float(np.percentile(hr[:, 4], 75))],
            "medianDtSecFixed": float(np.median(hr[:, 5])),
        },
        "weekly": weekly,
        "delay": {
            "events": int(len(d)),
            "meanSec": float(d.mean()),
            "medianSec": float(np.median(d)),
            "dtSecPoisson": float(d.mean()),
            "dtSecFixed": float(2 * d.mean()),
            "note": "lower bound: an arbitrage is only seen if the venue is still outside the band when it lands, and timestamps are whole seconds",
        },
        "holdout": {
            "fitWeeks": [0, 1, 2],
            "testWeeks": [3, 4],
            "dtSec": dt_fit,
            "predictedEvents": float(pred.sum()),
            "observedEvents": int(obs.sum()),
            "predictedOverObserved": float(pred.sum() / obs.sum()),
            "hourlyCorr": float(np.corrcoef(pred, obs)[0, 1]),
        },
        "chosen": {
            "dtEffSec": dt_fit,
            "scope": "fit weeks (0 to 2)",
            "fitHours": int(fit.sum()),
            "rule": "median hourly frequency inversion, Poisson (c = 1), fit weeks only",
        },
        "sensitivity": {
            "zShiftBp": shifted,
            "zShiftNote": "reference price moved by the given bp before classifying arbitrages (z +- 1e-4); same hours, sigma and band",
            "eventPerSecondSide": per_sec,
            "eventPerSecondSideNote": "one event per (second, side) instead of per (block, side)",
        },
        "caveats": [
            "the per-hour estimate is very sensitive to the band: a 1 bp shift in the reference price, either way, changes the late weeks several-fold (sensitivity.zShiftBp)",
            "the rate model did not hold out: the fit-week dt over-predicts the test weeks' arbitrage counts (holdout)",
            "Jensen effect: the band enters the non-linear rate model as an hourly time average, so an hour mixing floor and storm fees is not equivalent to its average band",
            "the delay method is a lower bound (whole-second timestamps, arbitrages seen only if the venue is still outside the band)",
        ],
        "framing": framing,
    }
    write_json(OUT_DIR / "fables-dt-eff.json", out)
    print(
        f"dt_eff {dt_fit:.3f} s (fit weeks); delay mean {d.mean():.2f} s; "
        f"test weeks predicted/observed {out['holdout']['predictedOverObserved']:.2f}"
    )
    print(framing)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the study and the contract test**

Run:
```bash
uv run python scripts/study_dt.py
uv run pytest tests/test_fables_outputs.py -q
```
Expected: the script prints `dt_eff …`, the contract test prints `1 passed`. Record the chosen Δt, the delay mean and the test-week ratio in `docs/sessions/<today>.md`. If `predictedOverObserved` falls outside 0.5 to 2, write that in the session log as a finding (the rate model does not transfer across weeks) and keep going: the chosen Δt is still the best single estimate, and the deck must say how well it held out.

- [ ] **Step 5: Commit**

```bash
git add lab/scripts/study_dt.py lab/tests/test_fables_outputs.py lab/out/fables-dt-eff.json docs/sessions
git commit -m "feat(lab): study 1, effective arbitrage interval on Fables' ETH/USDG"
```

### Task 10: Study 2, volatility window (`study_window.py`)

**Files:**
- Create: `lab/scripts/study_window.py`
- Modify: `lab/tests/test_fables_outputs.py` (append a test)

- [ ] **Step 1: Append the output contract test**

```python
def test_window_output():
    d = _load("fables-window.json")
    assert set(d["windows"]) == {"300", "900"}
    for k in ("300", "900"):
        w = d["windows"][k]
        assert w["etaE4"] > 0
        assert -1 <= w["corrKeeper"]["pearson"] <= 1 and -1 <= w["corrKeeper"]["spearman"] <= 1
        assert w["meanFeeBp"] == pytest.approx(d["keeper"]["meanFeeBp"], rel=0.01)
    assert d["chosenWindowSec"] in (300, 900)
    assert "flat7" in d["arbVsKeeperPct"]
```

- [ ] **Step 2: Write the study script**

```python
"""Study 2: which volatility window, 5 or 15 minutes, for clim's fee on Fables' pool (offline).

    uv run python scripts/study_window.py     # lab/out/fables-window.json

The desk reports every 30 s. For each window, eta is set so clim's fee averages the keeper's fee over the five weeks
(equal average fee). Then: correlation with the keeper's fee at report times, and arbitrage loss on a 1 s grid
(sim.run_arb, myopic arbitrageur) relative to the keeper's own fee path, plus a flat 7 bp pool.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import DESK_LATENCY_SEC, END, REPORT_SEC, START, keeper_fee_per_second, load_window  # noqa: E402

from clim_lab.data import OUT_DIR  # noqa: E402
from clim_lab.desk import log_bands  # noqa: E402
from clim_lab.policy import calibrate_eta, policy_fee_pips  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.sim import run_arb  # noqa: E402
from clim_lab.venue import rv_window  # noqa: E402

FLOOR, CAP, FLAT = 700, 6_000, 700
WINDOWS = (300, 900)


def _ranks(x: np.ndarray) -> np.ndarray:
    r = np.empty(len(x))
    r[np.argsort(x, kind="stable")] = np.arange(len(x))
    return r


def main() -> None:
    import json

    dt = json.loads((OUT_DIR / "fables-dt-eff.json").read_text())["chosen"]["dtEffSec"]
    w = load_window()
    seconds = np.arange(START, END, dtype=np.int64)
    keeper = keeper_fee_per_second(w, START, END).astype(np.float64)
    t_obs = np.arange(START - REPORT_SEC, END, REPORT_SEC, dtype=np.int64)
    # the report observed at t_obs applies from t_obs + latency until the next one
    rep_idx = np.searchsorted(t_obs + DESK_LATENCY_SEC, seconds, side="right") - 1
    x = w.venue.at(seconds)

    def arb(fee_pips: np.ndarray) -> float:
        return run_arb(x, log_bands(fee_pips)).arb

    arb_keeper = arb(keeper)
    out_w = {}
    arb_vs = {}
    for win in WINDOWS:
        sig_rep = rv_window(w.venue, t_obs, window_sec=win, step_sec=5)
        sig_sec = sig_rep[rep_idx]
        eta = calibrate_eta(sig_sec, dt, FLOOR, CAP, keeper.mean())
        fee_sec = policy_fee_pips(sig_sec, eta, dt, FLOOR, CAP)
        fee_rep = policy_fee_pips(sig_rep, eta, dt, FLOOR, CAP)
        keeper_rep = keeper[np.clip(t_obs + DESK_LATENCY_SEC - START, 0, len(keeper) - 1)]
        out_w[str(win)] = {
            "etaE4": int(round(eta * 1e4)),
            "meanFeeBp": float(fee_sec.mean() / 100),
            "corrKeeper": {
                "pearson": float(np.corrcoef(fee_rep, keeper_rep)[0, 1]),
                "spearman": float(np.corrcoef(_ranks(fee_rep), _ranks(keeper_rep))[0, 1]),
            },
            "sharePctAtFloor": float(100 * (fee_sec <= FLOOR).mean()),
            "sharePctAtCap": float(100 * (fee_sec >= CAP).mean()),
        }
        arb_vs[str(win)] = float(100 * (arb(fee_sec) / arb_keeper - 1))
    arb_vs["flat7"] = float(100 * (arb(np.full(len(seconds), FLAT, dtype=np.float64)) / arb_keeper - 1))

    best = min(WINDOWS, key=lambda k: arb_vs[str(k)])
    other = [k for k in WINDOWS if k != best][0]
    if abs(arb_vs[str(best)] - arb_vs[str(other)]) < 1.0:
        best = max(WINDOWS, key=lambda k: out_w[str(k)]["corrKeeper"]["pearson"])
    out = {
        "generatedAt": now_iso(),
        "dtEffSec": dt,
        "keeper": {"meanFeeBp": float(keeper.mean() / 100), "medianFeeBp": float(np.median(keeper) / 100)},
        "windows": out_w,
        "arbVsKeeperPct": arb_vs,
        "chosenWindowSec": int(best),
        "rule": "lower arbitrage loss at equal average fee; within 1 point, higher Pearson correlation with the keeper",
        "caveats": [
            "1 s grid: the simulator cannot see sub-second races; it ranks policies, it does not predict dollars",
            "the keeper's path is replayed as posted; clim's fee follows reports every 30 s with 2 s latency",
        ],
    }
    write_json(OUT_DIR / "fables-window.json", out)
    print(f"chosen window {best} s; arbitrage vs keeper {arb_vs}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the study and the contract tests**

Run:
```bash
uv run python scripts/study_window.py
uv run pytest tests/test_fables_outputs.py -q
```
Expected: the script prints the chosen window and the three percentages; the tests print `2 passed`. A positive `arbVsKeeperPct` means clim loses more than the keeper at the same average fee: record it as measured in the session log.

- [ ] **Step 4: Commit**

```bash
git add lab/scripts/study_window.py lab/tests/test_fables_outputs.py lab/out/fables-window.json docs/sessions
git commit -m "feat(lab): study 2, 5 vs 15 minute volatility window against Fables' keeper"
```

### Task 11: Study 3, per-direction signal (`study_direction.py`)

**Files:**
- Create: `lab/scripts/study_direction.py`
- Modify: `lab/tests/test_fables_outputs.py` (append a test)

- [ ] **Step 1: Append the output contract test**

```python
def test_direction_output():
    d = _load("fables-direction.json")
    for key in ("instant", "desk"):
        rows = d["signals"][key]["buckets"]
        assert len(rows) == 8
        assert sum(r["n"] for r in rows) == d["swapsUsed"]
    rule = d["rule"]
    assert isinstance(rule["enabled"], bool)
    if rule["enabled"]:
        assert rule["slopeE4"] > 0 and 0 < rule["maxPremiumPips"] <= 3_000
    else:
        assert rule["slopeE4"] == 0 and rule["maxPremiumPips"] == 0
```

- [ ] **Step 2: Write the study script**

```python
"""Study 3: does the venue-versus-pool gap tell which side of Fables' pool is toxic? (offline)

    uv run python scripts/study_direction.py     # lab/out/fables-direction.json

Two signals per swap: "instant" (venue at the last closed second before the swap) and "desk" (the gap clim's desk
would have published at its last report, every 30 s with 2 s latency). Markouts at 5, 30 and 300 s measure the
trader's edge after fee. The per-direction premium rule is fitted on the desk signal only, because that is what the
desk can publish; it is enabled only if the top bucket's markout at 30 s (trader edge after fee) is at least 1 bp on at
least 200 swaps.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import DESK_LATENCY_SEC, REPORT_SEC, load_window  # noqa: E402

from clim_lab import markout as mk  # noqa: E402
from clim_lab.data import OUT_DIR  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402

MIN_TOP_SWAPS = 200
MIN_EXCESS_BP = 1.0
MAX_PREMIUM_PIPS = 3_000


def main() -> None:
    w = load_window()
    s, t, v = w.swaps, w.t, w.venue
    side = s.side
    exec_log = s.log_exec_price
    fut = {h: v.at(np.minimum(t + h - 1, v.t1)) for h in mk.HORIZONS_SEC}
    marks = {h: mk.markout_bp(side, fut[h], exec_log) for h in mk.HORIZONS_SEC}
    inst = mk.signal_bp(side, v.at(t - 1), s.log_price_before)

    t_rep = ((t - DESK_LATENCY_SEC) // REPORT_SEC) * REPORT_SEC
    desk = mk.signal_bp(side, v.at(t_rep - 1), mk.pool_price_at(t_rep, t, s.log_price))

    ok = ~np.isnan(inst) & ~np.isnan(desk)
    weight = s.notional_usd
    out_sig = {}
    for name, sig in (("instant", inst), ("desk", desk)):
        out_sig[name] = {
            "buckets": mk.bucket_table(sig[ok], {h: m[ok] for h, m in marks.items()}, weight[ok]),
            "corrMarkout30": float(np.corrcoef(sig[ok], marks[30][ok])[0, 1]),
        }

    excess30 = marks[30]  # the execution price already includes the fee
    a = mk.slope_through_origin(desk[ok], excess30[ok], weight[ok])
    top = ok & (desk >= 10.0)
    top_excess = float(np.average(excess30[top], weights=weight[top])) if top.sum() else 0.0
    enabled = bool(top.sum() >= MIN_TOP_SWAPS and top_excess >= MIN_EXCESS_BP and a > 0)
    if enabled:
        prem = a * desk[ok & (desk > 0)] * 100.0  # pips
        max_prem = int(min(MAX_PREMIUM_PIPS, round(float(np.percentile(prem, 95)))))
        slope_e4 = int(round(a * 1e4))
    else:
        max_prem, slope_e4 = 0, 0

    out = {
        "generatedAt": now_iso(),
        "swapsUsed": int(ok.sum()),
        "horizonsSec": list(mk.HORIZONS_SEC),
        "signals": out_sig,
        "rule": {
            "enabled": enabled,
            "slopeE4": slope_e4,
            "maxPremiumPips": max_prem,
            "fitOn": "desk signal (30 s reports, 2 s latency), markout at 30 s (trader edge after fee), notional-weighted",
            "topBucket": {"minSignalBp": 10.0, "swaps": int(top.sum()), "excessBp": top_excess},
            "gate": f"enabled if >= {MIN_TOP_SWAPS} swaps in the top bucket, markout at 30 s (trader edge after fee) >= {MIN_EXCESS_BP} bp and slope > 0",
            "meaning": "premium on the side the gap points to = slopeE4 * |gap in pips| / 1e4, capped at maxPremiumPips",
        },
    }
    write_json(OUT_DIR / "fables-direction.json", out)
    print(f"direction rule enabled={enabled} slopeE4={slope_e4} maxPremiumPips={max_prem}; top excess {top_excess:.2f} bp")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the study and the contract tests**

Run:
```bash
uv run python scripts/study_direction.py
uv run pytest tests/test_fables_outputs.py -q
```
Expected: the script prints the rule; the tests print `3 passed`. If the rule is disabled, that is a valid, published negative result: record it in the session log and say in plan 04/05 that the per-direction premium is shown as "measured, not enabled".

- [ ] **Step 4: Commit**

```bash
git add lab/scripts/study_direction.py lab/tests/test_fables_outputs.py lab/out/fables-direction.json docs/sessions
git commit -m "feat(lab): study 3, per-direction toxicity signal on Fables' pool"
```

### Task 12: Decide the parameters (`decide_fables_params.py`)

**Files:**
- Create: `lab/scripts/decide_fables_params.py`
- Modify: `lab/tests/test_fables_outputs.py` (append a test)

- [ ] **Step 1: Append the output contract test**

```python
def test_params_fables():
    p = SHARED_DIR / "params-fables.json"
    if not p.exists():
        pytest.skip("params-fables.json not generated yet")
    d = json.loads(p.read_text())
    assert d["feeFloorPips"] == 700 and d["feeCapPips"] == 6_000
    assert d["feeFloorPips"] <= d["feeSafePips"] <= d["feeCapPips"]
    assert d["sigmaWindowSec"] in (300, 900)
    assert d["etaE4"] > 0 and d["sqrtHalfDtE6"] > 0
    assert 0 < d["pStar"] < 1
    assert d["pokeTtlSec"] == 600 and d["tauKillSec"] == 180
    assert d["targetPoolId"] == "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551"
    assert d["decidedBy"] == "lab/scripts/decide_fables_params.py"
```

- [ ] **Step 2: Write the script**

```python
"""Decide clim x Fables parameters from the three studies (offline).

    uv run python scripts/decide_fables_params.py     # shared/params-fables.json

- dtEffSec from study 1; sqrtHalfDtE6 = round(sqrt(dt / 2) * 1e6).
- sigmaWindowSec and etaE4 from study 2 (eta at equal average fee with the keeper); pStar = 1 / (eta + 1).
- floor = Fables' flat fee (7 bp), cap = Fables' cap (60 bp), safe = 30 bp.
- per-direction premium from study 3 (or disabled).
- pokeTtlSec = 600: if clim goes quiet, Fables' pool returns to its flat fee within 10 minutes.
"""

import json

from clim_lab.data import OUT_DIR, SHARED_DIR
from clim_lab.policy import pstar_from_eta
from clim_lab.report import now_iso, write_json
from clim_lab.robin import POOL_ID
from clim_lab.units import round_half_up


def main() -> None:
    dt = json.loads((OUT_DIR / "fables-dt-eff.json").read_text())
    win = json.loads((OUT_DIR / "fables-window.json").read_text())
    dire = json.loads((OUT_DIR / "fables-direction.json").read_text())
    dt_eff = dt["chosen"]["dtEffSec"]
    w = str(win["chosenWindowSec"])
    eta_e4 = win["windows"][w]["etaE4"]
    rule = dire["rule"]
    out = {
        "targetChainId": 4663,
        "targetPoolId": POOL_ID,
        "dtEffSec": dt_eff,
        "sqrtHalfDtE6": round_half_up((dt_eff / 2.0) ** 0.5 * 1e6),
        "sigmaWindowSec": int(w),
        "etaE4": int(eta_e4),
        "pStar": pstar_from_eta(eta_e4 / 1e4, c=1.0),
        "feeFloorPips": 700,
        "feeCapPips": 6_000,
        "feeSafePips": 3_000,
        "tauKillSec": 180,
        "dirEnabled": bool(rule["enabled"]),
        "dirSlopeE4": int(rule["slopeE4"]),
        "dirMaxPremiumPips": int(rule["maxPremiumPips"]),
        "pokeTtlSec": 600,
        "decidedBy": "lab/scripts/decide_fables_params.py",
        "sources": ["lab/out/fables-dt-eff.json", "lab/out/fables-window.json", "lab/out/fables-direction.json"],
        "generatedAt": now_iso(),
    }
    write_json(SHARED_DIR / "params-fables.json", out)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it and the whole lab suite**

Run:
```bash
uv run python scripts/decide_fables_params.py
uv run pytest -q
```
Expected: the parameters are printed; pytest reports the 99 earlier tests plus the new ones passing (`… passed, 1 skipped`), with no failure.

- [ ] **Step 4: Commit**

```bash
git add lab/scripts/decide_fables_params.py lab/tests/test_fables_outputs.py shared/params-fables.json
git commit -m "feat(lab): clim x Fables parameters decided from the three studies"
```

### Task 13: Lab README section and session log

**Files:**
- Modify: `lab/README.md` (append a section)
- Modify: `docs/sessions/<today>.md`

- [ ] **Step 1: Append to `lab/README.md`**

```markdown
## clim × Fables studies (Robinhood Chain, 2026-09-07 to 2026-10-12)

Raw data (gitignored, re-downloadable, read only):

    uv run python scripts/fables_fetch.py blocks        # block-time samples; then check-clock must PASS
    uv run python scripts/fables_fetch.py check-clock
    uv run python scripts/fables_fetch.py logs          # needs ETHERSCAN_API_KEY (env or contracts/.env)
    uv run python scripts/fables_fetch.py binance
    uv run python scripts/fables_fetch.py usdt

The swap history comes from fables-farming's download (`FABLES_HISTORY_DIR`, default
`~/Development/projects/fables-farming/data/history/0xbac3aa3b`).

Studies (offline), in order:

    uv run python scripts/study_dt.py               # lab/out/fables-dt-eff.json
    uv run python scripts/study_window.py           # lab/out/fables-window.json
    uv run python scripts/study_direction.py        # lab/out/fables-direction.json
    uv run python scripts/decide_fables_params.py   # shared/params-fables.json

What each one answers:

1. **Effective arbitrage interval.** Robinhood Chain makes a block every ~0.1 s; arbitrageurs do not trade every
   block. Δt is solved from the observed arbitrage rate (MMR 2023 with c = 1, Nezlobin-Tassy 2025 with c = 0.824),
   fitted on three weeks and checked on the next two, with the venue-exit-to-arbitrage delays as a second estimate.
2. **Volatility window.** 5 or 15 minutes, at the same average fee as Fables' keeper: correlation with the keeper
   and arbitrage loss on a 1 s grid, published as measured.
3. **Per-direction signal.** Whether the venue-versus-pool gap the desk can publish every 30 s predicts flow that
   beats the fee (markouts at 5, 30 and 300 s). The premium rule is enabled only if it clears a stated gate.
```

- [ ] **Step 2: Add the results to the session log**

Append to `docs/sessions/<today>.md` one line per study with the numbers the scripts printed (Δt chosen, delay mean, test-week ratio; chosen window and the three arbitrage percentages; direction rule enabled or not with the top-bucket excess), and the final `shared/params-fables.json` values.

- [ ] **Step 3: Commit and push**

```bash
git add lab/README.md docs/sessions
git commit -m "docs(lab): clim x Fables studies and their results"
git push
```
