// Keeper-style twin for pool K on Robinhood Chain testnet. It imitates the pattern observed on Fables' ETH/USDG pool,
// not Fables' code: about every 180 s, the fee shared/keeper-map-fables.json gives at the current 5-minute realized
// volatility (Binance 1 s, 5 s returns), posted with pokeFee(poolK, fee, 7200) on PokeFeeHook (FEE_POKER).
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

const BINANCE_1S = "https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=400";
const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("keeper"));
const map = parseKeeperMap(JSON.parse(readFileSync(join(REPO_ROOT, "shared", "keeper-map-fables.json"), "utf8")));
const rand = mulberry32(envNum("KEEPER_SEED", 7));
const logFile = join(OUT_DIR, "keeper-rh.jsonl");
let nextAt = 0;

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (now < nextAt) return;
  const base = { ts: new Date().toISOString(), poolId: d.pools.K.poolId };
  try {
    const res = await fetch(BINANCE_1S, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`binance 1s: HTTP ${res.status}`);
    const sigma = rv5From1s(await res.json(), now);
    const fee = keeperFeePips(map, sigma);
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: d.hook,
      abi: pokeFeeHookAbi,
      functionName: "pokeFee",
      args: [d.pools.K.poolId, fee, map.ttlSec],
    });
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash });
    const sigmaPctYr = sigma * Math.sqrt(31_536_000) * 100;
    appendJsonl(logFile, { ...base, sigmaPctYr, fee, ttl: map.ttlSec, txHash: hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice });
    console.log(`[keeper] sigma5 ${sigmaPctYr.toFixed(1)}%/yr -> K fee ${fee} pips (TTL ${map.ttlSec} s), tx ${hash}`);
    nextAt = nextPostAt(now, map.postEverySec, rand);
  } catch (e) {
    appendJsonl(logFile, { ...base, error: shortError(e) });
    console.error(`[keeper] ${shortError(e)}; retry in 30 s`);
    nextAt = now + 30;
  }
}

let busy = false;
console.log(`[keeper] ${wallet.account.address} pokes K ${d.pools.K.poolId} on ${d.hook} about every ${map.postEverySec} s (imitation of the observed pattern, not Fables' code)`);
const loop = (): void => {
  if (busy) return;
  busy = true;
  tick()
    .catch((e: unknown) => console.error(`[keeper] ${shortError(e)}`))
    .finally(() => {
      busy = false;
    });
};
loop();
setInterval(loop, 5_000);
