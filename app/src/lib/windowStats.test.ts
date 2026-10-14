import { describe, expect, it } from "vitest";
import type { SwapRow } from "./chain/decode";
import type { PokeEvent } from "./fees";
import { feeWindow, swapWindow } from "./windowStats";

const CFG = { floorPips: 100, flatPips: 700, capPips: 6000 };
const poke = (t: number, fee: number, ttl = 7200): PokeEvent => ({ kind: "poke", t, block: BigInt(t), logIndex: 0, tx: "0xaa", fee0For1: fee, fee1For0: fee, expiry: t + ttl });

describe("feeWindow", () => {
  it("summarises a window like Fables' Dynamic Fee rail", () => {
    const w = feeWindow([poke(500, 1000), poke(1500, 3000, 100)], CFG, 2000, 1000);
    expect([w.fromTs, w.toTs]).toEqual([1000, 2000]);
    // 500 s at 1000 (override from t=500 live), 100 s at 3000, 400 s at 700 (expired at 1600)
    expect(w.avg).toBe((500 * 1000 + 100 * 3000 + 400 * 700) / 1000);
    expect([w.peak, w.low, w.changes]).toEqual([3000, 700, 1]);
  });
});

describe("swapWindow", () => {
  const swap = (block: number, feePips: number): SwapRow => ({ tx: "0xaa", block: BigInt(block), logIndex: 0, side: "buy", eth: 1, usdg: 1, feePips, price: 1 });
  it("counts the window's swaps and averages the fee they paid", () => {
    expect(swapWindow([swap(15, 900), swap(20, 1100)])).toEqual({ count: 2, meanFeePips: 1000 });
  });
  it("has no mean without swaps", () => expect(swapWindow([])).toEqual({ count: 0, meanFeePips: null }));
});
