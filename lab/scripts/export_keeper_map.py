"""The keeper-style twin's fee map (offline): how Fables' keeper set its ETH/USDG fee against 5-minute volatility.

    uv run python scripts/export_keeper_map.py     # shared/keeper-map-fables.json

Pool K on Robinhood Chain testnet is poked by a small bot (bots/src/live/keeper.ts) that imitates the pattern observed
on Fables' pool: about every 180 s, the fee this table gives at the current 5-minute realized volatility, with a
7,200 s TTL. It is an imitation of the observed pattern, not Fables' code (which is not public).
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import END, START, load_window  # noqa: E402

from clim_lab.constants import SECONDS_PER_YEAR  # noqa: E402
from clim_lab.data import SHARED_DIR  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.venue import rv_window  # noqa: E402

EDGES_PCT_YR = [0, 20, 30, 40, 50, 60, 80, 100, 150, 200]  # bin i is [edge i, edge i+1); the last is open-ended
CLAMP = (700, 6_000)


def main() -> None:
    w = load_window()
    pokes = sorted((p for p in w.pokes if START <= p.t < END), key=lambda p: p.key)
    t = np.array([p.t for p in pokes], dtype=np.int64)
    fee = np.array([p.fee_pips for p in pokes], dtype=np.int64)
    sigma = rv_window(w.venue, t, window_sec=300, step_sec=5)
    pct = sigma * np.sqrt(SECONDS_PER_YEAR) * 100
    bins = np.searchsorted(np.array(EDGES_PCT_YR, dtype=np.float64), pct, side="right") - 1
    medians: list[int | None] = []
    samples: list[int] = []
    for i in range(len(EDGES_PCT_YR)):
        sel = fee[bins == i]
        samples.append(int(len(sel)))
        medians.append(int(np.median(sel)) if len(sel) else None)
    filled, prev = [], CLAMP[0]
    for m in medians:  # an empty bin takes the bin below it
        prev = prev if m is None else m
        filled.append(prev)
    fee_pips = np.clip(np.maximum.accumulate(np.array(filled, dtype=np.int64)), *CLAMP)
    gaps = np.diff(t)
    ttl = np.array([p.expiry - p.t for p in pokes], dtype=np.int64)
    out = {
        "generatedAt": now_iso(),
        "source": "lab/scripts/export_keeper_map.py",
        "what": (
            "Fee of the keeper-style twin (pool K) by 5-minute volatility: the median fee Fables' keeper posted on its "
            "ETH/USDG pool in each volatility bin, 2026-09-07 to 2026-10-12. An imitation of the observed pattern, "
            "not Fables' code."
        ),
        "sigma": "RV over 300 s from 5 s returns of Binance ETHUSDT 1 s, as each poke was posted (lab estimator)",
        "pokes": int(len(pokes)),
        "edgesPctYr": EDGES_PCT_YR,
        "medianFeePips": medians,
        "samples": samples,
        "feePips": [int(f) for f in fee_pips],
        "clampPips": list(CLAMP),
        "postEverySec": int(np.median(gaps)),
        "ttlSec": int(np.median(ttl)),
    }
    write_json(SHARED_DIR / "keeper-map-fables.json", out)
    print(f"{len(pokes)} pokes; fee by bin {out['feePips']}; every {out['postEverySec']} s, TTL {out['ttlSec']} s")


if __name__ == "__main__":
    main()
