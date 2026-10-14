"use client";
import { useRef } from "react";
import type { PublicClient } from "viem";
import { blockTime, firstBlockAtOrAfter } from "@/lib/chain/blockTimes";
import { laggedHead, withRetry } from "@/lib/chain/retry";
import { usePoll } from "./usePoll";

export type History<T> = {
  items: T[];
  /** Every log of [fromBlock, toBlock] was read; fromBlock is the first block at or after toTs - windowSec - lookbackSec. */
  fromBlock: bigint;
  toBlock: bigint;
  toTs: number;
  windowSec: number;
};

type Options<T> = {
  key: string;
  client: () => PublicClient;
  read: (client: PublicClient, fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
  windowSec: number;
  /** Extra history before the window (a poke's TTL), so the state at the window's start is known. */
  lookbackSec: number;
  minBlockSec: number;
  pollMs: number;
};

/** Logs over a sliding time window whose first block is found exactly from block timestamps: the first call reads the
 *  whole window (in ranges the RPC accepts), each next one only the blocks since the last call, and drops the items
 *  that fell out of the window. */
export function useLogHistory<T extends { block: bigint }>(o: Options<T>) {
  const state = useRef<{ key: string; history: History<T> | null }>({ key: o.key, history: null });
  return usePoll<History<T>>(
    async () => {
      if (state.current.key !== o.key) state.current = { key: o.key, history: null };
      const client = o.client();
      const toBlock = laggedHead(await withRetry(() => client.getBlockNumber({ cacheTime: 0 })));
      const toTs = await blockTime(client, toBlock);
      const fromBlock = await firstBlockAtOrAfter(client, toTs - o.windowSec - o.lookbackSec, toBlock, toTs, o.minBlockSec);
      const prev = state.current.history;
      let items: T[];
      if (prev === null || fromBlock < prev.fromBlock) {
        items = await o.read(client, fromBlock, toBlock);
      } else {
        items = toBlock > prev.toBlock ? [...prev.items, ...(await o.read(client, prev.toBlock + 1n, toBlock))] : prev.items;
      }
      const next = { items: items.filter((x) => x.block >= fromBlock), fromBlock, toBlock, toTs, windowSec: o.windowSec };
      state.current = { key: o.key, history: next };
      return next;
    },
    o.pollMs,
    o.key,
  );
}
