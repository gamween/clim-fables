"""Study 2: which volatility window, 5 or 15 minutes, for clim's fee on Fables' pool (offline).

    uv run python scripts/study_window.py     # lab/out/fables-window.json

The desk reports every 30 s. For each window, eta is set so clim's fee averages the keeper's fee over the five weeks
(equal average fee). Then: correlation with the keeper's fee at report times, and arbitrage loss on a 1 s grid
(sim.run_arb, myopic arbitrageur) relative to the keeper's own fee path, plus a flat 7 bp pool. The sensitivity
block reruns the arbitrage comparison with the arbitrageur acting every 1, 2 and 15 s, per week for the chosen
window, with the on-chain sigma envelope applied, and compares the fee per dollar traded.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import DESK_LATENCY_SEC, END, REPORT_SEC, START, WEEK, keeper_fee_per_second, load_window  # noqa: E402

from clim_lab.data import OUT_DIR  # noqa: E402
from clim_lab.desk import log_bands  # noqa: E402
from clim_lab.fee import envelope  # noqa: E402
from clim_lab.policy import calibrate_eta, policy_fee_pips  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.sim import run_arb  # noqa: E402
from clim_lab.units import sigma_e9_from_per_sqrt_s  # noqa: E402
from clim_lab.venue import rv_window  # noqa: E402

FLOOR, CAP, FLAT = 700, 6_000, 700
WINDOWS = (300, 900)
ARB_STEPS_SEC = (1, 2, 15)


def _ranks(x: np.ndarray) -> np.ndarray:
    r = np.empty(len(x))
    r[np.argsort(x, kind="stable")] = np.arange(len(x))
    return r


def _enveloped_e9(sig_rep: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(reported, applied) sigma in 1e-9 per sqrt second: applied is after RiskDeskV2's envelope (x2 up, x0.8 down per
    report; reports are 30 s apart, so only the first one gets the absolute bounds alone)."""
    raw = np.array([sigma_e9_from_per_sqrt_s(float(s)) for s in sig_rep], dtype=np.int64)
    out = np.empty_like(raw)
    prev = 0
    for i, s in enumerate(raw.tolist()):
        prev = envelope(s, prev)
        out[i] = prev
    return raw, out


