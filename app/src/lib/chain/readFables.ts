// Reads of Fables' ETH/USDG pool on Robinhood Chain mainnet. Every call is an eth_call or eth_getLogs: nothing is sent.
import { ethUsdFromSqrtPriceX96, stateViewAbi } from "@clim/shared";
import type { PublicClient } from "viem";
import type { PokeEvent } from "@/lib/fees";
import { blockTimes } from "./blockTimes";
import { pokeFromSingle, swapFrom, type SwapRow } from "./decode";
import { FEE_POKED, hookViewAbi, SWAP } from "./events";
import { FABLES } from "./fables";
import { getLogsChunked } from "./logs";
import { laggedHead, withRetry } from "./retry";

export const ETH_USDG_ORIENTATION = { token0IsEth: true, decimals0: 18, decimals1: 6 } as const;

export type FablesNow = { blockNumber: bigint; t: number; fee0For1: number; fee1For0: number; sqrtPriceX96: bigint; price: number };

/** The fee a swap would pay now in each direction (the hook's own currentFee) and the pool price, at one block a few
 *  blocks behind the head. */
export async function readFablesNow(client: PublicClient): Promise<FablesNow> {
  return withRetry(async () => {
    const blockNumber = laggedHead(await client.getBlockNumber({ cacheTime: 0 }));
    const fee = (zeroForOne: boolean) => client.readContract({ address: FABLES.hook, abi: hookViewAbi, functionName: "currentFee", args: [FABLES.poolId, zeroForOne], blockNumber });
    const [block, fee0For1, fee1For0, slot0] = await Promise.all([
      client.getBlock({ blockNumber }),
      fee(true),
      fee(false),
      client.readContract({ address: FABLES.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [FABLES.poolId], blockNumber }),
    ]);
    return { blockNumber, t: Number(block.timestamp), fee0For1, fee1For0, sqrtPriceX96: slot0[0], price: ethUsdFromSqrtPriceX96(slot0[0], ETH_USDG_ORIENTATION) };
  });
}

/** The keeper's overrides on the pool in [fromBlock, toBlock] (FeePoked logs of the hook, this pool only). */
export async function readFablesPokes(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<PokeEvent[]> {
  const logs = await getLogsChunked(
    (a, b) => withRetry(() => client.getLogs({ address: FABLES.hook, event: FEE_POKED, args: { poolId: FABLES.poolId }, fromBlock: a, toBlock: b })),
    fromBlock,
    toBlock,
  );
  const times = await blockTimes(client, logs.map((l) => l.blockNumber));
  return logs.map((l) => pokeFromSingle(l, times.get(l.blockNumber) as number));
}

/** Swaps of a pool in [fromBlock, toBlock], in chain order. */
export async function readSwaps(client: PublicClient, poolManager: `0x${string}`, poolId: `0x${string}`, fromBlock: bigint, toBlock: bigint): Promise<SwapRow[]> {
  const logs = await getLogsChunked(
    (a, b) => withRetry(() => client.getLogs({ address: poolManager, event: SWAP, args: { id: poolId }, fromBlock: a, toBlock: b })),
    fromBlock,
    toBlock,
  );
  return logs.map((l) => swapFrom(l, ETH_USDG_ORIENTATION));
}
