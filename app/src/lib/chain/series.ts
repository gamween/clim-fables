// Every log history the pages show, by key: which chain, which logs, over which window. The browser (useLogHistory)
// and the server's cache (app/api/history/[series]) read them with the same pollSeries, so both hold the same items.
import type { PublicClient } from "viem";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { blockTime, firstBlockAtOrAfter } from "./blockTimes";
import type { DeskReport, SwapRow } from "./decode";
import { LIVE, TESTNET_MIN_BLOCK_SEC } from "./deployments";
import { FABLES } from "./fables";
import { type History, mergeHistory } from "./history";
import { POOL_LOOKBACK_SEC, readClimPoints, readDeskReports, readPoolOverrides } from "./readClim";
import { readFablesPokes, readSwaps } from "./readFables";
import { laggedHead, withRetry } from "./retry";

export type SeriesDef<T> = {
  chain: "mainnet" | "testnet";
  windowSec: number;
  /** Extra history before the window (a poke's TTL), so the state at the window's start is known. */
  lookbackSec: number;
  minBlockSec: number;
  read: (client: PublicClient, fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
  /** false: the server does not cache it (too many block headers for the public RPC's rate limit). */
  cached?: false;
};

const DAY = 86_400;
const mainnet = <T>(windowSec: number, lookbackSec: number, read: SeriesDef<T>["read"]): SeriesDef<T> => ({ chain: "mainnet", windowSec, lookbackSec, minBlockSec: FABLES.minBlockSec, read });
const testnet = <T>(windowSec: number, lookbackSec: number, read: SeriesDef<T>["read"]): SeriesDef<T> => ({ chain: "testnet", windowSec, lookbackSec, minBlockSec: TESTNET_MIN_BLOCK_SEC, read });
const poolSwaps = (pool: "D" | "K" | "F") => testnet<SwapRow>(DAY, 0, (c, a, b) => readSwaps(c, LIVE.uniswap.poolManager, LIVE.pools[pool].poolId, a, b));
const poolPokes = (pool: "D" | "K" | "F") => testnet<PokeEvent>(DAY, POOL_LOOKBACK_SEC[pool], (c, a, b) => readPoolOverrides(c, pool, a, b));

export const SERIES = {
  /** Fables' keeper overrides, plus one TTL before the window (an override posted then may still be live). */
  "fables-pokes-86400": mainnet<PokeEvent>(DAY, FABLES.pokeTtlSec, readFablesPokes),
  /** 7 days are about 1,400 overrides, each with its block header: more than the mainnet RPC serves a server in several
   *  minutes, so the browser reads this one itself when the 7D period is chosen. */
  "fables-pokes-604800": { ...mainnet<PokeEvent>(7 * DAY, FABLES.pokeTtlSec, readFablesPokes), cached: false },
  "fables-swaps-600": mainnet<SwapRow>(600, 0, (c, a, b) => readSwaps(c, FABLES.poolManager, FABLES.poolId, a, b)),
  /** clim's recommendation at each report (ClimPoker's Poked logs), plus one minute before the window. */
  "clim-points-86400": testnet<ClimPoint>(DAY, 60, readClimPoints),
  "desk-900": testnet<DeskReport>(900, 0, readDeskReports),
  "pool-D-86400": poolPokes("D"),
  "pool-K-86400": poolPokes("K"),
  "pool-F-86400": poolPokes("F"),
  "pool-swaps-D-86400": poolSwaps("D"),
  "pool-swaps-K-86400": poolSwaps("K"),
  "pool-swaps-F-86400": poolSwaps("F"),
} as const;

export type SeriesKey = keyof typeof SERIES;
export type SeriesItem<K extends SeriesKey> = (typeof SERIES)[K] extends SeriesDef<infer T> ? T : never;

export const isSeriesKey = (k: string): k is SeriesKey => Object.prototype.hasOwnProperty.call(SERIES, k);

/** One poll of a sliding window whose first block is found exactly from block timestamps: the first call reads the
 *  whole window (in ranges the RPC accepts), each next one only the blocks since `prev` (mergeHistory). */
export async function pollSeries<T extends { block: bigint }>(def: SeriesDef<T>, client: PublicClient, prev: History<T> | null): Promise<History<T>> {
  return mergeHistory({
    prev,
    toBlock: laggedHead(await withRetry(() => client.getBlockNumber({ cacheTime: 0 }))),
    windowSec: def.windowSec,
    bounds: async (toBlock) => {
      const toTs = await blockTime(client, toBlock);
      return { fromBlock: await firstBlockAtOrAfter(client, toTs - def.windowSec - def.lookbackSec, toBlock, toTs, def.minBlockSec), toTs };
    },
    read: (fromBlock, toBlock) => def.read(client, fromBlock, toBlock),
  });
}
