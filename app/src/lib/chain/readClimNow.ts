// clim's current state on Robinhood Chain testnet. The policy quote comes from the published level 1 reader
// (docs/integrate/keeper-read.ts, vendored byte for byte), so the app shows exactly what a keeper would read.
import { ethUsdFromSqrtPriceX96, riskDeskV2Abi, stateViewAbi, type LivePoolName } from "@clim/shared";
import type { PublicClient } from "viem";
import { readClimQuote, type ClimQuote } from "@/vendor/integrate/keeper-read";
import { LIVE, LIVE_POOLS, orientationOf } from "./deployments";
import { hookViewAbi } from "./events";
import { HEAD_LAG_BLOCKS, withRetry } from "./retry";

export type DeskState = { tObs: number; sigma15E9: number; sigma5E9: number; devPips: number; kE4: number; flags: number; seq: number };
export type PoolNow = { fee0For1: number; fee1For0: number; sqrtPriceX96: bigint; price: number };
export type ClimNow = { quote: ClimQuote; desk: DeskState; pools: Record<LivePoolName, PoolNow> };

/** clim's quote (both directions, mode, observation), the desk's state, and pools D, K and F, all at one block. */
export async function readClimNow(client: PublicClient): Promise<ClimNow> {
  return withRetry(async () => {
    const quote = await readClimQuote(client, { policy: LIVE.policy, lagBlocks: HEAD_LAG_BLOCKS });
    const blockNumber = quote.blockNumber;
    const st = await client.readContract({ address: LIVE.riskDesk, abi: riskDeskV2Abi, functionName: "state", blockNumber });
    const pools = await Promise.all(
      LIVE_POOLS.map(async (name) => {
        const poolId = LIVE.pools[name].poolId;
        const [fee0For1, fee1For0, slot0] = await Promise.all([
          client.readContract({ address: LIVE.hook, abi: hookViewAbi, functionName: "currentFee", args: [poolId, true], blockNumber }),
          client.readContract({ address: LIVE.hook, abi: hookViewAbi, functionName: "currentFee", args: [poolId, false], blockNumber }),
          client.readContract({ address: LIVE.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId], blockNumber }),
        ]);
        return [name, { fee0For1, fee1For0, sqrtPriceX96: slot0[0], price: ethUsdFromSqrtPriceX96(slot0[0], orientationOf(name)) }] as const;
      }),
    );
    return {
      quote,
      desk: { tObs: st[0], sigma15E9: st[1], sigma5E9: st[2], devPips: st[3], kE4: st[4], flags: st[5], seq: st[6] },
      pools: Object.fromEntries(pools) as Record<LivePoolName, PoolNow>,
    };
  });
}
