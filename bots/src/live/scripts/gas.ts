// Gas per transaction type on Robinhood Chain testnet, from the receipts of the live logs: desk report (through the
// MockKeystoneForwarder), ClimPoker.poke(), keeper poke, arbitrage swap, retail swap. Reads each raw receipt
// (gasUsed, gasUsedForL1, effectiveGasPrice), then the desk's cadence from the chain (RiskReportedV2 and Poked over the
// last CADENCE_WINDOW_BLOCKS blocks, default 36,000, about an hour), and writes docs/evidence/gas-robinhood-testnet.json
// for the CTO checklist (spec §5.8). Read only: nothing is sent. Usage: bun src/live/scripts/gas.ts [--last 200]
import { climPokerAbi, riskDeskV2Abi } from "@clim/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { argValue, envNum } from "../../lib/env";
import { OUT_DIR } from "../../lib/jsonl";
import { liveClient } from "../lib/chain";
import { loadLiveDeployments, REPO_ROOT } from "../lib/deployments";
import { cadence, hashesFromJsonl, summarizeGas, type GasRow } from "../lib/gas";
import { laggedHead, withRetry } from "../lib/retry";
import { chunkedRanges } from "../lib/tail";

const last = Number(argValue("--last") ?? "200");
const d = loadLiveDeployments();
const client = liveClient();
const CATEGORIES: Array<[string, string, (o: Record<string, unknown>) => boolean]> = [
  ["deskReport", "desk-runs.jsonl", (o) => o.status === "applied"],
  ["poke", "runner-rh.jsonl", (o) => o.action === "poke" && o.status === "success"],
  ["keeperPoke", "keeper-rh.jsonl", (o) => o.status === "success"],
  ["arbSwap", "arb-rh.jsonl", (o) => o.action === "buyEth" || o.action === "sellEth"],
  ["retailSwap", "noise-rh.jsonl", (o) => o.error === undefined],
];

async function receipt(hash: Hex): Promise<GasRow | null> {
  const r = (await client.request({ method: "eth_getTransactionReceipt", params: [hash] })) as Record<string, unknown> | null;
  if (!r || r.status !== "0x1") return null;
  const big = (x: unknown): bigint => (typeof x === "string" ? BigInt(x) : 0n);
  return { gasUsed: big(r.gasUsed), gasUsedForL1: big(r.gasUsedForL1), effectiveGasPrice: big(r.effectiveGasPrice) };
}

const out: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  chainId: d.chainId,
  note: "Robinhood Chain testnet receipts of the live stack (plan 03); gasUsed includes the L1 component (gasUsedForL1)",
};
for (const [name, file, pick] of CATEGORIES) {
  const path = join(OUT_DIR, file);
  if (!existsSync(path)) {
    out[name] = null;
    continue;
  }
  const hashes = hashesFromJsonl(readFileSync(path, "utf8"), pick, last);
  const rows = (await Promise.all(hashes.map(receipt))).filter((r): r is GasRow => r !== null);
  out[name] = rows.length > 0 ? summarizeGas(rows) : null;
  console.log(`${name}: ${rows.length} receipts`, out[name]);
}

// Cadence, from the chain: the desk's reports (tObs of each RiskReportedV2) and ClimPoker's pokes (tObs each Poked used)
const toBlock = laggedHead(await withRetry(() => client.getBlockNumber()));
const windowBlocks = BigInt(envNum("CADENCE_WINDOW_BLOCKS", 36_000));
const fromBlock = toBlock > windowBlocks ? toBlock - windowBlocks : 0n;
const reportTimes: number[] = [];
const pokeTimes: number[] = [];
for (const [a, b] of chunkedRanges(fromBlock, toBlock)) {
  const reports = await withRetry(() => client.getLogs({ address: d.riskDesk, event: riskDeskV2Abi[1], fromBlock: a, toBlock: b }));
  const pokes = await withRetry(() => client.getLogs({ address: d.poker, event: climPokerAbi[1], fromBlock: a, toBlock: b }));
  reportTimes.push(...reports.map((l) => Number(l.args.tObs ?? 0)));
  pokeTimes.push(...pokes.map((l) => Number(l.args.tObs ?? 0)));
}
out.cadence = {
  fromBlock: Number(fromBlock),
  toBlock: Number(toBlock),
  deskReport: reportTimes.length >= 2 ? cadence(reportTimes) : null,
  poke: pokeTimes.length >= 2 ? cadence(pokeTimes) : null,
};
console.log("cadence", out.cadence);

const dir = join(REPO_ROOT, "docs", "evidence");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "gas-robinhood-testnet.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote docs/evidence/gas-robinhood-testnet.json`);
