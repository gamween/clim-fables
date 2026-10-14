import { describe, expect, it } from "vitest";
import { type History, mergeHistory } from "./history";

type Log = { block: bigint };

/** One log per block; records every range read. */
function fakeRead() {
  const calls: [bigint, bigint][] = [];
  const read = async (from: bigint, to: bigint): Promise<Log[]> => {
    calls.push([from, to]);
    const out: Log[] = [];
    for (let b = from; b <= to; b++) out.push({ block: b });
    return out;
  };
  return { calls, read };
}

/** A window that starts `span` blocks before the head, one second per block. */
const bounds = (span: bigint) => async (toBlock: bigint) => ({ fromBlock: toBlock - span, toTs: Number(toBlock) });

const blocks = (h: History<Log>) => h.items.map((x) => Number(x.block));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("mergeHistory", () => {
  it("reads the whole window on the first poll", async () => {
    const r = fakeRead();
    const h = await mergeHistory({ prev: null, toBlock: 100n, windowSec: 60, bounds: bounds(10n), read: r.read });
    expect(r.calls).toEqual([[90n, 100n]]);
    expect(h).toMatchObject({ fromBlock: 90n, toBlock: 100n, toTs: 100, windowSec: 60 });
    expect(blocks(h)).toEqual(range(90, 100));
  });

  it("reads only the new blocks and drops the ones that left the window", async () => {
    const r = fakeRead();
    const first = await mergeHistory({ prev: null, toBlock: 100n, windowSec: 60, bounds: bounds(10n), read: r.read });
    const h = await mergeHistory({ prev: first, toBlock: 105n, windowSec: 60, bounds: bounds(10n), read: r.read });
    expect(r.calls).toEqual([[90n, 100n], [101n, 105n]]);
    expect(blocks(h)).toEqual(range(95, 105));
  });

  it("keeps the last history when the head goes backwards, so no block is read twice", async () => {
    // fallback() can answer from a node behind the previous poll's: 100, then 95, then 110.
    const r = fakeRead();
    const first = await mergeHistory({ prev: null, toBlock: 100n, windowSec: 60, bounds: bounds(10n), read: r.read });
    let boundsCalls = 0;
    const lagging = await mergeHistory({
      prev: first,
      toBlock: 95n,
      windowSec: 60,
      bounds: async (b) => {
        boundsCalls++;
        return bounds(10n)(b);
      },
      read: r.read,
    });
    expect(lagging).toBe(first);
    expect(boundsCalls).toBe(0);
    const h = await mergeHistory({ prev: lagging, toBlock: 110n, windowSec: 60, bounds: bounds(10n), read: r.read });
    expect(r.calls).toEqual([[90n, 100n], [101n, 110n]]);
    expect(blocks(h)).toEqual(range(100, 110));
    expect(new Set(blocks(h)).size).toBe(h.items.length);
  });

  it("keeps the last history when the head has not moved", async () => {
    const r = fakeRead();
    const first = await mergeHistory({ prev: null, toBlock: 100n, windowSec: 60, bounds: bounds(10n), read: r.read });
    expect(await mergeHistory({ prev: first, toBlock: 100n, windowSec: 60, bounds: bounds(10n), read: r.read })).toBe(first);
    expect(r.calls).toEqual([[90n, 100n]]);
  });

  it("reads the whole window again when it starts before the last one", async () => {
    const r = fakeRead();
    const first = await mergeHistory({ prev: null, toBlock: 100n, windowSec: 60, bounds: bounds(10n), read: r.read });
    const h = await mergeHistory({ prev: first, toBlock: 102n, windowSec: 60, bounds: bounds(20n), read: r.read });
    expect(r.calls).toEqual([[90n, 100n], [82n, 102n]]);
    expect(blocks(h)).toEqual(range(82, 102));
  });
});
