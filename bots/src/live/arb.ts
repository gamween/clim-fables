// Arbitrage bot on Robinhood Chain testnet: every poll (2 s; blocks come about every 0.1 s), read pools D, K and F and
// the venue price (median of four venues' tickers, bots/src/lib/market.ts), and push each pool back to the edge of its
// no-arbitrage band, with the fee of the direction it trades. It swaps through routers.arb, so the dashboard tells
// arbitrage by Swap.sender. Usage: bun src/live/arb.ts     Log: bots/out/arb-rh.jsonl
import { LIVE_POOLS, liveOrientation, poolSwapTestAbi, type LivePoolName } from "@clim/shared";
import { join } from "node:path";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { aggregate, fetchVenueQuotes } from "../lib/market";
import { swapArgs } from "../lib/swap";
import { decideArbDirectional } from "./lib/arb";
import { liveClient, liveWallet, readLiveBalances, readLiveState } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";

const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("arb"));
const me = wallet.account.address;
const router = d.routers.arb;
const logFile = join(OUT_DIR, "arb-rh.jsonl");
// A pool with an arbitrage still pending is skipped: trading it again on stale state would revert or overshoot.
const inflight = new Set<LivePoolName>();

async function onBlock(blockNumber: bigint): Promise<void> {
  const [m, s, bal] = await Promise.all([
    fetchVenueQuotes().then(aggregate),
    readLiveState(client, d, blockNumber),
    readLiveBalances(client, d, me, router),
  ]);
  if (!m) {
    appendJsonl(logFile, { ts: new Date().toISOString(), block: blockNumber, action: "skip", reason: "fewer than 3 venues" });
    return;
  }
  for (const name of LIVE_POOLS) {
    const pool = d.pools[name];
    const ps = s.pools[name];
    const dec = decideArbDirectional({
      sqrtPriceX96: ps.sqrtPriceX96,
      marketEthUsd: m.price,
      fee0For1: ps.fee0For1,
      fee1For0: ps.fee1For0,
      orientation: liveOrientation(d, pool),
    });
    const base = {
      ts: new Date().toISOString(),
      block: blockNumber,
      pool: name,
      market: m.price,
      nVenues: m.n,
      poolEthUsd: dec.poolEthUsd,
      feePips: dec.feePips,
      logGapBp: dec.logGap * 1e4,
      bandBp: dec.bandLog * 1e4,
    };
    if (dec.action === "none") {
      appendJsonl(logFile, { ...base, action: "none" });
      continue;
    }
    if (inflight.has(name)) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "previous arbitrage pending" });
      continue;
    }
    const amountIn = dec.side === "buyEth" ? bal.tUSDG : bal.tETH;
    if (amountIn === 0n) {
      appendJsonl(logFile, { ...base, action: "skip", reason: `no ${dec.side === "buyEth" ? "tUSDG" : "tETH"} balance` });
      continue;
    }
    try {
      // Spend up to the whole balance: the swap stops at the price limit, so only the needed amount moves.
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: router,
        abi: poolSwapTestAbi,
        functionName: "swap",
        args: swapArgs(pool.key, dec.zeroForOne, amountIn, dec.sqrtPriceLimitX96),
      });
      const hash = await wallet.writeContract(request);
      inflight.add(name);
      appendJsonl(logFile, { ...base, action: dec.side, zeroForOne: dec.zeroForOne, targetEthUsd: dec.targetEthUsd, txHash: hash });
      console.log(`[arb] ${name} pool ${dec.poolEthUsd.toFixed(2)} vs ${m.price.toFixed(2)} (fee ${dec.feePips}) -> ${dec.side} tx ${hash}`);
      client
        .waitForTransactionReceipt({ hash })
        .then(
          (r) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt", pool: name, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed }),
          (e: unknown) => appendJsonl(logFile, { ts: new Date().toISOString(), event: "receipt-error", pool: name, txHash: hash, error: shortError(e) }),
        )
        .finally(() => inflight.delete(name));
    } catch (e) {
      const error = shortError(e);
      const action = /PriceLimitAlreadyExceeded|0x7c9c6e8f/.test(error) ? "stale" : "error";
      appendJsonl(logFile, { ...base, action, error });
      if (action === "error") console.error(`[arb] ${name} -> error: ${error}`);
    }
  }
}

let busy = false;
console.log(`[arb] ${me} trading D, K, F through ${router}`);
client.watchBlockNumber({
  emitMissed: false,
  pollingInterval: 2_000,
  onBlockNumber: (blockNumber) => {
    if (busy) return;
    busy = true;
    onBlock(blockNumber)
      .catch((e: unknown) => console.error(`[arb] block ${blockNumber} failed: ${shortError(e)}`))
      .finally(() => {
        busy = false;
      });
  },
  onError: (e) => console.error(`[arb] watch error: ${shortError(e)}`),
});
