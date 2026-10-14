"use client";
// The app's live reads. Polling: 15 s for the current state, 30 s for logs (only the new blocks are read; the first
// read starts from the server's cached copy, see useLogHistory).
import type { LivePoolName } from "@clim/shared";
import { mainnetClient, testnetClient } from "@/lib/chain/clients";
import { readLevel2Roles } from "@/lib/chain/readClim";
import { readClimNow } from "@/lib/chain/readClimNow";
import { readFablesNow } from "@/lib/chain/readFables";
import { useLogHistory } from "./useLogHistory";
import { usePoll } from "./usePoll";

export const NOW_POLL_MS = 15_000;
export const LOG_POLL_MS = 30_000;

export const useFablesNow = () => usePoll(() => readFablesNow(mainnetClient()), NOW_POLL_MS, "fables-now");
export const useClimNow = () => usePoll(() => readClimNow(testnetClient()), NOW_POLL_MS, "clim-now");
export const useLevel2Roles = () => usePoll(() => readLevel2Roles(testnetClient()), 60_000, "roles");

/** Fables' keeper overrides over the window, plus one TTL before it (an override posted then may still be live). */
export const useFablesPokes = (windowSec: 86_400 | 604_800) => useLogHistory(`fables-pokes-${windowSec}`, LOG_POLL_MS);

/** clim's recommendation at each report (ClimPoker's Poked logs), plus one minute before the window. */
export const useClimPoints = () => useLogHistory("clim-points-86400", LOG_POLL_MS);

export const useDeskReports = () => useLogHistory("desk-900", LOG_POLL_MS);

/** A testnet pool's overrides over 24 hours (readPoolOverrides), with one TTL of history before the window. */
export const usePoolPokes = (pool: LivePoolName) => useLogHistory(`pool-${pool}-86400`, LOG_POLL_MS);

export const useFablesSwaps = () => useLogHistory("fables-swaps-600", LOG_POLL_MS);

export const usePoolSwaps = (pool: LivePoolName) => useLogHistory(`pool-swaps-${pool}-86400`, LOG_POLL_MS);
