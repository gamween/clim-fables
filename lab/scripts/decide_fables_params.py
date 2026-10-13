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
