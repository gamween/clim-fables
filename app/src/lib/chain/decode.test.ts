import { describe, expect, it } from "vitest";
import { climPointFrom, pokeFromClimPoint, pokeFromDirectional, pokeFromSingle, reportFrom, swapFrom } from "./decode";

const m = { blockNumber: 7n, logIndex: 2, transactionHash: "0xaa" as const };
const ETH_USDG = { token0IsEth: true, decimals0: 18, decimals1: 6 };

describe("decoders", () => {
  it("reads a single-fee FeePoked as both directions", () => {
    expect(pokeFromSingle({ ...m, args: { fee: 1468, expiry: 1791975879 } }, 1791968679)).toEqual({ kind: "poke", t: 1791968679, block: 7n, logIndex: 2, tx: "0xaa", fee0For1: 1468, fee1For0: 1468, expiry: 1791975879 });
  });
  it("keeps a directional FeePoked's two fees", () => {
    const p = pokeFromDirectional({ ...m, args: { fee0For1: 700, fee1For0: 897, expiry: 1 } }, 0);
    expect([p.kind === "poke" && p.fee0For1, p.kind === "poke" && p.fee1For0]).toEqual([700, 897]);
  });
  it("reads a Poked log as clim's point, at its observation time", () => {
    const point = climPointFrom({ ...m, args: { seq: 78, tObs: 1791968619, fee0For1: 700, fee1For0: 897, mode: 0, eventApplied: false, expiry: 1791969219 } });
    expect(point).toEqual({ t: 1791968619, block: 7n, logIndex: 2, seq: 78, fee0For1: 700, fee1For0: 897, mode: 0, eventApplied: false, expiry: 1791969219, tx: "0xaa" });
    expect(pokeFromClimPoint(point)).toEqual({ kind: "poke", t: 1791968619, block: 7n, logIndex: 2, tx: "0xaa", fee0For1: 700, fee1For0: 897, expiry: 1791969219 });
  });
  it("reads a desk report", () => {
    const r = reportFrom({ ...m, args: { seq: 81, tObs: 1791969493, sigma15Applied: 35825, sigma5Applied: 39278, devPips: -37, nSources: 4, flags: 0 } });
    expect([r.t, r.seq, r.tObs, r.sigma5E9, r.devPips]).toEqual([1791969493, 81, 1791969493, 39278, -37]);
  });
  it("refuses a pending log", () => {
    expect(() => pokeFromSingle({ ...m, blockNumber: null, args: { fee: 1, expiry: 2 } }, 0)).toThrow("pending log");
  });
});

describe("swapFrom", () => {
  // sqrtPriceX96 of the ETH/USDG pool read on 2026-10-14: about 2,477 USDG per ETH.
  const sqrtPriceX96 = 3943055827863068952403550n;
  it("is a buy when the swapper receives ETH", () => {
    const s = swapFrom({ ...m, args: { amount0: 3_080_000_000_000_000n, amount1: -7_629_000n, fee: 700, sqrtPriceX96 } }, ETH_USDG);
    expect([s.side, s.eth, s.usdg, s.feePips, s.block]).toEqual(["buy", 0.00308, 7.629, 700, 7n]);
    expect(Math.round(s.price)).toBe(2477);
  });
  it("is a sell when the swapper pays ETH", () => {
    expect(swapFrom({ ...m, args: { amount0: -1n, amount1: 1n, fee: 700, sqrtPriceX96 } }, ETH_USDG).side).toBe("sell");
  });
});
