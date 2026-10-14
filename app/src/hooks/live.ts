"use client";
// The app's live reads. Polling: 15 s for the current state, 30 s for logs (only the new blocks are read).
import type { LivePoolName } from "@clim/shared";
import { mainnetClient, testnetClient } from "@/lib/chain/clients";
import { LIVE, TESTNET_MIN_BLOCK_SEC } from "@/lib/chain/deployments";
import { FABLES } from "@/lib/chain/fables";
import { POOL_LOOKBACK_SEC, readClimPoints, readDeskReports, readLevel2Roles, readPoolOverrides } from "@/lib/chain/readClim";
import { readClimNow } from "@/lib/chain/readClimNow";
import { readFablesNow, readFablesPokes, readSwaps } from "@/lib/chain/readFables";
import { useLogHistory } from "./useLogHistory";
import { usePoll } from "./usePoll";

export const NOW_POLL_MS = 15_000;
export const LOG_POLL_MS = 30_000;

export const useFablesNow = () => usePoll(() => readFablesNow(mainnetClient()), NOW_POLL_MS, "fables-now");
export const useClimNow = () => usePoll(() => readClimNow(testnetClient()), NOW_POLL_MS, "clim-now");
export const useLevel2Roles = () => usePoll(() => readLevel2Roles(testnetClient()), 60_000, "roles");

/** Fables' keeper overrides over the window, plus one TTL before it (an override posted then may still be live). */
export const useFablesPokes = (windowSec: number) =>
  useLogHistory({ key: `fables-pokes-${windowSec}`, client: mainnetClient, read: readFablesPokes, windowSec, lookbackSec: FABLES.pokeTtlSec, minBlockSec: FABLES.minBlockSec, pollMs: LOG_POLL_MS });

/** clim's recommendation at each report (ClimPoker's Poked logs), plus one minute before the window. */
export const useClimPoints = (windowSec: number) =>
  useLogHistory({ key: `clim-points-${windowSec}`, client: testnetClient, read: readClimPoints, windowSec, lookbackSec: 60, minBlockSec: TESTNET_MIN_BLOCK_SEC, pollMs: LOG_POLL_MS });

export const useDeskReports = (windowSec: number) =>
  useLogHistory({ key: `desk-${windowSec}`, client: testnetClient, read: readDeskReports, windowSec, lookbackSec: 0, minBlockSec: TESTNET_MIN_BLOCK_SEC, pollMs: LOG_POLL_MS });

/** A testnet pool's overrides (readPoolOverrides), with one TTL of history before the window. */
export const usePoolPokes = (pool: LivePoolName, windowSec: number) =>
  useLogHistory({
    key: `pool-${pool}-${windowSec}`,
    client: testnetClient,
    read: (c, a, b) => readPoolOverrides(c, pool, a, b),
    windowSec,
    lookbackSec: POOL_LOOKBACK_SEC[pool],
    minBlockSec: TESTNET_MIN_BLOCK_SEC,
    pollMs: LOG_POLL_MS,
  });

export const useFablesSwaps = (windowSec: number) =>
  useLogHistory({
    key: `fables-swaps-${windowSec}`,
    client: mainnetClient,
    read: (c, a, b) => readSwaps(c, FABLES.poolManager, FABLES.poolId, a, b),
    windowSec,
    lookbackSec: 0,
    minBlockSec: FABLES.minBlockSec,
    pollMs: LOG_POLL_MS,
  });

export const usePoolSwaps = (pool: LivePoolName, windowSec: number) =>
  useLogHistory({
    key: `pool-swaps-${pool}-${windowSec}`,
    client: testnetClient,
    read: (c, a, b) => readSwaps(c, LIVE.uniswap.poolManager, LIVE.pools[pool].poolId, a, b),
    windowSec,
    lookbackSec: 0,
    minBlockSec: TESTNET_MIN_BLOCK_SEC,
    pollMs: LOG_POLL_MS,
  });
