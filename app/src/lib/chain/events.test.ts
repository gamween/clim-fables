import { climPokerAbi, pokeFeeHookAbi, poolManagerSwapEventAbi, riskDeskV2Abi } from "@clim/shared";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { FEE_POKED, FEE_POKED_DIRECTIONAL, hookViewAbi, POKED, RISK_REPORTED_V2, SWAP } from "./events";

const events = (abi: readonly unknown[]) => (abi as Array<{ type: string }>).filter((x): x is AbiEvent => x.type === "event");
const fns = (abi: readonly unknown[]) => (abi as Array<{ type: string }>).filter((x): x is AbiFunction => x.type === "function");

describe("event signatures match shared/'s ABIs", () => {
  it("FeePoked, both variants, as in PokeFeeHook (Fables' single-fee FeePoked has the same signature)", () => {
    const sel = events(pokeFeeHookAbi).map((e) => toEventSelector(e));
    expect(sel).toContain(toEventSelector(FEE_POKED));
    expect(sel).toContain(toEventSelector(FEE_POKED_DIRECTIONAL));
    expect(toEventSelector(FEE_POKED)).toBe("0xcb123ffca193ebeb3d5c30d267785371dd417ff0084b636bff5d03f87a2c8e04");
  });
  it("Swap, Poked and RiskReportedV2", () => {
    expect(toEventSelector(SWAP)).toBe(toEventSelector(events(poolManagerSwapEventAbi)[0] as AbiEvent));
    expect(toEventSelector(POKED)).toBe(toEventSelector(events(climPokerAbi)[0] as AbiEvent));
    expect(toEventSelector(RISK_REPORTED_V2)).toBe(toEventSelector(events(riskDeskV2Abi)[0] as AbiEvent));
  });
  it("currentFee(bytes32,bool)", () => {
    expect(toFunctionSelector(hookViewAbi[0])).toBe(toFunctionSelector(fns(pokeFeeHookAbi).find((f) => f.name === "currentFee") as AbiFunction));
  });
});
