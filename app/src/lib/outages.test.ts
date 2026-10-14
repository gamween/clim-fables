import { describe, expect, it } from "vitest";
import snapshot from "@/generated/outages.json";
import { mergeOutages, type OutageSnapshot } from "./outages";

const SNAP: OutageSnapshot = {
  generatedAt: "2026-10-14T13:06:36.277Z",
  gapSec: 90,
  deployBlock: 1,
  scannedToBlock: 100,
  chainTimeSec: 1000,
  reportCount: 3,
  lastReport: { seq: 3, tObs: 990 },
  windows: [{ from: 100, to: 450, durationSec: 350, seqBefore: 1, seqAfter: 2, ongoing: false, reason: "processes stopped and restarted: desk" }],
};

describe("mergeOutages", () => {
  it("keeps the recorded windows and their reasons", () => {
    const w = mergeOutages(SNAP, [], 1000);
    expect(w).toEqual([{ ...SNAP.windows[0], source: "record" }]);
  });
  it("adds a gap found in the reports after the snapshot", () => {
    const w = mergeOutages(SNAP, [{ seq: 4, tObs: 1020 }, { seq: 5, tObs: 1500 }], 1510);
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({ from: 1020, to: 1500, durationSec: 480, seqBefore: 4, seqAfter: 5, source: "chain" });
  });
  it("reports an ongoing silence", () => {
    const w = mergeOutages(SNAP, [], 2000);
    expect(w[1]).toMatchObject({ from: 990, to: null, ongoing: true, source: "chain" });
  });
  it("rebuilds a window recorded while ongoing from the chain, once, with the operator's reason", () => {
    const open = { from: 990, to: null, durationSec: 60, seqBefore: 3, seqAfter: null, ongoing: true, reason: "processes stopped and restarted: desk" };
    const snap: OutageSnapshot = { ...SNAP, chainTimeSec: 1050, windows: [...SNAP.windows, open] };
    const closed = mergeOutages(snap, [{ seq: 4, tObs: 1500 }, { seq: 5, tObs: 1530 }], 1540);
    expect(closed).toHaveLength(2);
    expect(closed[1]).toEqual({ from: 990, to: 1500, durationSec: 510, seqBefore: 3, seqAfter: 4, ongoing: false, source: "chain", reason: open.reason });
    const silent = mergeOutages(snap, [], 2000);
    expect(silent).toHaveLength(2);
    expect(silent[1]).toMatchObject({ from: 990, to: null, ongoing: true, source: "chain", reason: open.reason });
  });
  it("reads the committed snapshot", () => {
    expect(snapshot.gapSec).toBe(90);
    expect(snapshot.windows.length).toBeGreaterThan(0);
    for (const x of snapshot.windows) expect(x.durationSec).toBeGreaterThan(90);
  });
});
