import { describe, expect, it } from "vitest";
import { FakeRpc } from "@/test/fakeRpc";
import { FABLES } from "./fables";
import type { History } from "./history";
import { isSeriesKey, pollSeries, SERIES, type SeriesDef } from "./series";

type Log = { block: bigint };

/** A series over a fake chain with one log per 100 blocks; records every range read. */
function fakeSeries(windowSec: number, lookbackSec: number) {
  const ranges: Array<[bigint, bigint]> = [];
  const def: SeriesDef<Log> = {
    chain: "mainnet",
    windowSec,
    lookbackSec,
    minBlockSec: 0.09,
    read: async (_c, from, to) => {
      ranges.push([from, to]);
      const out: Log[] = [];
      for (let b = from; b <= to; b++) if (b % 100n === 0n) out.push({ block: b });
      return out;
    },
  };
  return { def, ranges };
}

describe("SERIES", () => {
  it("names every log history the pages read, with the windows they show", () => {
    expect(Object.keys(SERIES).sort()).toEqual(
      ["clim-points-86400", "desk-900", "fables-pokes-604800", "fables-pokes-86400", "fables-swaps-600", "pool-D-86400", "pool-F-86400", "pool-K-86400", "pool-swaps-D-86400", "pool-swaps-F-86400", "pool-swaps-K-86400"].sort(),
    );
    expect(SERIES["fables-pokes-86400"]).toMatchObject({ chain: "mainnet", windowSec: 86_400, lookbackSec: FABLES.pokeTtlSec });
    expect(SERIES["pool-K-86400"]).toMatchObject({ chain: "testnet", windowSec: 86_400, lookbackSec: 7_200 });
    expect(SERIES["fables-pokes-604800"].cached).toBe(false);
    expect(isSeriesKey("desk-900")).toBe(true);
    expect(isSeriesKey("desk-901")).toBe(false);
    expect(isSeriesKey("__proto__")).toBe(false);
  });
});

describe("pollSeries", () => {
  it("reads the whole window from its first block on the first poll, then only the new blocks", async () => {
    const rpc = new FakeRpc();
    rpc.head = 100_003n; // 0.1 s blocks: the lagged head 100,000 is at t = 10,000
    const { def, ranges } = fakeSeries(600, 60);
    const first = await pollSeries(def, rpc.client(), null);
    // First block at or after 10,000 - 600 - 60 = 9,340 s is block 93,400.
    expect(first).toMatchObject({ fromBlock: 93_400n, toBlock: 100_000n, toTs: 10_000, windowSec: 600 });
    expect(ranges).toEqual([[93_400n, 100_000n]]);
    rpc.head = 100_503n;
    const next: History<Log> = await pollSeries(def, rpc.client(), first);
    expect(ranges.at(-1)).toEqual([100_001n, 100_500n]);
    expect(next.fromBlock).toBe(93_900n);
    expect(next.items[0]?.block).toBe(93_900n);
  });
});
