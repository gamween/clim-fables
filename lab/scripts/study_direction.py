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
