import { describe, expect, it } from "vitest";
import type { History } from "./history";
import { encodeHistory } from "./historyJson";
import { fetchSeed, seededPoll } from "./seed";

type Log = { block: bigint };
const H = (toBlock: bigint, cacheBlock?: bigint): History<Log> => ({ items: [{ block: toBlock }], fromBlock: 1n, toBlock, toTs: 10, windowSec: 600, cacheBlock });

describe("seededPoll", () => {
  it("shows the cached history at once, then tops it up from the chain", async () => {
    const shown: History<Log>[] = [];
    const prevs: Array<History<Log> | null> = [];
    const out = await seededPoll<Log>({
      seed: async () => H(100n, 100n),
      poll: async (prev) => {
        prevs.push(prev);
        return H(110n, 100n);
      },
      publish: (h) => shown.push(h),
    });
    expect(shown.map((h) => h.toBlock)).toEqual([100n]);
    expect(prevs.map((p) => p?.toBlock)).toEqual([100n]);
    expect(out.toBlock).toBe(110n);
  });

  it("reads the whole window from the chain when the cache fails", async () => {
    const shown: History<Log>[] = [];
    const prevs: Array<History<Log> | null> = [];
    const out = await seededPoll<Log>({
      seed: async () => {
        throw new Error("503");
      },
      poll: async (prev) => {
        prevs.push(prev);
        return H(110n);
      },
      publish: (h) => shown.push(h),
    });
    expect(shown).toEqual([]);
    expect(prevs).toEqual([null]);
    expect(out.toBlock).toBe(110n);
  });
});

describe("fetchSeed", () => {
  it("reads /api/history/<key> and checks the window", async () => {
    const urls: string[] = [];
    const body = encodeHistory(H(100n), { builtAt: 5 });
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const h = await fetchSeed<Log>("desk-900", 600, fetchImpl);
    expect(urls).toEqual(["/api/history/desk-900"]);
    expect(h?.cacheBlock).toBe(100n);
    await expect(fetchSeed<Log>("desk-900", 900, fetchImpl)).rejects.toThrow(/window/);
    await expect(fetchSeed<Log>("desk-900", 600, async () => new Response("no", { status: 502 }))).rejects.toThrow(/502/);
  });
});
