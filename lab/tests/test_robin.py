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
