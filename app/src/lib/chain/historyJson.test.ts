import { describe, expect, it } from "vitest";
import type { History } from "./history";
import { decodeHistory, encodeHistory } from "./historyJson";

type Item = { block: bigint; t: number; tx: `0x${string}`; kind: string };

describe("history JSON", () => {
  it("round-trips a history with bigints, as the cache endpoint serves it", () => {
    const h: History<Item> = {
      items: [{ block: 123_456_789_012n, t: 1_760_000_000, tx: "0xab", kind: "poke" }],
      fromBlock: 100n,
      toBlock: 123_456_789_999n,
      toTs: 1_760_000_100,
      windowSec: 86_400,
    };
    const text = JSON.stringify(encodeHistory(h, { builtAt: 1_760_000_101_000 }));
    const back = decodeHistory<Item>(JSON.parse(text));
    expect(back.history).toEqual({ ...h, cacheBlock: 123_456_789_999n });
    expect(back.builtAt).toBe(1_760_000_101_000);
  });

  it("rejects a body that is not a history", () => {
    expect(() => decodeHistory({ items: "x" })).toThrow(/not a cached history/);
    expect(() => decodeHistory(null)).toThrow(/not a cached history/);
  });
});
