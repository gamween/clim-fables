// The live desk loop with an on-chain record of every run (Robinhood Chain testnet, plan 03).
// Runs cre/scripts/sim-loop.sh <target> --broadcast (build the WASM once, then `cre workflow simulate` every 30 s) and
// echoes its output. For each run it writes the transcript to bots/out/desk-sim/<run start>.log and appends one line to
// bots/out/desk-runs.jsonl: status, tx hash, receipt and gas, the forwarder's ReportProcessed.result and the decoded
// RiskReportedV2. The receipt decides `applied` (simParse.receiptStatus).
// Usage: bun src/live/desk-loop.ts [--target rh-testnet-settings] [--once]
import { mockForwarderAbi, riskDeskV2Abi } from "@clim/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { argValue, envStr, hasFlag } from "../lib/env";
import { appendJsonl, OUT_DIR, shortError } from "../lib/jsonl";
import { loopCommand, receiptStatus, RunTracker, type RunResult } from "../lib/simParse";
import { liveClient } from "./lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "./lib/deployments";

const target = argValue("--target") ?? "rh-testnet-settings";
const once = hasFlag("--once");
const creDir = envStr("CRE_PROJECT_DIR", join(REPO_ROOT, "cre"));
const d = loadLiveDeployments();
const client = liveClient();
const runsFile = join(OUT_DIR, "desk-runs.jsonl");
const transcriptDir = join(OUT_DIR, "desk-sim");
mkdirSync(transcriptDir, { recursive: true });

async function record(run: RunResult): Promise<void> {
  const { lines, ...result } = run;
  const transcript = `${(run.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.log`;
  writeFileSync(join(transcriptDir, transcript), `${lines.join("\n")}\n`);
  const base = { ts: new Date().toISOString(), target, ...result, transcript: `desk-sim/${transcript}` };
  if (!run.txHash) {
    appendJsonl(runsFile, base);
    console.log(`[desk] run ${run.startedAt}: ${run.status}${run.detail ? ` (${run.detail})` : ""}`);
    return;
  }
  try {
    const r = await client.waitForTransactionReceipt({ hash: run.txHash, timeout: 120_000 });
    const reported = parseEventLogs({ abi: riskDeskV2Abi, eventName: "RiskReportedV2", logs: r.logs }).filter(
      (l) => l.address.toLowerCase() === d.riskDesk.toLowerCase(),
    );
    const processed = parseEventLogs({ abi: mockForwarderAbi, eventName: "ReportProcessed", logs: r.logs });
    const ev = reported[0]?.args;
    const forwarderResult = processed[0]?.args.result ?? null;
    const status = receiptStatus(run.status, forwarderResult, reported.length > 0);
    appendJsonl(runsFile, {
      ...base,
      status,
      statusFromReceipt: status !== run.status,
      txStatus: r.status,
      blockNumber: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
      from: r.from,
      forwarderResult,
      seq: ev?.seq ?? null,
      tObs: ev?.tObs ?? null,
      sigma5Applied: ev?.sigma5Applied ?? null,
      sigma15Applied: ev?.sigma15Applied ?? null,
      sigma5Reported: ev?.sigma5Reported ?? null,
      devPips: ev?.devPips ?? null,
      dispBp: ev?.dispBp ?? null,
      nSources: ev?.nSources ?? null,
      flags: ev?.flags ?? null,
    });
    console.log(`[desk] run ${run.startedAt}: ${status} tx ${run.txHash} seq ${ev?.seq} sigma5 ${ev?.sigma5Applied} dev ${ev?.devPips} gas ${r.gasUsed}`);
  } catch (e) {
    appendJsonl(runsFile, { ...base, receiptError: shortError(e) });
    console.error(`[desk] run ${run.startedAt}: tx ${run.txHash} receipt error: ${shortError(e)}`);
  }
}

const cmd = loopCommand(target);
console.log(`[desk] ${cmd.join(" ")} (cwd ${creDir}), recording to ${runsFile}`);
const proc = Bun.spawn(cmd, { cwd: creDir, stdout: "pipe", stderr: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    proc.kill();
    process.exit(130);
  });
}

const tracker = new RunTracker();
let pending: Promise<void> = Promise.resolve();
const handle = (run: RunResult | null): void => {
  if (!run) return;
  pending = pending.then(() => record(run));
  if (once) {
    pending.then(() => {
      proc.kill();
      process.exit(0);
    });
  }
};

const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += value;
  let nl = buf.indexOf("\n");
  while (nl >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    console.log(line);
    handle(tracker.push(line));
    nl = buf.indexOf("\n");
  }
}
handle(tracker.flush());
await pending;
const code = await proc.exited;
console.error(`[desk] loop exited with code ${code}`);
process.exit(code === 0 ? 0 : 1);