def _pct(x: float) -> str:
    return f"{x:+.1f} %"


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

    def arb(fee_pips: np.ndarray, step: int = 1, sl: slice = slice(None)) -> float:
        return run_arb(x[sl][::step], log_bands(fee_pips[sl][::step])).arb

    arb_keeper = arb(keeper)
    fees = {"keeper": keeper}
    sig_reps = {}
    out_w = {}
    arb_vs = {}
    for win in WINDOWS:
        sig_rep = rv_window(w.venue, t_obs, window_sec=win, step_sec=5)
        sig_reps[win] = sig_rep
        sig_sec = sig_rep[rep_idx]
        eta = calibrate_eta(sig_sec, dt, FLOOR, CAP, keeper.mean())
        fee_sec = policy_fee_pips(sig_sec, eta, dt, FLOOR, CAP)
        fees[str(win)] = fee_sec
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
    fees["flat7"] = np.full(len(seconds), FLAT, dtype=np.float64)
    arb_vs["flat7"] = float(100 * (arb(fees["flat7"]) / arb_keeper - 1))

    best = min(WINDOWS, key=lambda k: arb_vs[str(k)])
    other = [k for k in WINDOWS if k != best][0]
    if abs(arb_vs[str(best)] - arb_vs[str(other)]) < 1.0:
        best = max(WINDOWS, key=lambda k: out_w[str(k)]["corrKeeper"]["pearson"])
    clim = fees[str(best)]

    # (a) arbitrage cadence: the arbitrageur acts every `step` seconds on the subsampled venue path and fees
    cadence = {"1": {"keeperRelStep1": 1.0, "arbVsKeeperPct": dict(arb_vs)}}
    for step in ARB_STEPS_SEC:
        if step == 1:
            continue
        k_arb = arb(keeper, step)
        cadence[str(step)] = {
            "keeperRelStep1": float(k_arb / arb_keeper),
            "arbVsKeeperPct": {n: float(100 * (arb(fees[n], step) / k_arb - 1)) for n in ("300", "900", "flat7")},
        }

    # (b) per week, chosen window against the keeper
    weekly = []
    n_weeks = (END - START) // WEEK
    for k in range(n_weeks):
        sl = slice(k * WEEK, (k + 1) * WEEK)
        weekly.append(
            {
                "weekStart": datetime.fromtimestamp(START + k * WEEK, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "keeperMeanFeeBp": float(keeper[sl].mean() / 100),
                "climMeanFeeBp": float(clim[sl].mean() / 100),
                "arbVsKeeperPct": float(100 * (arb(clim, 1, sl) / arb(keeper, 1, sl) - 1)),
            }
        )

    # (c) fee per dollar traded: each swap's fee weighted by its notional
    ts = w.t - START
    notional = w.swaps.notional_usd
    per_dollar = {
        "keeperPaidBp": float(np.average(w.swaps.fee_pips, weights=notional) / 100),
        "keeperPostedBp": float(np.average(keeper[ts], weights=notional) / 100),
        "climBp": float(np.average(clim[ts], weights=notional) / 100),
        "note": "notional-weighted mean fee over the window's swaps: keeperPaid is the fee each swap paid, keeperPosted the keeper's resolved fee at the swap's second, clim the fee clim's rule would have posted at that second",
    }

    # on-chain sigma envelope (RiskDeskV2), recalibrated at equal average fee
    env = {}
    for win in WINDOWS:
        raw_e9, env_e9 = _enveloped_e9(sig_reps[win])
        sig_sec = (env_e9 / 1e9)[rep_idx]
        eta = calibrate_eta(sig_sec, dt, FLOOR, CAP, keeper.mean())
        env[str(win)] = {
            "etaE4": int(round(eta * 1e4)),
            "reportsClampedPct": float(100 * (env_e9 != raw_e9).mean()),
            "arbVsKeeperPct": float(100 * (arb(policy_fee_pips(sig_sec, eta, dt, FLOOR, CAP)) / arb_keeper - 1)),
        }

    label = f"{best // 60}-minute"
    framing = (
        f"At equal time-average fee, clim's {label} rule and the keeper are comparable: "
        f"{_pct(cadence['1']['arbVsKeeperPct'][str(best)])} arbitrage loss with arbitrage every second, "
        f"{_pct(cadence['15']['arbVsKeeperPct'][str(best)])} every 15 s; clim charges {per_dollar['climBp']:.2f} bp per "
        f"dollar traded vs the keeper's {per_dollar['keeperPaidBp']:.2f} bp. Not a claim of better fees."
    )
    out = {
        "generatedAt": now_iso(),
        "dtEffSec": dt,
        "keeper": {"meanFeeBp": float(keeper.mean() / 100), "medianFeeBp": float(np.median(keeper) / 100)},
        "windows": out_w,
        "arbVsKeeperPct": arb_vs,
        "chosenWindowSec": int(best),
        "rule": "lower arbitrage loss at equal average fee; within 1 point, higher Pearson correlation with the keeper",
        "sensitivity": {
            "arbCadenceSec": cadence,
            "arbCadenceNote": "arbitrageur acting every 1, 2 or 15 s: venue path and per-second fees subsampled at that step; percentages against the keeper at the same step; keeperRelStep1 is the keeper's loss relative to step 1",
            "weekly": weekly,
            "weeklyNote": f"chosen window ({best} s) against the keeper, each week simulated on its own; eta stays the five-week value, so weekly mean fees differ",
            "feePerDollar": per_dollar,
            "sigmaEnvelope": env,
            "sigmaEnvelopeNote": "RiskDeskV2's envelope (x2 up, x0.8 down per report, absolute bounds) applied to each report, eta recalibrated at equal average fee",
        },
        "caveats": [
            "1 s grid: the simulator cannot see sub-second races; it ranks policies, it does not predict dollars",
            "the keeper's path is replayed as posted; clim's fee follows reports every 30 s with 2 s latency",
            "in-sample: eta is fitted on the same five weeks the comparison runs on",
            "no confidence interval: one price path and one run per policy",
            "sigma comes from the same Binance (USD) path that drives the simulated arbitrageur, which can favour a sigma-driven fee; the live desk reads four venues",
            f"the on-chain sigma envelope is not modelled in the headline numbers; applied, it moves the {label} result from "
            f"{arb_vs[str(best)]:.2f} % to {env[str(best)]['arbVsKeeperPct']:.2f} % (sensitivity.sigmaEnvelope)",
        ],
        "framing": framing,
    }
    write_json(OUT_DIR / "fables-window.json", out)
    print(f"chosen window {best} s; arbitrage vs keeper {arb_vs}")
    print(framing)


if __name__ == "__main__":
    main()
