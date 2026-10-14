import { LOG_CHUNK_BLOCKS } from "@/lib/rpc";

/** [from, to] split into consecutive ranges of at most `chunk` blocks (the public RPCs cap eth_getLogs at 10M). */
export function blockRanges(from: bigint, to: bigint, chunk: bigint = LOG_CHUNK_BLOCKS): Array<[bigint, bigint]> {
  if (to < from) return [];
  const out: Array<[bigint, bigint]> = [];
  for (let a = from; a <= to; a += chunk) out.push([a, a + chunk - 1n < to ? a + chunk - 1n : to]);
  return out;
}

/** Logs of [from, to], fetched range by range, in chain order. */
export async function getLogsChunked<T>(fetchRange: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, chunk?: bigint): Promise<T[]> {
  const out: T[] = [];
  for (const [a, b] of blockRanges(from, to, chunk)) out.push(...(await fetchRange(a, b)));
  return out;
}

/** A block at or before time `t`, from the head and a lower bound on the block time: blocks are at least
 *  `minBlockSec` apart, so stepping back (headTs - t) / minBlockSec blocks lands at or before `t`. Callers filter the
 *  logs by their own timestamp. */
export function blockAtOrBefore(head: bigint, headTs: number, t: number, minBlockSec: number): bigint {
  const back = BigInt(Math.ceil(Math.max(0, headTs - t) / minBlockSec));
  return head > back ? head - back : 0n;
}
