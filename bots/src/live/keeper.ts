// Keeper-style twin for pool K on Robinhood Chain testnet. It imitates the pattern observed on Fables' ETH/USDG pool,
// not Fables' code: about every 180 s, the fee shared/keeper-map-fables.json gives at the current 5-minute realized
// volatility (Binance 1 s, 5 s returns), posted with pokeFee(poolK, fee, 7200) on PokeFeeHook (FEE_POKER).
// Outages (plan 03 Task 23): while this process is stopped or the Mac sleeps, K keeps its last poke until its 7,200 s TTL
// ends, then its flat fee. After a wall-clock jump the nonce is re-synced and the keeper posts at once from fresh data;
// a fee computed more than 15 s before it is sent is dropped, never sent late; failed ticks back off (2 s doubling to 60 s).
// Usage: bun src/live/keeper.ts     Log: bots/out/keeper-rh.jsonl     Env: KEEPER_SEED (jitter, default 7)
import { pokeFeeHookAbi } from "@clim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { mulberry32 } from "../lib/rng";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { keeperFeePips, nextPostAt, parseKeeperMap, rv5From1s } from "./lib/keeper";
import { isStale } from "./lib/supervise";
import { runSupervised } from "./lib/supervisor";

const BINANCE_1S = "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=400";
const MAX_FEE_AGE_MS = 15_000;
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("keeper"));
const map = parseKeeperMap(JSON.parse(readFileSync(join(REPO_ROOT, "shared", "keeper-map-fables.json"), "utf8")));
const rand = mulberry32(envNum("KEEPER_SEED", 7));
const logFile = join(OUT_DIR, "keeper-rh.jsonl");
let nextAt = 0;

async function tick(): Promise<void> {
  const startedMs = Date.now();
  const now = Math.floor(startedMs / 1000);
  if (now < nextAt) return;
  const base = { ts: new Date().toISOString(), poolId: d.pools.K.poolId };
  try {
    const res = await fetch(BINANCE_1S, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`binance 1s: HTTP ${res.status}`);
    const sigma = rv5From1s(await res.json(), now);
    const fee = keeperFeePips(map, sigma);
    const sigmaPctYr = sigma * Math.sqrt(31_536_000) * 100;
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: d.hook,
      abi: pokeFeeHookAbi,
      functionName: "pokeFee",
      args: [d.pools.K.poolId, fee, map.ttlSec],
    });
    if (isStale(startedMs, Date.now(), MAX_FEE_AGE_MS)) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "stale fee (computed more than 15 s ago)", sigmaPctYr, fee });
      console.log(`[keeper] fee ${fee} computed ${Math.round((Date.now() - startedMs) / 1000)} s ago: dropped, recomputing`);
      return; // nextAt unchanged: the next tick recomputes from fresh data
    }
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    appendJsonl(logFile, { ...base, sigmaPctYr, fee, ttl: map.ttlSec, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice });
    console.log(`[keeper] sigma5 ${sigmaPctYr.toFixed(1)}%/yr -> K fee ${fee} pips (TTL ${map.ttlSec} s), tx ${hash}`);
    nextAt = nextPostAt(now, map.postEverySec, rand);
  } catch (e) {
    appendJsonl(logFile, { ...base, error: shortError(e) });
    throw e; // the supervisor re-syncs the nonce and backs off
  }
}

console.log(`[keeper] ${wallet.account.address} pokes K ${d.pools.K.poolId} on ${d.hook} about every ${map.postEverySec} s (imitation of the observed pattern, not Fables' code)`);
runSupervised({
  name: "keeper",
  logFile,
  everyMs: 5_000,
  wallet,
  immediate: true,
  tick,
  onResume: (gap) => {
    nextAt = 0; // post now, from fresh volatility
    appendJsonl(logFile, { ts: new Date().toISOString(), action: "resume", gapSec: gap.gapSec });
  },
});
