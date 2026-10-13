"""Fables ETH/USDG on Robinhood Chain: swap history, block timestamps and pool prices.

The swap history is fables-farming's download (src/research/fetch-history.ts): ndjson files named
"<firstBlock>-<lastBlock>.ndjson", one event per line. Swap amounts are the Uniswap v4 Swap event's, from the swapper's
side: amount0 < 0 means the swapper paid ETH into the pool (zeroForOne, the pool price falls). The pool is native ETH
(18 decimals) / USDG (6 decimals), so the price in USDG per ETH is (sqrtPriceX96 / 2^96)^2 * 1e12.

The history has no timestamps. BlockClock maps blocks to unix seconds from sampled (block, timestamp) pairs read over
RPC (scripts/fables_fetch.py blocks), by linear interpolation rounded down; `fables_fetch.py check-clock` measures the
error against exact block timestamps.
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
    fee_pips: np.ndarray  # int64, LP fee charged

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
        return np.floor(np.interp(b, self.block, self.ts)).astype(np.int64)

    def block_at(self, t: int) -> int:
        """First sampled block whose timestamp is at or after t (for selecting a block range)."""
        i = int(np.searchsorted(self.ts, t, side="left"))
        if i >= len(self.ts):
            raise ValueError("time after the sampled range")
        return int(self.block[i])
