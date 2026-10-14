// clim's runner on Robinhood Chain testnet (CLIM_RUNNER on our AccessManager): after each new desk report, call
// ClimPoker.poke() so pool D's fee follows clim's policy. The fee comes from the policy, never from this key.
// Outages (plan 03 Task 23): a blind desk is a normal skip, logged once per blind spell (ClimPoker would revert
// DeskBlind, and a DeskBlind revert met anyway is logged the same way); after a wall-clock jump the nonce is re-synced and
// the desk re-read; failed ticks back off (2 s doubling to 60 s). A poke never carries a stale fee: ClimPoker reads the
// policy when the transaction runs. A DeskBlind revert right after a fresh read is first taken as a lagging node of the
// load-balanced public RPC: the simulation is retried 3 times, 2 s apart, before the skip is logged.
// A restarted runner first reads the last poked seq from ClimPoker's Poked events, so it never pokes that report again;
// each poke's gas limit is its estimate plus 20 %, so a poke mined after the next report changed the fees still has gas.
// Usage: bun src/live/runner.ts     Log: bots/out/runner-rh.jsonl     Env: RUNNER_POLL_MS (default 2000)
import { climFeePolicyAbi, climPokerAbi, FeeMode, riskDeskV2Abi } from "@clim/shared";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { envNum } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { liveClient, liveWallet } from "./lib/chain";
import { loadLiveDeployments } from "./lib/deployments";
import { liveKey } from "./lib/env";
import { POKE_LAG_DELAY_MS, POKE_LAG_RETRIES, POKED_LOOKBACK_BLOCKS, pokeDecision, readLastPokedSeq, simulatePoke, withGasMargin } from "./lib/runner";
import { isDeskBlindError } from "./lib/supervise";
import { runSupervised } from "./lib/supervisor";

const d = loadLiveDeployments();
const client = liveClient();
const wallet = liveWallet(liveKey("runner"));
const logFile = join(OUT_DIR, "runner-rh.jsonl");
let lastSeq = 0;
let lastSeqRead = false;
let blindLogged = false;

async function readDesk() {
  return client.multicall({
    allowFailure: false,
    contracts: [
      { address: d.riskDesk, abi: riskDeskV2Abi, functionName: "state" },
      { address: d.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional" },
    ],
  });
}

async function tick(): Promise<void> {
  if (!lastSeqRead) {
    // once per process, before any poke: the seq this runner (or a previous instance) last poked
    lastSeq = Math.max(lastSeq, await readLastPokedSeq(client, d.poker));
    lastSeqRead = true;
    console.log(`[runner] last poked seq on chain: ${lastSeq} (Poked events of the last ${POKED_LOOKBACK_BLOCKS} blocks)`);
  }
  const [st, q] = await readDesk();
  const seq = st[6];
  const base = { ts: new Date().toISOString(), seq, tObs: st[0], quote0For1: q[0], quote1For0: q[1], mode: q[2] };
  if (q[2] === FeeMode.Blind) {
    // No report for more than tauKillSec: no poke. Pool D keeps its last override until it expires, then its flat fee.
    if (!blindLogged) {
      appendJsonl(logFile, { ...base, action: "skip", reason: "desk blind", deskAgeSec: Math.floor(Date.now() / 1000) - st[0] });
      console.log(`[runner] seq ${seq}: desk blind, no poke until the next report`);
      blindLogged = true;
    }
    lastSeq = Math.max(lastSeq, seq);
    return;
  }
  blindLogged = false;
  if (pokeDecision(seq, lastSeq, q[2]) !== "poke") return;
  try {
    const call = { account: wallet.account, address: d.poker, abi: climPokerAbi, functionName: "poke" } as const;
    const { request, gas } = await simulatePoke(
      async () => ({ request: (await client.simulateContract(call)).request, gas: withGasMargin(await client.estimateContractGas(call)) }),
      {
        onRetry: (_e, n) => console.log(`[runner] seq ${seq}: DeskBlind after a fresh read (a lagging RPC node), retry ${n}/${POKE_LAG_RETRIES} in ${POKE_LAG_DELAY_MS / 1_000} s`),
      },
    );
    const hash = await wallet.writeContract({ ...request, gas });
    const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const ev = parseEventLogs({ abi: climPokerAbi, eventName: "Poked", logs: r.logs })[0]?.args;
    appendJsonl(logFile, {
      ...base,
      action: "poke",
      txHash: hash,
      status: r.status,
      block: r.blockNumber,
      gasUsed: r.gasUsed,
      gasLimit: gas,
      effectiveGasPrice: r.effectiveGasPrice,
      fee0For1: ev?.fee0For1 ?? null,
      fee1For0: ev?.fee1For0 ?? null,
      eventApplied: ev?.eventApplied ?? null,
      expiry: ev?.expiry ?? null,
    });
    console.log(`[runner] seq ${seq} poked ${ev?.fee0For1}/${ev?.fee1For0} pips, tx ${hash}, gas ${r.gasUsed}`);
    lastSeq = seq;
  } catch (e) {
    const error = shortError(e);
    if (isDeskBlindError(error)) {
      // still DeskBlind after simulatePoke's retries: the desk went blind between the read and the poke, the same skip
      appendJsonl(logFile, { ...base, action: "skip", reason: "desk blind (DeskBlind revert)" });
      console.log(`[runner] seq ${seq}: DeskBlind, no poke`);
      blindLogged = true;
      lastSeq = seq;
      return;
    }
    appendJsonl(logFile, { ...base, action: "error", error });
    throw e; // the supervisor re-syncs the nonce and backs off
  }
}

console.log(`[runner] ${wallet.account.address} pokes ${d.poker} (pool D ${d.pools.D.poolId}) after each report of ${d.riskDesk}`);
runSupervised({
  name: "runner",
  logFile,
  everyMs: envNum("RUNNER_POLL_MS", 2_000),
  wallet,
  immediate: true,
  tick,
  onResume: async (gap) => {
    const [st, q] = await readDesk();
    const age = Math.floor(Date.now() / 1000) - st[0];
    appendJsonl(logFile, { ts: new Date().toISOString(), action: "resume", gapSec: gap.gapSec, seq: st[6], deskAgeSec: age, mode: q[2] });
    console.log(`[runner] after ${gap.gapSec} s: desk seq ${st[6]}, last report ${age} s old, policy mode ${q[2]}`);
  },
});
