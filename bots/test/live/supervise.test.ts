import { describe, expect, test } from "bun:test";
import { backoffMs, isDeskBlindError, isStale, LoopGuard, WAKE_GAP_SEC } from "../../src/live/lib/supervise";

const T = 1_800_000_000_000;

describe("wall-clock jumps", () => {
  test("regular firings are not a jump; more than 60 s between two firings is", () => {
    expect(WAKE_GAP_SEC).toBe(60);
    const g = new LoopGuard();
    expect(g.beat(T)).toBeNull(); // first firing
    expect(g.beat(T + 2_000)).toBeNull();
    expect(g.beat(T + 62_000)).toBeNull(); // exactly 60 s
    expect(g.beat(T + 62_000 + 600_000)).toEqual({ fromMs: T + 62_000, toMs: T + 662_000, gapSec: 600 });
    expect(g.beat(T + 664_000)).toBeNull();
  });
  test("a resume lifts the backoff", () => {
    const g = new LoopGuard();
    g.beat(T);
    g.failure(T);
    g.failure(T);
    g.failure(T); // 8 s backoff
    expect(g.canRun(T + 1_000)).toBe(false);
    expect(g.beat(T + 300_000)).not.toBeNull();
    expect(g.canRun(T + 300_000)).toBe(true);
  });
});

describe("capped backoff", () => {
  test("2, 4, 8 ... s, capped at 60 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffMs(n))).toEqual([0, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });
  test("failures delay the next run; a success clears them", () => {
    const g = new LoopGuard();
    expect(g.failure(T)).toBe(2_000);
    expect(g.canRun(T + 1_999)).toBe(false);
    expect(g.canRun(T + 2_000)).toBe(true);
    expect(g.failure(T + 2_000)).toBe(4_000);
    expect(g.consecutiveFailures).toBe(2);
    expect(g.success(T + 6_000)).toBeNull(); // two failures: not an outage worth recording
    expect(g.consecutiveFailures).toBe(0);
    expect(g.canRun(T + 6_000)).toBe(true);
  });
  test("a streak of 3 or more failures is returned as an RPC outage when it ends", () => {
    const g = new LoopGuard();
    g.failure(T);
    g.failure(T + 2_000);
    g.failure(T + 6_000);
    expect(g.success(T + 14_000)).toEqual({ fromMs: T, toMs: T + 14_000, gapSec: 14 });
  });
});

describe("stale actions and the blind desk", () => {
  test("an action older than its limit is stale", () => {
    expect(isStale(T, T + 10_000, 10_000)).toBe(false);
    expect(isStale(T, T + 10_001, 10_000)).toBe(true);
  });
  test("DeskBlind, decoded or raw, is recognized", () => {
    expect(isDeskBlindError("reverted: DeskBlind")).toBe(true);
    expect(isDeskBlindError('execution reverted: custom error 0x5caf72fd')).toBe(true);
    expect(isDeskBlindError("reverted: AccessManagedUnauthorized")).toBe(false);
  });
});
