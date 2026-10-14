import { describe, expect, it } from "vitest";
import reports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { FABLES } from "./chain/fables";
import { atCursor, buildRun, upTo } from "./run";

const run = buildRun(forkRun, reports, storm);

describe("the recorded fork run", () => {
  it("was run against Fables' real ETH/USDG hook", () => {
    expect(forkRun.hook).toBe(FABLES.hook);
    expect(forkRun.poolId).toBe(FABLES.poolId);
  });
  it("summarises what the README's jq prints", () => {
    expect(run.summary).toMatchObject({ pokes: 180, swaps: 36, swapReverts: 0, forkBlock: 82093378 });
    expect(run.summary.minPokedPips).toBe(Math.min(...forkRun.pokedPips));
    expect(run.summary.maxPokedPips).toBe(Math.max(...forkRun.pokedPips));
  });
  it("puts the keeper's real fee and clim's on the same 90-minute window", () => {
    expect([run.from, run.to]).toEqual([1791337200, 1791342600]);
    expect(run.keeper[0]).toEqual({ t: 1791337200, v: 700 });
    expect(run.clim).toHaveLength(180);
  });
  it("reads every series at the cursor", () => {
    const c = atCursor(run, 1791338250);
    expect(c.keeper).toBe(1468);
    expect(c.clim).not.toBeNull();
    expect(c.swaps).toBe(forkRun.swapT.filter((t) => t <= 1791338250).length);
    expect(upTo(run.clim, run.from + 30)).toEqual([run.clim[0]]);
  });
});

it("refuses a run whose window differs from the keeper's", () => {
  expect(() => buildRun(forkRun, { ...reports, window: { start: 0, end: 1 } }, storm)).toThrow("differ");
});
