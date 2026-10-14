// clim's runner on Robinhood Chain testnet (CLIM_RUNNER on our AccessManager): after each new desk report, call
// ClimPoker.poke() so pool D's fee follows clim's policy. The fee comes from the policy, never from this key.
// Usage: bun src/live/runner.ts     Log: bots/out/runner-rh.jsonl     Env: RUNNER_POLL_MS (default 2000)
import { climFeePolicyAbi, climPokerAbi, riskDeskV2Abi } from "@clim/shared";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { pokeDecision } from "./lib/runner";

const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("runner"));
const logFile = join(OUT_DIR, "runner-rh.jsonl");
let lastSeq = 0;

async function tick(): Promise<void> {
  const [st, q] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" },
      { address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional" },
    ],
  });
  const seq = st[6];
  const decision = pokeDecision(seq, lastSeq, q[2]);
  if (decision === "wait") return;
  const base = { ts: new Date().toISOString(), seq, tObs: st[0], quote0For1: q[0], quote1For0: q[1], mode: q[2] };
  if (decision === "blind") {
    appendJsonl(logFile, { ...base, action: "skip", reason: "desk blind" });
    console.log(`[runner] seq ${seq}: desk blind, no poke`);
    lastSeq = seq;
    return;
  }
  try {
    const { request } = await client.simulateContract({ account: wallet.account, address: d.poker, abi: climPokerAbi, functionName: "poke" });
    const hash = await wallet.writeContract(request);
    const r = await client.waitForTransactionReceipt({ hash });
    const ev = parseEventLogs({ abi: climPokerAbi, eventName: "Poked", logs: r.logs })[0]?.args;
    appendJsonl(logFile, {
      ...base,
      action: "poke",
      txHash: hash,
      status: r.status,
      block: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
      fee0For1: ev?.fee0For1 ?? null,
      fee1For0: ev?.fee1For0 ?? null,
      eventApplied: ev?.eventApplied ?? null,
      expiry: ev?.expiry ?? null,
    });
    console.log(`[runner] seq ${seq} poked ${ev?.fee0For1}/${ev?.fee1For0} pips, tx ${hash}, gas ${r.gasUsed}`);
    lastSeq = seq;
  } catch (e) {
    appendJsonl(logFile, { ...base, action: "error", error: shortError(e) });
    console.error(`[runner] seq ${seq} poke failed: ${shortError(e)}`);
  }
}

let busy = false;
console.log(`[runner] ${wallet.account.address} pokes ${d.poker} (pool D ${d.pools.D.poolId}) after each report of ${d.riskDesk}`);
setInterval(() => {
  if (busy) return;
  busy = true;
  tick()
    .catch((e: unknown) => console.error(`[runner] ${shortError(e)}`))
    .finally(() => {
      busy = false;
    });
}, envNum("RUNNER_POLL_MS", 2_000));
