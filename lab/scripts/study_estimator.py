"""Plan 03 Task 2: which volatility estimator the live CRE desk computes (offline).

    uv run python scripts/study_estimator.py     # lab/out/fables-estimator.json

The lab calibrated clim's fee on Binance 1 s prices (5 s returns), which the desk cannot read from four venues. Three
desk-feasible estimators are compared on the five-week window, each at equal average fee with Fables' keeper, with the
machinery of study 2 (scripts/study_window.py): reports every 30 s with 2 s latency, the myopic arbitrageur on the 1 s
venue path, and the keeper's own fee path as the reference.

- median-close: realized volatility of the cross-venue median of 1-minute closes;
- venue-range: median across venues of each venue's Parkinson volatility on its 1-minute high and low;
- binance-1s: the lab's estimator (Binance 1 s, 5 s returns), which the desk can fetch from Binance alone.

Venues replayed: Binance (USDT converted with Coinbase USDT-USD), Coinbase, Kraken (minutes rebuilt from trades).
Hyperliquid serves only its last 5,000 one-minute candles, so it cannot be replayed; the live desk uses it as a fourth
venue. The rule (clim_lab.policy.choose_estimator) is fixed before the run.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fables_load import DESK_LATENCY_SEC, END, RAW, REPORT_SEC, START, keeper_fee_per_second, load_window  # noqa: E402

from clim_lab import venue  # noqa: E402
from clim_lab.constants import SECONDS_PER_YEAR  # noqa: E402
from clim_lab.data import OUT_DIR, load_1m_pairs_json  # noqa: E402
from clim_lab.desk import log_bands  # noqa: E402
from clim_lab.policy import calibrate_eta, choose_estimator, policy_fee_pips  # noqa: E402
from clim_lab.report import now_iso, write_json  # noqa: E402
from clim_lab.sim import run_arb  # noqa: E402

FLOOR, CAP = 700, 6_000
ESTIMATORS = ("median-close", "venue-range", "binance-1s")


def _ranks(x: np.ndarray) -> np.ndarray:
    r = np.empty(len(x))
    r[np.argsort(x, kind="stable")] = np.arange(len(x))
    return r


def _venues() -> list[venue.MinuteOhlc]:
    usdt = load_1m_pairs_json(RAW / "usdtusd_1m.json")

    def rows(name: str):
        # Binance's day files start before the USDT-USD minutes (fetched from START - 3,600): keep the study span
        return [r for r in json.loads((RAW / f"{name}_1m.json").read_text()) if START - 3_600 <= r[0] < END + 600]

    return [
        venue.ohlc_from_rows(rows("binance_ethusdt"), usd_per_quote=usdt),
        venue.ohlc_from_rows(rows("coinbase_ethusd")),
        venue.ohlc_from_rows(rows("kraken_ethusd")),
    ]


def main() -> None:
    dt = json.loads((OUT_DIR / "fables-dt-eff.json").read_text())["chosen"]["dtEffSec"]
    win = int(json.loads((OUT_DIR / "fables-window.json").read_text())["chosenWindowSec"])
    w = load_window()
    seconds = np.arange(START, END, dtype=np.int64)
    keeper = keeper_fee_per_second(w, START, END).astype(np.float64)
    t_obs = np.arange(START - REPORT_SEC, END, REPORT_SEC, dtype=np.int64)
    rep_idx = np.searchsorted(t_obs + DESK_LATENCY_SEC, seconds, side="right") - 1
    keeper_rep = keeper[np.clip(t_obs + DESK_LATENCY_SEC - START, 0, len(keeper) - 1)]
    x = w.venue.at(seconds)

    def arb(fee_pips: np.ndarray, step: int = 1) -> float:
        # the arbitrageur acts every `step` seconds on the subsampled venue path and fees (as study 2's sensitivity)
        return run_arb(x[::step], log_bands(fee_pips[::step])).arb

    arb_keeper = arb(keeper)
    arb_keeper_15 = arb(keeper, 15)

    venues = _venues()
    sig = {
        "median-close": venue.median_close_rv(venues, t_obs, win),
        "venue-range": venue.range_rv(venues, t_obs, win),
        "binance-1s": venue.rv_window(w.venue, t_obs, window_sec=win, step_sec=5),
    }
    est = {}
    for name in ESTIMATORS:
        s = sig[name]
        s_sec = s[rep_idx]
        eta = calibrate_eta(s_sec, dt, FLOOR, CAP, keeper.mean())
        fee_sec = policy_fee_pips(s_sec, eta, dt, FLOOR, CAP)
        fee_rep = policy_fee_pips(s, eta, dt, FLOOR, CAP)
        est[name] = {
            "etaE4": int(round(eta * 1e4)),
            "meanFeeBp": float(fee_sec.mean() / 100),
            "meanSigmaPctYr": float(s.mean() * np.sqrt(SECONDS_PER_YEAR) * 100),
            "corrWithBinance1s": float(np.corrcoef(s, sig["binance-1s"])[0, 1]),
            "corrKeeper": {
                "pearson": float(np.corrcoef(fee_rep, keeper_rep)[0, 1]),
                "spearman": float(np.corrcoef(_ranks(fee_rep), _ranks(keeper_rep))[0, 1]),
            },
            "sharePctAtFloor": float(100 * (fee_sec <= FLOOR).mean()),
            "sharePctAtCap": float(100 * (fee_sec >= CAP).mean()),
            "arbVsKeeperPct": float(100 * (arb(fee_sec) / arb_keeper - 1)),
            "arbVsKeeperPctEvery15s": float(100 * (arb(fee_sec, 15) / arb_keeper_15 - 1)),
        }
    chosen = choose_estimator(est)
    out = {
        "generatedAt": now_iso(),
        "window": {"start": int(START), "end": int(END)},
        "dtEffSec": dt,
        "windowSec": win,
        "keeper": {"meanFeeBp": float(keeper.mean() / 100)},
        "venues": [
            "binance (ETHUSDT 1 min, USDT converted with Coinbase USDT-USD)",
            "coinbase (ETH-USD 1 min)",
            "kraken (ETHUSD 1 min rebuilt from the public trade history)",
        ],
        "excluded": {
            "hyperliquid": "its API serves only the last 5,000 one-minute candles, so the window cannot be replayed",
        },
        "estimators": est,
        "chosen": chosen,
        "chosenEtaE4": est[chosen]["etaE4"],
        "rule": (
            "prefer a multi-venue estimator (median-close or venue-range): the lower arbitrage loss at equal average "
            "fee, within 1 point the higher Pearson correlation with the keeper; binance-1s only if it loses less "
            "than that estimator by more than 1 point"
        ),
        "caveats": [
            "three venues replayed, four live (Hyperliquid has no history); the live median can differ slightly",
            "the simulated arbitrageur trades on the Binance 1 s path binance-1s is computed from, which favours "
            "binance-1s (study 2's caveat); the rule's 1-point margin for a multi-venue estimator is partly for this",
            "1 s grid: the simulator ranks estimators, it does not predict dollars; arbVsKeeperPctEvery15s (the "
            "arbitrageur acting every 15 s) is reported as robustness and not used by the rule",
            "in-sample: eta is fitted on the same five weeks the comparison runs on; one price path, no confidence interval",
        ],
    }
    write_json(OUT_DIR / "fables-estimator.json", out)
    print(f"chosen {chosen} (etaE4 {est[chosen]['etaE4']}); arbitrage vs keeper "
          f"{ {k: round(v['arbVsKeeperPct'], 2) for k, v in est.items()} }")


if __name__ == "__main__":
    main()
