import { describe, expect, it } from "vitest";
import type { History } from "@/lib/chain/history";
import { createHistoryCache } from "./historyCache";

type Log = { block: bigint };
const H = (toBlock: bigint): History<Log> => ({ items: [], fromBlock: 1n, toBlock, toTs: Number(toBlock), windowSec: 60 });

function clock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createHistoryCache", () => {
  it("waits for the first read, then serves the last history and tops it up in the background once it is stale", async () => {
    const c = clock();
    const prevs: Array<bigint | null> = [];
    let head = 100n;
    const cache = createHistoryCache<Log>(async (prev) => {
      prevs.push(prev?.toBlock ?? null);
      return H(head);
    }, { maxAgeMs: 20_000, now: c.now });
    expect((await cache.get()).history.toBlock).toBe(100n);
    expect(cache.refreshing()).toBeNull();
    head = 150n;
    c.advance(10_000);
    expect((await cache.get()).history.toBlock).toBe(100n);
    expect(cache.refreshing()).toBeNull();
    c.advance(15_000);
    // Stale: the last history at once, and a top-up from it under way.
    expect((await cache.get()).history.toBlock).toBe(100n);
    const refresh = cache.refreshing();
    expect(refresh).not.toBeNull();
    await refresh;
    const e = await cache.get();
    expect(e.history.toBlock).toBe(150n);
    expect(e.builtAt).toBe(26_000);
    expect(prevs).toEqual([null, 100n]);
  });

  it("shares one read between concurrent requests", async () => {
    let calls = 0;
    const cache = createHistoryCache<Log>(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return H(100n);
    }, { maxAgeMs: 20_000 });
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("keeps the last good history when a top-up fails, and fails when it has none", async () => {
    const c = clock();
    let fail = false;
    const cache = createHistoryCache<Log>(async () => {
      if (fail) throw new Error("rate limit");
      return H(100n);
    }, { maxAgeMs: 20_000, now: c.now });
    fail = true;
    await expect(cache.get()).rejects.toThrow(/rate limit/);
    fail = false;
    await cache.get();
    fail = true;
    c.advance(30_000);
    expect((await cache.get()).history.toBlock).toBe(100n);
    await cache.refreshing();
    expect((await cache.get()).history.toBlock).toBe(100n);
  });
});
