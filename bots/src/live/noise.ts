// Retail (noise) bot on Robinhood Chain testnet: every NOISE_TICK_MS (10 s), a Poisson number of orders
// (NOISE_ORDERS_PER_TICK, default 0.2) with a random side and a log-normal USD size, each sent to D, K and F through the
// retail PoolSwapTest. Usage: bun src/live/noise.ts     Log: bots/out/noise-rh.jsonl
import { LIVE_POOLS, poolSwapTestAbi } from "@clim/shared";
import { join } from "node:path";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { mulberry32 } from "../lib/rng";
import { inputAmountForUsd, noPriceLimit, swapArgs, zeroForOneFor } from "../lib/swap";
import { liveClient, liveWallet, readLiveState } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { planTickOrders, type FlowConfig } from "./lib/flow";

const cfg: FlowConfig = {
  ordersPerTick: envNum("NOISE_ORDERS_PER_TICK", 0.2),
  medianUsd: envNum("NOISE_MEDIAN_USD", 2_000),
  sigmaLn: envNum("NOISE_SIGMA_LN", 1),
};
const seed = envNum("NOISE_SEED", 42);
const rand = mulberry32(seed);
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("noise"));
const logFile = join(OUT_DIR, "noise-rh.jsonl");

async function tick(): Promise<void> {
  const orders = planTickOrders(rand, cfg);
  if (orders.length === 0) return;
  const s = await readLiveState(client, d);
  for (const order of orders) {
    for (const name of LIVE_POOLS) {
      const pool = d.pools[name];
      const ps = s.pools[name];
      const zeroForOne = zeroForOneFor(order.side, pool.token0IsEth);
      const amountIn = inputAmountForUsd(order.side, order.usd, ps.ethUsd, d.tokens.tETH.decimals, d.tokens.tUSDG.decimals);
      const base = { ts: new Date().toISOString(), pool: name, side: order.side, usd: order.usd, feePips: zeroForOne ? ps.fee0For1 : ps.fee1For0 };
      try {
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: d.uniswap.poolSwapTest,
          abi: poolSwapTestAbi,
          functionName: "swap",
          args: swapArgs(pool.key, zeroForOne, amountIn, noPriceLimit(zeroForOne)),
        });
        const hash = await wallet.writeContract(request);
        appendJsonl(logFile, { ...base, amountIn, txHash: hash });
        console.log(`[noise] ${order.side} $${order.usd.toFixed(0)} on ${name} (fee ${base.feePips} pips) tx ${hash}`);
      } catch (e) {
        appendJsonl(logFile, { ...base, error: shortError(e) });
        console.error(`[noise] ${name} error: ${shortError(e)}`);
      }
    }
  }
}

let busy = false;
console.log(`[noise] ${wallet.account.address} ${cfg.ordersPerTick} orders per tick, median $${cfg.medianUsd}, seed ${seed}, mirrored to D, K, F`);
setInterval(() => {
  if (busy) return;
  busy = true;
  tick()
    .catch((e: unknown) => console.error(`[noise] ${shortError(e)}`))
    .finally(() => {
      busy = false;
    });
}, envNum("NOISE_TICK_MS", 10_000));
