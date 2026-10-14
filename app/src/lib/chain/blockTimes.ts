// Block timestamps. The public RPCs return logs with blockTimestamp "0x0" (checked 2026-10-14 on both chains), so a
// log's time is its block header's timestamp, read with eth_getBlockByNumber. Headers are cached and read in batches of
// at most 50: a JSON-RPC batch of 200 got HTTP 429 from the public endpoints, 100 went through.
import type { PublicClient } from "viem";
import { withRetry } from "./retry";

export const HEADER_BATCH = 50;

const caches = new WeakMap<PublicClient, Map<bigint, number>>();
const cacheOf = (c: PublicClient) => {
  let m = caches.get(c);
  if (!m) caches.set(c, (m = new Map()));
  return m;
};

export async function blockTime(client: PublicClient, n: bigint): Promise<number> {
  const cache = cacheOf(client);
  const hit = cache.get(n);
  if (hit !== undefined) return hit;
  const t = Number((await withRetry(() => client.getBlock({ blockNumber: n }))).timestamp);
  cache.set(n, t);
  return t;
}

/** Timestamps of `blocks`, `HEADER_BATCH` headers at a time. */
export async function blockTimes(client: PublicClient, blocks: readonly bigint[]): Promise<Map<bigint, number>> {
  const cache = cacheOf(client);
  const missing = [...new Set(blocks)].filter((b) => !cache.has(b));
  for (let i = 0; i < missing.length; i += HEADER_BATCH) {
    await Promise.all(missing.slice(i, i + HEADER_BATCH).map((b) => blockTime(client, b)));
  }
  return new Map(blocks.map((b) => [b, cache.get(b) as number]));
}

/** The first block whose timestamp is at or after `target`, searched below `hi` (whose timestamp `hiTs` is at or after
 *  it): interpolation steps, with a bisection every other step so the search always ends (about 6 to 12 headers). */
export async function firstBlockAtOrAfter(client: PublicClient, target: number, hi: bigint, hiTs: number, minBlockSec: number): Promise<bigint> {
  if (hiTs < target) return hi + 1n;
  let back = BigInt(Math.ceil(Math.max(1, hiTs - target) / minBlockSec));
  let lo = hi > back ? hi - back : 0n;
  let loTs = await blockTime(client, lo);
  while (loTs >= target && lo > 0n) {
    back *= 2n;
    lo = hi > back ? hi - back : 0n;
    loTs = await blockTime(client, lo);
  }
  if (loTs >= target) return lo;
  let step = 0;
  while (hi - lo > 1n) {
    const span = hi - lo;
    let mid: bigint;
    if (step++ % 2 === 0 && hiTs > loTs) {
      const frac = (target - loTs) / (hiTs - loTs);
      mid = lo + BigInt(Math.floor(Number(span) * frac));
    } else {
      mid = lo + span / 2n;
    }
    if (mid <= lo) mid = lo + 1n;
    if (mid >= hi) mid = hi - 1n;
    const t = await blockTime(client, mid);
    if (t >= target) {
      hi = mid;
      hiTs = t;
    } else {
      lo = mid;
      loTs = t;
    }
  }
  return hi;
}
