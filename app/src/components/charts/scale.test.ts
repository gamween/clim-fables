import { describe, expect, it } from "vitest";
import { stepArea, stepPath, timeTicks, valueAt, yRange } from "./scale";

const F = { from: 0, to: 100, yMin: 0, yMax: 10, width: 1000, height: 100 };

describe("stepPath", () => {
  it("draws horizontal then vertical segments and runs to the end", () => {
    expect(stepPath([{ t: 0, v: 5 }, { t: 50, v: 10 }], F)).toBe("M0 50 H500 V0 H1000");
  });
  it("clamps a point before the window to its start", () => expect(stepPath([{ t: -20, v: 0 }], F)).toBe("M0 100 H1000"));
  it("is empty without points", () => expect(stepPath([], F)).toBe(""));
  it("closes the area to the baseline", () => expect(stepArea([{ t: 10, v: 5 }], F)).toBe("M100 50 H1000 V100 H100 Z"));
});

describe("valueAt", () => {
  const pts = [{ t: 10, v: 1 }, { t: 20, v: 2 }];
  it("holds a value until the next point", () => expect(valueAt(pts, 15)).toBe(1));
  it("is null before the first point", () => expect(valueAt(pts, 5)).toBeNull());
});

describe("timeTicks", () => {
  it("labels days over a week", () => {
    const from = Date.UTC(2026, 9, 7, 12) / 1000;
    const ticks = timeTicks(from, from + 7 * 86_400);
    expect(ticks.map((t) => t.label)).toEqual(["Oct 8", "Oct 9", "Oct 10", "Oct 11", "Oct 12", "Oct 13", "Oct 14"]);
  });
  it("labels hours over a day", () => {
    const from = Date.UTC(2026, 9, 14, 0, 30) / 1000;
    expect(timeTicks(from, from + 86_400).map((t) => t.label)).toEqual(["04:00", "08:00", "12:00", "16:00", "20:00", "00:00"]);
  });
  it("labels quarter hours over the 90-minute run", () => {
    // the fork run's window, 1791337200 .. 1791342600 (2026-10-07 01:40 to 03:10 UTC)
    expect(timeTicks(1791337200, 1791342600).map((t) => t.label)).toEqual(["01:45", "02:00", "02:15", "02:30", "02:45", "03:00"]);
  });
});

it("gives the y range some headroom", () => {
  expect(yRange([700, 6000])).toEqual({ yMin: 0, yMax: 6480 });
  expect(yRange([])).toEqual({ yMin: 0, yMax: 1 });
});
