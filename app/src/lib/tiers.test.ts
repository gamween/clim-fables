import { describe, expect, it } from "vitest";
import { deskBadge, FEE_SOURCE, feeTier, feeTooltip, modeLabel } from "./tiers";

describe("feeTier", () => {
  it("marks a fee above the flat fee as Elevated", () => expect(feeTier(5000, 700)).toEqual({ label: "Elevated", tone: "elevated" }));
  it("shows no badge at the flat fee or below", () => {
    expect(feeTier(700, 700)).toBeNull();
    expect(feeTier(350, 700)).toBeNull();
    expect(feeTier(null, 700)).toBeNull();
  });
});

describe("feeTooltip", () => {
  it("explains an override", () => expect(feeTooltip(5000, 5000, 700)).toMatch(/raised above its schedule/));
  it("explains the resting fee", () => expect(feeTooltip(700, 700, 700)).toBe("The fee this market charges on every swap right now"));
  it("explains two directions", () => expect(feeTooltip(700, 897, 700)).toMatch(/two directions cost different amounts/));
});

describe("deskBadge", () => {
  it("is live while fresh and normal", () => expect(deskBadge(0, 20, 180)).toEqual({ label: "clim: live", tone: "open" }));
  it("is degraded when venues disagree", () => expect(deskBadge(1, 20, 180).label).toBe("clim: degraded"));
  it("is blind past tauKillSec even before the policy says so", () => expect(deskBadge(0, 181, 180).label).toBe("clim: blind"));
  it("is blind when the policy says so", () => expect(deskBadge(2, 0, 180).label).toBe("clim: blind"));
});

it("names every market's fee source, and every clim-side source says testnet", () => {
  expect(Object.keys(FEE_SOURCE)).toEqual(["fables", "D", "K", "F"]);
  expect(FEE_SOURCE.fables.note).toMatch(/mainnet, read only/);
  for (const k of ["D", "K", "F"] as const) expect(FEE_SOURCE[k].note).toMatch(/testnet/);
});

it("labels the policy's modes", () => {
  expect([modeLabel("normal"), modeLabel("degraded"), modeLabel("blind")]).toEqual(["Normal", "Degraded", "Blind"]);
});
