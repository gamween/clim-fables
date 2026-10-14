import { describe, expect, it } from "vitest";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { climQuoteOf, climSteps, effectiveFee, feeAt, overrideSteps, peakAndLow, pokeCount, timeWeightedAverage, type ClimPoint, type PokeEvent } from "./fees";

const CFG = { floorPips: 100, flatPips: 700, capPips: 6000 };
const tx = "0xaa" as const;
const poke = (t: number, fee: number, ttl = 7200, logIndex = 0): PokeEvent => ({ kind: "poke", t, block: BigInt(t), logIndex, tx, fee0For1: fee, fee1For0: fee, expiry: t + ttl });

describe("effectiveFee, the hook's rule", () => {
  it("charges the flat fee with no override", () => expect(effectiveFee(CFG, null)).toBe(700));
  it("floors an override at max(floor, flat x 50 %)", () => {
    expect(effectiveFee(CFG, 200)).toBe(350);
    expect(effectiveFee({ ...CFG, floorPips: 400 }, 200)).toBe(400);
  });
  it("caps an override", () => expect(effectiveFee(CFG, 9000)).toBe(6000));
  it("passes an override inside the band", () => expect(effectiveFee(CFG, 1468)).toBe(1468));
});

describe("overrideSteps", () => {
  it("starts flat, steps at each poke and falls back at expiry", () => {
    const steps = overrideSteps([poke(100, 1500, 50), poke(300, 900, 50)], CFG, 0, 1000);
    expect(steps.map((s) => [s.t, s.fee0For1, s.overridden])).toEqual([
      [0, 700, false],
      [100, 1500, true],
      [150, 700, false],
      [300, 900, true],
      [350, 700, false],
    ]);
  });
  it("carries an override that is live at the window start", () => {
    const steps = overrideSteps([poke(-100, 2000, 500)], CFG, 0, 1000);
    expect(steps.map((s) => [s.t, s.fee0For1])).toEqual([[0, 2000], [400, 700]]);
  });
  it("ignores an override that expired before the window", () => {
    expect(overrideSteps([poke(-100, 2000, 50)], CFG, 0, 1000).map((s) => [s.t, s.fee0For1])).toEqual([[0, 700]]);
  });
  it("keeps one step per change, and the last log of a block wins", () => {
    const steps = overrideSteps([poke(100, 1500), poke(100, 1600, 7200, 1), poke(200, 1600)], CFG, 0, 1000);
    expect(steps.map((s) => [s.t, s.fee0For1])).toEqual([[0, 700], [100, 1600]]);
  });
  it("drops the override at a clear", () => {
    const events: PokeEvent[] = [poke(100, 1500), { kind: "clear", t: 200, block: 200n, logIndex: 0, tx }];
    expect(overrideSteps(events, CFG, 0, 1000).map((s) => [s.t, s.fee0For1])).toEqual([[0, 700], [100, 1500], [200, 700]]);
  });
  it("keeps the two directions of a per-direction poke apart", () => {
    const e: PokeEvent = { kind: "poke", t: 10, block: 10n, logIndex: 0, tx, fee0For1: 700, fee1For0: 897, expiry: 610 };
    const s = overrideSteps([e], CFG, 0, 100);
    expect(feeAt(s, 50, "0For1")).toBe(700);
    expect(feeAt(s, 50, "1For0")).toBe(897);
  });
  it("rebuilds the 7 October 2026 storm steps the lab published from Fables' own logs", () => {
    const events: PokeEvent[] = storm.pokes.map((p, i) => ({ kind: "poke", t: p.t, block: BigInt(p.t), logIndex: i, tx: p.tx as `0x${string}`, fee0For1: p.feePips, fee1For0: p.feePips, expiry: p.expiry }));
    const steps = overrideSteps(events, storm.config, storm.window.start, storm.window.end);
    expect(steps.map((s) => ({ t: s.t, feePips: s.fee0For1 }))).toEqual(storm.steps);
  });
});

describe("window statistics", () => {
  const steps = overrideSteps([poke(100, 1500, 100)], CFG, 0, 400);
  it("averages over time", () => {
    // 100 s at 700, 100 s at 1500, 200 s at 700 = (70,000 + 150,000 + 140,000) / 400
    expect(timeWeightedAverage(steps, 400, "0For1")).toBe(900);
  });
  it("finds the peak and the low", () => expect(peakAndLow(steps, "0For1")).toEqual({ peak: 1500, low: 700 }));
  it("counts the pokes inside the window", () => expect(pokeCount([poke(-5, 900), poke(100, 1500), poke(400, 900)], 0, 400)).toBe(2));
  it("reads the fee in force at a time", () => {
    expect(feeAt(steps, 150, "1For0")).toBe(1500);
    expect(feeAt(steps, 200, "1For0")).toBe(700);
    expect(feeAt(steps, -1, "1For0")).toBeNull();
  });
});

describe("clim's recommendation", () => {
  const pt = (t: number, seq: number, f01: number, f10: number): ClimPoint => ({ t, block: BigInt(t), logIndex: 0, seq, fee0For1: f01, fee1For0: f10, mode: 0, eventApplied: false, expiry: t + 600, tx });
  it("takes quote() as the lower side of quoteDirectional()", () => {
    expect(climQuoteOf({ fee0For1: 1368, fee1For0: 1652 })).toBe(1368);
  });
  it("starts the window from the last report before it", () => {
    const s = climSteps([pt(-10, 1, 700, 800), pt(30, 2, 900, 900), pt(500, 3, 1000, 1000)], 0, 100);
    expect(s.map((x) => [x.t, x.fee0For1, x.fee1For0])).toEqual([[0, 700, 800], [30, 900, 900]]);
  });
});
