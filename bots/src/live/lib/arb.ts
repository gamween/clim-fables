// Arbitrage on a per-direction hook (pool D charges fee0For1 and fee1For0 separately): the side the gap implies
// decides which fee sets the no-arbitrage band; v1's decideArb does the rest.
import { ethUsdFromSqrtPriceX96, type PairOrientation } from "@clim/shared";
import { decideArb, type ArbDecision } from "../../lib/arb";
import { zeroForOneFor } from "../../lib/swap";

export type DirectionalArbInput = {
  sqrtPriceX96: bigint;
  marketEthUsd: number;
  fee0For1: number;
  fee1For0: number;
  orientation: PairOrientation;
};

export function decideArbDirectional(i: DirectionalArbInput): ArbDecision & { feePips: number } {
  const poolEthUsd = ethUsdFromSqrtPriceX96(i.sqrtPriceX96, i.orientation);
  const zeroForOne = zeroForOneFor(poolEthUsd > i.marketEthUsd ? "sellEth" : "buyEth", i.orientation.token0IsEth);
  const feePips = zeroForOne ? i.fee0For1 : i.fee1For0;
  return { ...decideArb({ sqrtPriceX96: i.sqrtPriceX96, marketEthUsd: i.marketEthUsd, feePips, orientation: i.orientation }), feePips };
}
