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
