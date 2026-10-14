import { describe, expect, it } from "vitest";
import type { DeskReport } from "@/lib/chain/decode";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { feeUpdateRows } from "./FeeUpdates";

const poke = (t: number): PokeEvent => ({ kind: "poke", t, block: 1n, logIndex: 0, tx: `0x${String(t).padStart(64, "0")}`, fee0For1: 900, fee1For0: 900, expiry: t + 7200 });
const point = (t: number, seq: number): ClimPoint => ({ t, block: 1n, logIndex: 0, seq, fee0For1: 700, fee1For0: 897, mode: 0, eventApplied: false, expiry: t + 600, tx: `0x${String(t).padStart(64, "1")}` });
const report = (seq: number): DeskReport => ({ t: 0, tx: `0x${String(seq).padStart(64, "2")}`, block: 1n, seq, tObs: 0, sigma15E9: 0, sigma5E9: 0, devPips: 0, nSources: 4, flags: 0 });

describe("feeUpdateRows", () => {
  it("merges both sources newest first, with clim's report transaction joined by seq", () => {
    const rows = feeUpdateRows([poke(100), poke(300)], [point(200, 7), point(400, 8)], [report(8)], 3);
    expect(rows.map((r) => [r.t, r.source])).toEqual([[400, "clim"], [300, "keeper"], [200, "clim"]]);
    expect(rows[0]?.reportTx).toBe(report(8).tx);
    expect(rows[2]?.reportTx).toBeUndefined();
    expect(rows[1]?.txUrl).toMatch(/^https:\/\/robin\.etherscan\.io\/tx\//);
    expect(rows[0]?.txUrl).toMatch(/^https:\/\/explorer\.testnet\.chain\.robinhood\.com\/tx\//);
  });
});
