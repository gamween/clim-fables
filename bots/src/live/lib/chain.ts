// viem clients on Robinhood Chain testnet and the reads shared by the live bots and scripts.
import {
  climFeePolicyAbi,
  ethUsdFromSqrtPriceX96,
  liveOrientation,
  pokeFeeHookAbi,
  riskDeskV2Abi,
  stateViewAbi,
  testTokenAbi,
  type LiveDeployments,
  type LivePoolName,
} from "@clim/shared";
import { createPublicClient, createWalletClient, http, nonceManager, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodTestnet } from "viem/chains";
import { liveRpcUrl } from "./env";

export function liveClient(url: string = liveRpcUrl()) {
  return createPublicClient({ chain: robinhoodTestnet, transport: http(url) });
}
export type LiveClient = ReturnType<typeof liveClient>;

/** nonceManager lets one process send several transactions without waiting for receipts. */
export function liveWallet(privateKey: Hex, url: string = liveRpcUrl()) {
  return createWalletClient({ account: privateKeyToAccount(privateKey, { nonceManager }), chain: robinhoodTestnet, transport: http(url) });
}
export type LiveWallet = ReturnType<typeof liveWallet>;

export type DeskV2State = { tObs: number; sigma15E9: number; sigma5E9: number; devPips: number; kE4: number; flags: number; seq: number };
export type LivePoolState = { sqrtPriceX96: bigint; ethUsd: number; fee0For1: number; fee1For0: number };
export type LiveState = {
  pools: Record<LivePoolName, LivePoolState>;
  desk: DeskV2State;
  policy: { fee0For1: number; fee1For0: number; mode: number };
};

/** One multicall: slot0 and both directions' current fee of D, K and F, the desk's state and the policy's quote. */
export async function readLiveState(client: LiveClient, d: LiveDeployments, blockNumber?: bigint): Promise<LiveState> {
  const sv = d.uniswap.stateView;
  const [sD, aD, bD, sK, aK, bK, sF, aF, bF, st, q] = await client.multicall({
    allowFailure: false,
    blockNumber,
    contracts: [
      { address: sv, abi: stateViewAbi, functionName: "getSlot0", args: [d.pools.D.poolId] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.D.poolId, true] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.D.poolId, false] },
      { address: sv, abi: stateViewAbi, functionName: "getSlot0", args: [d.pools.K.poolId] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.K.poolId, true] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.K.poolId, false] },
      { address: sv, abi: stateViewAbi, functionName: "getSlot0", args: [d.pools.F.poolId] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.F.poolId, true] },
      { address: d.hook, abi: pokeFeeHookAbi, functionName: "currentFee", args: [d.pools.F.poolId, false] },
      { address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" },
      { address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional" },
    ],
  });
  const pool = (name: LivePoolName, slot0: readonly [bigint, number, number, number], f01: number, f10: number): LivePoolState => ({
    sqrtPriceX96: slot0[0],
    ethUsd: ethUsdFromSqrtPriceX96(slot0[0], liveOrientation(d, d.pools[name])),
    fee0For1: f01,
    fee1For0: f10,
  });
  return {
    pools: { D: pool("D", sD, aD, bD), K: pool("K", sK, aK, bK), F: pool("F", sF, aF, bF) },
    desk: { tObs: st[0], sigma15E9: st[1], sigma5E9: st[2], devPips: st[3], kE4: st[4], flags: st[5], seq: st[6] },
    policy: { fee0For1: q[0], fee1For0: q[1], mode: q[2] },
  };
}

/** Testnet ETH for gas, tETH and tUSDG, and their allowances to the router the key swaps through. */
export type LiveBalances = { native: bigint; tETH: bigint; tUSDG: bigint; tETHAllowance: bigint; tUSDGAllowance: bigint };

export async function readLiveBalances(client: LiveClient, d: LiveDeployments, owner: Address, spender: Address): Promise<LiveBalances> {
  const [tETH, tUSDG, tETHAllowance, tUSDGAllowance] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: d.tokens.tETH.address, abi: testTokenAbi, functionName: "balanceOf", args: [owner] },
      { address: d.tokens.tUSDG.address, abi: testTokenAbi, functionName: "balanceOf", args: [owner] },
      { address: d.tokens.tETH.address, abi: testTokenAbi, functionName: "allowance", args: [owner, spender] },
      { address: d.tokens.tUSDG.address, abi: testTokenAbi, functionName: "allowance", args: [owner, spender] },
    ],
  });
  const native = await client.getBalance({ address: owner });
  return { native, tETH, tUSDG, tETHAllowance, tUSDGAllowance };
}
