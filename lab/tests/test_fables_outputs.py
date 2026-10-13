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
