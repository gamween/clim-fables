// Retail flow of the live noise bot: per tick, a Poisson number of orders with a random side and a log-normal USD size.
// Every order goes to D, K and F (mirror routing), so the three pools see the same retail flow.
import { logNormal, poisson, type Rand } from "../../lib/rng";
import type { Side } from "../../lib/swap";

export type FlowConfig = { ordersPerTick: number; medianUsd: number; sigmaLn: number };
export type FlowOrder = { side: Side; usd: number };

export function planTickOrders(rand: Rand, cfg: FlowConfig): FlowOrder[] {
  const n = poisson(rand, cfg.ordersPerTick);
  const out: FlowOrder[] = [];
  for (let i = 0; i < n; i++) {
    const side: Side = rand() < 0.5 ? "buyEth" : "sellEth";
    out.push({ side, usd: logNormal(rand, cfg.medianUsd, cfg.sigmaLn) });
  }
  return out;
}
