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
