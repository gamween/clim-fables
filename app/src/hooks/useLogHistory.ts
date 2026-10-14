"use client";
import { useRef } from "react";
import type { PublicClient } from "viem";
import { mainnetClient, testnetClient } from "@/lib/chain/clients";
import type { History } from "@/lib/chain/history";
import { fetchSeed, seededPoll } from "@/lib/chain/seed";
import { pollSeries, SERIES, type SeriesDef, type SeriesItem, type SeriesKey } from "@/lib/chain/series";
import { usePoll } from "./usePoll";

export type { History };

const clientOf = (chain: "mainnet" | "testnet"): PublicClient => (chain === "mainnet" ? mainnetClient() : testnetClient());

/** Logs over a sliding time window (lib/chain/series.ts). The first call shows the server's cached copy at once and
 *  tops it up from the chain (lib/chain/seed.ts); each next one reads only the blocks since the last call. */
export function useLogHistory<K extends SeriesKey>(key: K, pollMs: number) {
  type T = SeriesItem<K> & { block: bigint };
  const state = useRef<{ key: string; history: History<T> | null }>({ key, history: null });
  return usePoll<History<T>>(
    async (publish) => {
      if (state.current.key !== key) state.current = { key, history: null };
      const def = SERIES[key] as unknown as SeriesDef<T>; // every series' items carry their block
      const client = clientOf(def.chain);
      const poll = (prev: History<T> | null) => pollSeries(def, client, prev);
      const next =
        state.current.history === null && def.cached !== false
          ? await seededPoll<T>({
              seed: () => fetchSeed<T>(key, def.windowSec),
              poll,
              publish: (h) => {
                state.current = { key, history: h };
                publish(h);
              },
            })
          : await poll(state.current.history);
      state.current = { key, history: next };
      return next;
    },
    pollMs,
    key,
  );
}
