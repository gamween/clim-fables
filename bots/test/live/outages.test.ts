import { describe, expect, test } from "bun:test";
import { advanceOutages, attachLocalReasons, emptyOutageState, parseLocalOutages, summarizeReason, type LocalOutage } from "../../src/live/lib/outages";

const T = 1_800_000_000;
const reports = (seq0: number, t0: number, n: number) => Array.from({ length: n }, (_, i) => ({ seq: seq0 + i, tObs: t0 + 30 * i }));
const rec = (process: string, kind: LocalOutage["kind"], fromSec: number, toSec: number): LocalOutage => ({ ts: "2027-01-15T08:00:00.000Z", process, kind, fromSec, toSec, detail: "" });

describe("incremental outage scan", () => {
  test("windows found across two passes, the ongoing one recomputed", () => {
    const s0 = emptyOutageState(1_000);
    expect(s0).toEqual({ scannedToBlock: 999, reportCount: 0, lastReport: null, windows: [] });
    // pass 1: seq 1-10 every 30 s, then silence: ongoing at T + 270 + 400
    const p1 = advanceOutages(s0, reports(1, T, 10), 5_000, T + 670);
    expect(p1.state.reportCount).toBe(10);
    expect(p1.state.windows).toEqual([]);
    expect(p1.windows).toEqual([{ from: T + 270, to: null, durationSec: 400, seqBefore: 10, seqAfter: null, ongoing: true }]);
    // pass 2: the desk is back at T + 990 (seq 11): the window closes at 720 s
    const p2 = advanceOutages(p1.state, reports(11, T + 990, 3), 9_000, T + 1_060);
    expect(p2.state.scannedToBlock).toBe(9_000);
    expect(p2.state.lastReport).toEqual({ seq: 13, tObs: T + 1_050 });
    expect(p2.windows).toEqual([{ from: T + 270, to: T + 990, durationSec: 720, seqBefore: 10, seqAfter: 11, ongoing: false }]);
    expect(p2.state.windows).toEqual(p2.windows);
  });
  test("a hole in seq throws, so the range is rescanned", () => {
    const p1 = advanceOutages(emptyOutageState(0), reports(1, T, 3), 100, T + 90);
    expect(() => advanceOutages(p1.state, reports(5, T + 120, 2), 200, T + 160)).toThrow(/missing reports between seq 3 and 5/);
  });
});

describe("local reasons", () => {
  test("parse skips malformed lines", () => {
    const text = [JSON.stringify(rec("runner", "wake", T, T + 600)), "not json", JSON.stringify({ ts: "x", process: "arb", kind: "nap", fromSec: 1, toSec: 2 }), ""].join("\n");
    expect(parseLocalOutages(text)).toEqual([rec("runner", "wake", T, T + 600)]);
  });
  test("the most telling kind wins", () => {
    expect(summarizeReason([rec("runner", "restart", 0, 1), rec("desk", "wake", 0, 1), rec("arb", "wake", 0, 1)])).toBe(
      "wall-clock gap seen by arb, desk: the Mac was asleep or the processes were suspended",
    );
    expect(summarizeReason([rec("noise", "restart", 0, 1), rec("desk", "restart", 0, 1)])).toBe("processes stopped and restarted: desk, noise");
    expect(summarizeReason([rec("runner", "rpc-errors", 0, 1)])).toBe("RPC or network errors in runner");
    expect(summarizeReason([])).toMatch(/^unknown/);
  });
  test("records overlapping a window (60 s slack) are attached to it", () => {
    const w = { from: T + 270, to: T + 990, durationSec: 720, seqBefore: 10, seqAfter: 11, ongoing: false };
    const local = [rec("desk", "wake", T + 280, T + 980), rec("runner", "wake", T - 5_000, T - 4_000), rec("arb", "restart", T + 1_040, T + 1_045)];
    const [x] = attachLocalReasons([w], local, T + 2_000);
    expect(x?.local.map((r) => r.process)).toEqual(["desk", "arb"]);
    expect(x?.reason).toMatch(/^wall-clock gap seen by desk/);
  });
});
