"use client";
import { useRef } from "react";
import type { PublicClient } from "viem";
import { blockTime, firstBlockAtOrAfter } from "@/lib/chain/blockTimes";
import { type History, mergeHistory } from "@/lib/chain/history";
import { laggedHead, withRetry } from "@/lib/chain/retry";
import { usePoll } from "./usePoll";

export type { History };

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
 *  whole window (in ranges the RPC accepts), each next one only the blocks since the last call (mergeHistory). */
export function useLogHistory<T extends { block: bigint }>(o: Options<T>) {
  const state = useRef<{ key: string; history: History<T> | null }>({ key: o.key, history: null });
  return usePoll<History<T>>(
    async () => {
      if (state.current.key !== o.key) state.current = { key: o.key, history: null };
      const client = o.client();
      const next = await mergeHistory({
        prev: state.current.history,
        toBlock: laggedHead(await withRetry(() => client.getBlockNumber({ cacheTime: 0 }))),
        windowSec: o.windowSec,
        bounds: async (toBlock) => {
          const toTs = await blockTime(client, toBlock);
          return { fromBlock: await firstBlockAtOrAfter(client, toTs - o.windowSec - o.lookbackSec, toBlock, toTs, o.minBlockSec), toTs };
        },
        read: (fromBlock, toBlock) => o.read(client, fromBlock, toBlock),
      });
      state.current = { key: o.key, history: next };
      return next;
    },
    o.pollMs,
    o.key,
  );
}
