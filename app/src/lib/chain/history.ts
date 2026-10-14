// One poll of a sliding log window (useLogHistory), kept pure so a head that goes backwards can be tested.

export type History<T> = {
  items: T[];
  /** Every log of [fromBlock, toBlock] was read; fromBlock is the first block at or after toTs - windowSec - lookbackSec. */
  fromBlock: bigint;
  toBlock: bigint;
  toTs: number;
  windowSec: number;
};

type Merge<T> = {
  prev: History<T> | null;
  toBlock: bigint;
  windowSec: number;
  /** The window's first block and the head's timestamp, read only when the head moved forward. */
  bounds: (toBlock: bigint) => Promise<{ fromBlock: bigint; toTs: number }>;
  read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
};

/** The first poll reads the whole window, each next one only the blocks after the last head, and drops the items that
 *  fell out of the window. The head comes from a fallback() over several RPCs, so a lagging node can return one below
 *  the last poll's: the history then stays as it was, since moving it back would read those blocks a second time. */
export async function mergeHistory<T extends { block: bigint }>(o: Merge<T>): Promise<History<T>> {
  const { prev, toBlock } = o;
  if (prev !== null && toBlock <= prev.toBlock) return prev;
  const { fromBlock, toTs } = await o.bounds(toBlock);
  const items =
    prev === null || fromBlock < prev.fromBlock
      ? await o.read(fromBlock, toBlock)
      : [...prev.items, ...(await o.read(prev.toBlock + 1n, toBlock))];
  return { items: items.filter((x) => x.block >= fromBlock), fromBlock, toBlock, toTs, windowSec: o.windowSec };
}
