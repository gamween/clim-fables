import { describe, expect, it } from "vitest";
import type { FeeStep } from "./fees";
import { averageOver, HOUR, hourlyBars } from "./summary";

const step = (t: number, fee: number): FeeStep => ({ t, fee0For1: fee, fee1For0: fee, overridden: true });
const T0 = 1_792_000_800; // on the hour (1,792,000,800 / 3,600 = 497,778)

describe("averageOver", () => {
  it("weights each fee by the time it is in force inside the range", () => {
    const steps = [step(T0 - 600, 700), step(T0 + 900, 1_300)];
    // 900 s at 700 then 2,700 s at 1,300 over one hour
    expect(averageOver(steps, T0, T0 + HOUR, "0For1")).toBeCloseTo((900 * 700 + 2_700 * 1_300) / HOUR, 6);
  });
  it("is null before the first fee and for an empty range", () => {
    expect(averageOver([step(T0 + 10, 700)], T0, T0 + HOUR, "0For1")).toBeNull();
    expect(averageOver([step(T0, 700)], T0 + 5, T0 + 5, "0For1")).toBeNull();
  });
  it("reads the direction asked for", () => {
    const s: FeeStep = { t: T0, fee0For1: 700, fee1For0: 900, overridden: true };
    expect(averageOver([s], T0, T0 + 60, "1For0")).toBe(900);
  });
});

describe("hourlyBars", () => {
  it("ends with the current UTC hour, partial, and covers 24 hours", () => {
    const to = T0 + 1_200;
    const bars = hourlyBars([step(T0 - 30 * HOUR, 700)], to, "0For1");
    expect(bars).toHaveLength(24);
    expect(bars[23]).toEqual({ start: T0, end: to, avg: 700, partial: true });
    expect(bars[0]?.start).toBe(T0 - 23 * HOUR);
    expect(bars.slice(0, 23).every((b) => !b.partial && b.end - b.start === HOUR)).toBe(true);
  });
  it("has no partial bar when the window ends on the hour", () => {
    const bars = hourlyBars([step(T0 - 30 * HOUR, 700)], T0, "0For1");
    expect(bars[23]).toEqual({ start: T0 - HOUR, end: T0, avg: 700, partial: false });
  });
  it("leaves hours before the first fee empty", () => {
    const bars = hourlyBars([step(T0 - 2 * HOUR, 1_000)], T0 + 60, "0For1");
    expect(bars.filter((b) => b.avg === null)).toHaveLength(21);
    expect(bars[21]?.avg).toBe(1_000);
  });
});
