"""Desk reports for the fork run (offline): what clim's live desk would have published every 30 s on 2026-10-07,
01:40-03:10 UTC, with the volatility estimator it computes (sigmaEstimator in shared/params-fables.json) and Fables'
pool prices.

    uv run python scripts/export_fork_reports.py     # docs/evidence/fork-reports-2026-10-07.json

Fields are parallel arrays so Foundry reads them with parseJsonUintArray / parseJsonIntArray. sigma15E9 and sigma5E9
come from the live estimator through scripts/study_estimator.py's loaders: venue-range and median-close on the
1-minute candles of Binance (USDT converted to USD), Coinbase and Kraken (Hyperliquid has no history), binance-1s on
Binance 1 s. devPips is Binance 1 s (USD) against the pool; the run's symmetric poker uses no directional premium, so
it does not move the fee. Three venues stand in for the live desk's four; the run script (ForkRun.s.sol) fixes dispBp
3, nSources 4 and kE4 10000 in every report so the desk accepts it, and the file says so.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import RAW, load_window  # noqa: E402
from study_estimator import desk_sigma, minute_venues  # noqa: E402

from clim_lab import markout as mk  # noqa: E402
from clim_lab import robin  # noqa: E402
from clim_lab.data import LAB_DIR, SHARED_DIR  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.units import sigma_e9_from_per_sqrt_s  # noqa: E402

START = 1_791_337_200  # 2026-10-07 01:40:00 UTC
END = 1_791_342_600  # 2026-10-07 03:10:00 UTC
OUT = LAB_DIR.parent / "docs" / "evidence" / "fork-reports-2026-10-07.json"


def main() -> None:
    estimator = json.loads((SHARED_DIR / "params-fables.json").read_text())["sigmaEstimator"]
    w = load_window()
    venues = minute_venues()
    t_obs = np.arange(START, END, 30, dtype=np.int64)
    s15 = desk_sigma(estimator, w, venues, t_obs, 900)
    s5 = desk_sigma(estimator, w, venues, t_obs, 300)
    pool = mk.pool_price_at(t_obs, w.t, w.swaps.log_price)
    dev = (np.exp(w.venue.at(t_obs - 1) - pool) - 1.0) * 1e6
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    out = {
        "generatedAt": now_iso(),
        "window": {"start": int(START), "end": int(END)},
        "forkBlock": clock.block_at(START - 120),  # last sampled block at or before 2 minutes ahead of the first report, so the run only warps forward
        "sigmaEstimator": estimator,
        "note": (
            f"lab replay: sigma15E9 and sigma5E9 from the live desk's estimator ({estimator}, sigmaEstimator in "
            "shared/params-fables.json), on the 1-minute candles of Binance (ETHUSDT converted to USD), Coinbase and "
            "Kraken for the multi-venue estimators; devPips from Binance 1 s (USD) against the pool (no effect on "
            "this symmetric run); because three replayed venues stand in for the live desk's four, the run fixes "
            "dispBp 3, nSources 4 and kE4 10000 in every report"
        ),
        "tObs": [int(t) for t in t_obs],
        "sigma15E9": [sigma_e9_from_per_sqrt_s(float(x)) for x in s15],
        "sigma5E9": [sigma_e9_from_per_sqrt_s(float(x)) for x in s5],
        "devPips": [int(round(float(x))) for x in dev],
    }
    write_json(OUT, out)
    print(
        f"{len(t_obs)} reports, fork block {out['forkBlock']}, sigma from {estimator}, "
        f"peak sigma5 {max(out['sigma5E9'])}"
    )


if __name__ == "__main__":
    main()
