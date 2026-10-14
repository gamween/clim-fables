import { describe, expect, test } from "bun:test";
import { annualSigmaToSigmaE9 } from "@clim/shared";
import { mulberry32 } from "../../src/lib/rng";
import { keeperFeePips, nextPostAt, parseKeeperMap, rv5From1s } from "../../src/live/lib/keeper";

const MAP = parseKeeperMap({
  edgesPctYr: [0, 40, 60, 100],
  feePips: [700, 900, 2_000, 6_000],
  clampPips: [700, 6_000],
  postEverySec: 179,
  ttlSec: 7_200,
});
const perSqrtSec = (annualPct: number): number => annualSigmaToSigmaE9(annualPct / 100) / 1e9;

describe("keeper map", () => {
  test("bin fee by annualized 5-minute volatility", () => {
    expect(keeperFeePips(MAP, perSqrtSec(25))).toBe(700);
    expect(keeperFeePips(MAP, perSqrtSec(45))).toBe(900);
    expect(keeperFeePips(MAP, perSqrtSec(99))).toBe(2_000);
    expect(keeperFeePips(MAP, perSqrtSec(400))).toBe(6_000);
  });
  test("rejects a malformed map", () => {
    expect(() => parseKeeperMap({ edgesPctYr: [0, 40], feePips: [700], clampPips: [700, 6000], postEverySec: 1, ttlSec: 1 })).toThrow(/same/);
    expect(() => parseKeeperMap({ edgesPctYr: [0, 0], feePips: [700, 700], clampPips: [700, 6000], postEverySec: 1, ttlSec: 1 })).toThrow(/increase/);
  });
  test("the lab's map file parses", async () => {
    const raw = await Bun.file(new URL("../../../shared/keeper-map-fables.json", import.meta.url)).json();
    const m = parseKeeperMap(raw);
    expect(m.ttlSec).toBe(7_200);
    expect(m.feePips.length).toBe(m.edgesPctYr.length);
  });
});

describe("5-minute volatility from Binance 1 s klines", () => {
  const NOW = 1_800_000_000;
  const rows = (n: number, end: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = end - (n - 1) + i;
      const px = (2000 * Math.exp(0.001 * Math.floor((t - end) / 5))).toString();
      return [t * 1000, px, px, px, px, "1", t * 1000 + 999];
    });
  test("returns of exactly 0.001 every 5 s", () => {
    expect(rv5From1s(rows(400, NOW - 1), NOW)).toBeCloseTo(Math.sqrt(0.001 ** 2 / 5), 12);
  });
  test("stale or short data throws", () => {
    expect(() => rv5From1s(rows(400, NOW - 40), NOW)).toThrow(/last second/);
    expect(() => rv5From1s(rows(100, NOW - 1), NOW)).toThrow(/history/);
  });
});

describe("posting cadence", () => {
  test("every postEverySec +- 10 s, seeded", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const t = nextPostAt(1_000, 179, r);
      expect(t).toBeGreaterThanOrEqual(1_169);
      expect(t).toBeLessThanOrEqual(1_189);
    }
  });
});
