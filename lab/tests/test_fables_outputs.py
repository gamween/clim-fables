"""Contracts of the clim x Fables study outputs (lab/out/fables-*.json, shared/params-fables.json)."""

import json

import pytest

from clim_lab.data import OUT_DIR, SHARED_DIR


def _load(name):
    p = OUT_DIR / name
    if not p.exists():
        pytest.skip(f"{name} not generated yet")
    return json.loads(p.read_text())


def test_dt_eff_output():
    d = _load("fables-dt-eff.json")
    assert d["window"]["start"] == "2026-09-07T00:00:00Z" and d["window"]["end"] == "2026-10-12T00:00:00Z"
    assert d["arbEvents"] > 1_000
    assert len(d["weekly"]) == 5
    assert 0.01 < d["chosen"]["dtEffSec"] < 600
    assert d["holdout"]["fitWeeks"] == [0, 1, 2] and d["holdout"]["testWeeks"] == [3, 4]
    assert d["holdout"]["predictedOverObserved"] > 0
    assert d["delay"]["meanSec"] >= 0
    assert "all weeks" in d["hourly"]["scope"] and "fit weeks" in d["chosen"]["scope"]
    sens = d["sensitivity"]
    assert set(sens["zShiftBp"]) == {"-1", "+1"}
    for v in list(sens["zShiftBp"].values()) + [sens["eventPerSecondSide"]]:
        assert len(v["weeklyDtSecPoisson"]) == 5
        assert v["dtSecFitWeeks"] > 0 and v["predictedOverObserved"] > 0 and -1 <= v["hourlyCorr"] <= 1
    assert any("Jensen" in c for c in d["caveats"])
    assert d["framing"].startswith("dt_eff is of order") and "<" not in d["framing"]


def test_window_output():
    d = _load("fables-window.json")
    assert set(d["windows"]) == {"300", "900"}
    for k in ("300", "900"):
        w = d["windows"][k]
        assert w["etaE4"] > 0
        assert -1 <= w["corrKeeper"]["pearson"] <= 1 and -1 <= w["corrKeeper"]["spearman"] <= 1
        assert w["meanFeeBp"] == pytest.approx(d["keeper"]["meanFeeBp"], rel=0.01)
    assert d["chosenWindowSec"] in (300, 900)
    assert "flat7" in d["arbVsKeeperPct"]
    sens = d["sensitivity"]
    assert set(sens["arbCadenceSec"]) == {"1", "2", "15"}
    for step in sens["arbCadenceSec"].values():
        assert set(step["arbVsKeeperPct"]) == {"300", "900", "flat7"}
    assert sens["arbCadenceSec"]["1"]["arbVsKeeperPct"] == d["arbVsKeeperPct"]
    assert len(sens["weekly"]) == 5 and all("arbVsKeeperPct" in r for r in sens["weekly"])
    fpd = sens["feePerDollar"]
    assert fpd["keeperPaidBp"] > 0 and fpd["keeperPostedBp"] > 0 and fpd["climBp"] > 0
    assert set(sens["sigmaEnvelope"]) == {"300", "900"}
    caveats = " ".join(d["caveats"])
    for word in ("in-sample", "confidence interval", "same Binance", "envelope"):
        assert word in caveats
    assert d["framing"].startswith("At equal time-average fee") and d["framing"].endswith("Not a claim of better fees.")
    assert "<" not in d["framing"]


def test_direction_output():
    d = _load("fables-direction.json")
    for key in ("instant", "desk"):
        rows = d["signals"][key]["buckets"]
        assert len(rows) == 8
        assert sum(r["n"] for r in rows) == d["swapsUsed"]
    dec = d["signals"]["desk"]["decomposition30"]
    assert len(dec["buckets"]) == 8
    for r in dec["buckets"]:
        if r["n"]:
            assert r["markout30Bp"] == pytest.approx(r["gapCaptureBp"] + r["laterMoveBp"] - r["costBp"], abs=1e-6)
    assert -1 <= dec["corrSignalGap"] <= 1 and -1 <= dec["corrSignalLaterMove"] <= 1
    rule = d["rule"]
    assert isinstance(rule["enabled"], bool)
    if rule["enabled"]:
        assert rule["slopeE4"] > 0 and 0 < rule["maxPremiumPips"] <= 3_000
    else:
        assert rule["slopeE4"] == 0 and rule["maxPremiumPips"] == 0
    assert len(rule["weekly"]) == 5
    assert rule["stableWeeks"] == sum(r["passesGate"] for r in rule["weekly"])
    if not rule["enabled"]:
        assert rule["status"] == "disabled"
    else:
        assert rule["status"] == ("stable" if rule["stableWeeks"] >= 4 else "experimental")
    assert d["framing"].startswith("Trades toward the venue") and "<" not in d["framing"]


def test_params_fables():
    p = SHARED_DIR / "params-fables.json"
    if not p.exists():
        pytest.skip("params-fables.json not generated yet")
    d = json.loads(p.read_text())
    assert d["feeFloorPips"] == 700 and d["feeCapPips"] == 6_000
    assert d["feeFloorPips"] <= d["feeSafePips"] <= d["feeCapPips"]
    assert d["sigmaWindowSec"] in (300, 900)
    assert d["etaE4"] > 0 and d["sqrtHalfDtE6"] > 0
    assert 0 < d["pStar"] < 1
    assert d["pokeTtlSec"] == 600 and d["tauKillSec"] == 180
    assert d["targetPoolId"] == "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551"
    assert d["decidedBy"] == "lab/scripts/decide_fables_params.py"
