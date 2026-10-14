import { describe, expect, test } from "bun:test";
import { OUTAGE_GAP_SEC, outageWindows } from "../src/index";

const T = 1_800_000_000;
const every30 = (n: number, seq0 = 1, t0 = T) => Array.from({ length: n }, (_, i) => ({ seq: seq0 + i, tObs: t0 + 30 * i }));

describe("outage windows from consecutive reports", () => {
  test("reports every 30 s: no window", () => {
    expect(OUTAGE_GAP_SEC).toBe(90);
    expect(outageWindows(every30(10))).toEqual([]);
    expect(outageWindows([])).toEqual([]);
  });
  test("a gap of exactly 90 s is not an outage, 91 s is", () => {
    expect(outageWindows([{ seq: 1, tObs: T }, { seq: 2, tObs: T + 90 }])).toEqual([]);
    expect(outageWindows([{ seq: 1, tObs: T }, { seq: 2, tObs: T + 91 }])).toEqual([
      { from: T, to: T + 91, durationSec: 91, seqBefore: 1, seqAfter: 2, ongoing: false },
    ]);
  });
  test("a 12-minute silence between seq 10 and 11", () => {
    const before = every30(10);
    const after = every30(5, 11, T + 270 + 720);
    expect(outageWindows([...before, ...after])).toEqual([
      { from: T + 270, to: T + 990, durationSec: 720, seqBefore: 10, seqAfter: 11, ongoing: false },
    ]);
  });
  test("an ongoing silence only when nowSec is given and the last report is more than 90 s old", () => {
    const r = every30(3);
    expect(outageWindows(r, { nowSec: T + 60 + 90 })).toEqual([]);
    expect(outageWindows(r, { nowSec: T + 60 + 400 })).toEqual([
      { from: T + 60, to: null, durationSec: 400, seqBefore: 3, seqAfter: null, ongoing: true },
    ]);
  });
  test("reports out of order throw", () => {
    expect(() => outageWindows([{ seq: 2, tObs: T }, { seq: 1, tObs: T + 30 }])).toThrow(/out of order/);
    expect(() => outageWindows([{ seq: 1, tObs: T }, { seq: 2, tObs: T }])).toThrow(/out of order/);
  });
});
