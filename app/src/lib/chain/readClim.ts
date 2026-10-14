// Log reads of clim's live stack on Robinhood Chain testnet (the current state is in readClimNow.ts). This module does
// not import the vendored keeper reader, so the live check can load it in Node.
import { accessManagerAbi, type LivePoolName } from "@clim/shared";
import type { PublicClient } from "viem";
import type { ClimPoint, PokeEvent } from "@/lib/fees";
import { blockTimes } from "./blockTimes";
import { climPointFrom, clearFrom, pokeFromClimPoint, pokeFromDirectional, pokeFromSingle, reportFrom, type DeskReport } from "./decode";
import { LIVE } from "./deployments";
import { FEE_POKED, FEE_POKED_DIRECTIONAL, POKE_CLEARED, POKED, RISK_REPORTED_V2 } from "./events";
import { getLogsChunked } from "./logs";
import { laggedHead, withRetry } from "./retry";

/** ClimPoker's pokes of pool D in [fromBlock, toBlock]: clim's recommendation at each desk report. */
export async function readClimPoints(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<ClimPoint[]> {
  const logs = await getLogsChunked((a, b) => withRetry(() => client.getLogs({ address: LIVE.poker, event: POKED, fromBlock: a, toBlock: b })), fromBlock, toBlock);
  return logs.map(climPointFrom);
}

/** The desk's reports in [fromBlock, toBlock]. */
export async function readDeskReports(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<DeskReport[]> {
  const logs = await getLogsChunked((a, b) => withRetry(() => client.getLogs({ address: LIVE.riskDesk, event: RISK_REPORTED_V2, fromBlock: a, toBlock: b })), fromBlock, toBlock);
  return logs.map(reportFrom);
}

/** Overrides and clears of one testnet pool in [fromBlock, toBlock] (both FeePoked variants and PokeCleared), in chain
 *  order, each at its block's time. viem filters one event per getLogs by an indexed argument, so the three are read
 *  side by side. Pool D is poked every 30 s: its page reads ClimPoker's Poked logs instead (readClimPoints), which
 *  carry the same fees and expiry and the report's time, so it does not read 2,880 block headers a day. */
export async function readPoolPokes(client: PublicClient, pool: LivePoolName, fromBlock: bigint, toBlock: bigint): Promise<PokeEvent[]> {
  const poolId = LIVE.pools[pool].poolId;
  const range = (a: bigint, b: bigint) =>
    withRetry(async () => {
      const [single, directional, cleared] = await Promise.all([
        client.getLogs({ address: LIVE.hook, event: FEE_POKED, args: { poolId }, fromBlock: a, toBlock: b }),
        client.getLogs({ address: LIVE.hook, event: FEE_POKED_DIRECTIONAL, args: { poolId }, fromBlock: a, toBlock: b }),
        client.getLogs({ address: LIVE.hook, event: POKE_CLEARED, args: { poolId }, fromBlock: a, toBlock: b }),
      ]);
      const times = await blockTimes(client, [...single, ...directional, ...cleared].map((l) => l.blockNumber));
      const at = (n: bigint) => times.get(n) as number;
      return [...single.map((l) => pokeFromSingle(l, at(l.blockNumber))), ...directional.map((l) => pokeFromDirectional(l, at(l.blockNumber))), ...cleared.map((l) => clearFrom(l, at(l.blockNumber)))];
    });
  const events = await getLogsChunked(range, fromBlock, toBlock);
  return events.sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));
}

/** How far back each pool's overrides can still be live at a window's start: ClimPoker's TTL (600 s) on D, the
 *  keeper-style bot's (7,200 s) on K; F is never poked. */
export const POOL_LOOKBACK_SEC: Record<LivePoolName, number> = { D: 600, K: 7200, F: 7200 };

/** A testnet pool's overrides: pool D's from ClimPoker's Poked logs (one per report, at the report's time), K's and F's
 *  from the hook's logs at their blocks' times. */
export async function readPoolOverrides(client: PublicClient, pool: LivePoolName, fromBlock: bigint, toBlock: bigint): Promise<PokeEvent[]> {
  if (pool === "D") return (await readClimPoints(client, fromBlock, toBlock)).map(pokeFromClimPoint);
  return readPoolPokes(client, pool, fromBlock, toBlock);
}

/** The level 2 roles on clim's testnet AccessManager: FEE_POKER (1) held by ClimPoker, CLIM_RUNNER (7) by the runner. */
export async function readLevel2Roles(client: PublicClient): Promise<{ blockNumber: bigint; pokerHasFeePoker: boolean; runnerHasClimRunner: boolean }> {
  return withRetry(async () => {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const blockNumber = laggedHead(head);
    const role = (id: bigint, account: `0x${string}`) => client.readContract({ address: LIVE.accessManager, abi: accessManagerAbi, functionName: "hasRole", args: [id, account], blockNumber });
    const [a, b] = await Promise.all([role(BigInt(LIVE.roles.feePoker), LIVE.poker), role(BigInt(LIVE.roles.climRunner), LIVE.roles.runner)]);
    return { blockNumber, pokerHasFeePoker: a[0], runnerHasClimRunner: b[0] };
  });
}
